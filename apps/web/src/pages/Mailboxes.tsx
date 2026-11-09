import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, Download, Eye, EyeOff, FileText, HelpCircle, Mail, Plus, RefreshCw, Search, Send, Settings2, Trash2, Upload, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError, type Mailbox, type SenderProfile } from "../api";
import { useMe, useWs } from "../App";
import { RichBody } from "../EmailEditor";
import { GmailMark, GoogleMark, MicrosoftMark } from "../marks";
import { OAuthSetupModal, oauthStatusKey, type OAuthStatus } from "../OAuthSetup";
import { cx, Empty, Modal, PageHeader, Spinner, StatusPill, Tab, Toggle, useToast } from "../ui";

type Provider = "google" | "microsoft" | "smtp";

export function MailboxesPage() {
  const ws = useWs();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<"mailboxes" | "senders">("mailboxes");

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("oauth_error");
    if (connected) toast(`Connected ${connected}`);
    if (error) toast(error, "error");
    if (connected || error) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, toast]);
  const [adding, setAdding] = useState(false);
  const [profileModal, setProfileModal] = useState<SenderProfile | "new" | null>(null);
  return (
    <div>
      <PageHeader
        icon={<Mail size={18} />}
        title="Senders & Mailboxes"
        actions={tab === "mailboxes"
          ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Add mailbox</button>
          : <button className="btn-primary" onClick={() => setProfileModal("new")}><Plus size={16} /> Create rotation</button>}
      >
        <Tab active={tab === "mailboxes"} onClick={() => setTab("mailboxes")}>Mailboxes</Tab>
        <Tab active={tab === "senders"} onClick={() => setTab("senders")}>Rotation</Tab>
      </PageHeader>
      <div className="p-4 md:p-8">
        {tab === "mailboxes" ? <MailboxList onAdd={() => setAdding(true)} /> : <ProfileList onEdit={setProfileModal} />}
      </div>
      {adding && <AddMailboxModal onClose={() => setAdding(false)} />}
      {profileModal && <ProfileModal ws={ws} profile={profileModal === "new" ? null : profileModal} onClose={() => setProfileModal(null)} />}
    </div>
  );
}

function DnsBadge({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  return <span className={cx("chip", ok ? "bg-emerald-50 text-emerald-700" : ok === false ? "bg-red-50 text-red-700" : "bg-ink-100 text-ink-500")}>{label}</span>;
}

function MailboxList({ onAdd }: { onAdd: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const list = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["mailboxes", ws] });
  const check = useMutation({
    mutationFn: (id: string) => api<{ connection: { smtp: { ok: boolean }; imap: { ok: boolean } } }>(`/v1/workspaces/${ws}/mailboxes/${id}/check`, { body: {} }),
    onSuccess: (r) => { toast(r.connection.smtp.ok && r.connection.imap.ok ? "Connection OK, DNS checked" : "Connection problem — see status", r.connection.smtp.ok && r.connection.imap.ok ? "success" : "error"); refresh(); },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/v1/workspaces/${ws}/mailboxes/${id}`, { method: "PATCH", body }),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/v1/workspaces/${ws}/mailboxes/${id}`, { method: "DELETE" }), onSuccess: refresh });

  const rows = (list.data ?? []).filter((m) => !q || m.email.includes(q.toLowerCase()) || m.fromName.toLowerCase().includes(q.toLowerCase()));
  const sentToday = (list.data ?? []).reduce((s, m) => s + m.sentToday, 0);
  const sentYesterday = (list.data ?? []).reduce((s, m) => s + m.sentYesterday, 0);
  const capacity = (list.data ?? []).filter((m) => m.status === "active").reduce((s, m) => s + m.dailyLimit, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card px-4 py-3 flex items-center gap-3"><Mail className="text-brand-600" size={18} /><div><div className="text-xs text-ink-500">Mailboxes</div><div className="font-semibold">{list.data?.length ?? 0}</div></div></div>
        <div className="card px-4 py-3 flex items-center gap-3"><Clock className="text-ink-400" size={18} /><div><div className="text-xs text-ink-500">Sent yesterday</div><div className="font-semibold">{sentYesterday}</div></div></div>
        <div className="card px-4 py-3 flex items-center gap-3"><Send className="text-ink-400" size={18} /><div><div className="text-xs text-ink-500">Sent today</div><div className="font-semibold">{sentToday}</div></div></div>
        <div className="card px-4 py-3 flex items-center gap-3"><Settings2 className="text-ink-400" size={18} /><div><div className="text-xs text-ink-500">Daily capacity</div><div className="font-semibold">{capacity}</div></div></div>
      </div>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap gap-3 p-4 border-b border-ink-100">
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search mailboxes" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {list.isLoading ? <Spinner /> : !rows.length ? (
          <Empty icon={<Mail size={20} />} title="No mailboxes connected" text="Connect Google Workspace, Microsoft 365 or any IMAP/SMTP inbox. Use several mailboxes on look-alike domains to spread volume." action={<button className="btn-primary" onClick={onAdd}><Plus size={16} /> Add mailbox</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Mailbox</th><th className="th">Status</th><th className="th">DNS</th><th className="th">Yesterday</th><th className="th">Today / limit</th><th className="th">Last sync</th><th className="th" /></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="td"><div className="font-medium text-ink-800">{m.fromName}</div><div className="text-xs text-ink-500">{m.email} · {m.provider === "smtp" ? "IMAP/SMTP" : m.provider === "google" ? "Google" : "Microsoft"}</div></td>
                    <td className="td"><StatusPill status={m.status} />{m.statusError && <div className="text-xs text-red-600 mt-1 max-w-[220px] truncate" title={m.statusError}>{m.statusError}</div>}</td>
                    <td className="td"><div className="flex gap-1"><DnsBadge ok={m.domain?.spfOk} label="SPF" /><DnsBadge ok={m.domain?.dkimOk} label="DKIM" /><DnsBadge ok={m.domain?.dmarcOk} label="DMARC" /></div></td>
                    <td className="td">{m.sentYesterday}</td>
                    <td className="td">
                      <div className="flex items-center gap-2"><span>{m.sentToday} / {m.dailyLimit}</span>
                        <div className="w-16 h-1.5 bg-ink-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${Math.min(100, (m.sentToday / m.dailyLimit) * 100)}%` }} /></div>
                      </div>
                    </td>
                    <td className="td text-xs text-ink-500">{m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleTimeString() : "—"}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost btn-sm" title="Check connection and DNS" onClick={() => check.mutate(m.id)} disabled={check.isPending}><RefreshCw size={14} className={cx(check.isPending && check.variables === m.id && "animate-spin")} /></button>
                        <button className="btn-ghost btn-sm" onClick={() => patch.mutate({ id: m.id, body: { status: m.status === "paused" ? "active" : "paused" } })}>{m.status === "paused" ? "Resume" : "Pause"}</button>
                        <button className="btn-ghost btn-sm" title="Settings" onClick={() => setEditing(m)}><Settings2 size={14} /></button>
                        <button className="btn-ghost btn-sm" title="Remove" onClick={() => confirm(`Remove ${m.email}? Its threads will be deleted.`) && del.mutate(m.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <EditMailboxModal mailbox={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

type ProviderInfo = { authType: "password" | "oauth"; username: string; smtp: { host: string; port: number; secure: boolean }; imap: { host: string; port: number; secure: boolean } };

const SIGNATURE_VARIABLES = [
  { v: "first_name", l: "Mailbox first name" }, { v: "last_name", l: "Mailbox last name" }, { v: "sender_email", l: "Mailbox email" },
  { v: "Client Partner|GTM Lead", l: "Spintax (varies per email)" },
];

function EditMailboxModal({ mailbox, onClose, onSaved }: { mailbox: Mailbox; onClose: () => void; onSaved: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"settings" | "provider" | "signature" | "tags">("settings");
  const [first0, ...rest0] = mailbox.fromName.trim().split(/\s+/);
  const [f, setF] = useState({
    firstName: first0 ?? "", lastName: rest0.join(" "), dailyLimit: mailbox.dailyLimit, minGapSeconds: mailbox.minGapSeconds, maxGapSeconds: mailbox.maxGapSeconds,
    timezone: mailbox.timezone, signatureHtml: mailbox.signatureHtml.replace(/^<!--sig:[^>]*-->/, ""), tags: mailbox.tags,
    trackingOn: !!mailbox.trackingDomain, trackingDomain: mailbox.trackingDomain ?? "",
  });
  const [applyAll, setApplyAll] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [providerSide, setProviderSide] = useState<"imap" | "smtp">("imap");
  const [prov, setProv] = useState<ProviderInfo | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [provDirty, setProvDirty] = useState(false);
  const [domainState, setDomainState] = useState<{ verified: boolean; found: string[] } | null>(mailbox.trackingDomainVerified ? { verified: true, found: [] } : null);
  const [spam, setSpam] = useState<{ score: number; issues: { code: string; message: string }[] } | null>(null);

  const provider = useQuery({ queryKey: ["mailbox-provider", ws, mailbox.id], queryFn: () => api<ProviderInfo>(`/v1/workspaces/${ws}/mailboxes/${mailbox.id}/provider`) });
  const target = useQuery({ queryKey: ["tracking-target", ws], queryFn: () => api<{ type: string; value: string }>(`/v1/workspaces/${ws}/tracking-target`) });
  useEffect(() => { if (provider.data && !prov) setProv(provider.data); }, [provider.data, prov]);
  useEffect(() => {
    if (tab !== "signature") return;
    const t = setTimeout(() => api<typeof spam>(`/v1/workspaces/${ws}/spam-check`, { body: { subject: "x", bodyHtml: f.signatureHtml } }).then(setSpam).catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [f.signatureHtml, tab, ws]);

  const domain = f.trackingDomain.trim().toLowerCase();
  const host = domain.split(".")[0] ?? "";
  const check = useMutation({
    mutationFn: async () => {
      await api(`/v1/workspaces/${ws}/mailboxes/${mailbox.id}`, { method: "PATCH", body: { trackingDomain: domain } });
      return api<{ verified: boolean; found: string[]; expected: string }>(`/v1/workspaces/${ws}/mailboxes/${mailbox.id}/tracking-domain/check`, { body: {} });
    },
    onSuccess: (r) => { setDomainState(r); toast(r.verified ? "Tracking domain is active" : `CNAME not found yet${r.found.length ? ` (points to ${r.found[0]})` : ""}. DNS changes can take up to an hour.`, r.verified ? "success" : "error"); onSaved(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const save = useMutation({
    mutationFn: async () => {
      if (prov && provDirty && prov.authType === "password") {
        await api(`/v1/workspaces/${ws}/mailboxes/${mailbox.id}/provider`, {
          method: "PATCH", body: { username: prov.username, password: password || undefined, smtp: prov.smtp, imap: prov.imap },
        });
      }
      await api(`/v1/workspaces/${ws}/mailboxes/${mailbox.id}`, {
        method: "PATCH",
        body: {
          fromName: `${f.firstName} ${f.lastName}`.trim() || mailbox.fromName, dailyLimit: f.dailyLimit, minGapSeconds: f.minGapSeconds, maxGapSeconds: f.maxGapSeconds,
          timezone: f.timezone, signatureHtml: f.signatureHtml, tags: f.tags, trackingDomain: f.trackingOn && domain ? domain : null,
        },
      });
      if (!applyAll) return 0;
      const others = (qc.getQueryData<Mailbox[]>(["mailboxes", ws]) ?? []).filter((m) => m.id !== mailbox.id);
      for (const m of others) await api(`/v1/workspaces/${ws}/mailboxes/${m.id}`, { method: "PATCH", body: { signatureHtml: f.signatureHtml } });
      return others.length;
    },
    onSuccess: (n) => { toast(n ? `Saved — signature applied to ${n + 1} mailboxes` : "Mailbox updated"); onSaved(); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const addTag = () => {
    const t = tagInput.trim().slice(0, 40);
    if (t && !f.tags.includes(t) && f.tags.length < 20) setF({ ...f, tags: [...f.tags, t] });
    setTagInput("");
  };
  const side = prov?.[providerSide];
  const setSide = (patch: Partial<ProviderInfo["imap"]>) => { if (prov) { setProv({ ...prov, [providerSide]: { ...prov[providerSide], ...patch } }); setProvDirty(true); } };
  const tabs = [["settings", "Settings"], ["provider", "Provider"], ["signature", "Signature"], ["tags", "Tags"]] as const;

  return (
    <Modal open onClose={onClose} title="Mailbox" subtitle={mailbox.email} icon={<Mail size={20} />} flush
      footer={<button className="btn-primary w-full h-11" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Updating…" : "Update"}</button>}>
      <div className="flex gap-6 px-5 border-b border-ink-100">
        {tabs.map(([k, l]) => <button key={k} className={cx("tab pt-3", tab === k && "tab-active")} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="p-5 max-h-[65vh] overflow-y-auto">
        {tab === "settings" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">First name</label><input className="input h-10" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></div>
              <div><label className="label">Last name</label><input className="input h-10" value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></div>
            </div>
            <div>
              <label className="label flex items-center gap-1.5">Daily (24 Hour) sending limit <span title="Cold emails this mailbox sends per day. Start at 20–30 for new mailboxes; most teams stay at or below 50." className="text-ink-400 cursor-help"><HelpCircle size={14} /></span></label>
              <input type="number" min={1} max={500} className="input h-10" value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: Number(e.target.value) })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="label">Min gap (sec)</label><input type="number" className="input" value={f.minGapSeconds} onChange={(e) => setF({ ...f, minGapSeconds: Number(e.target.value) })} /></div>
              <div><label className="label">Max gap (sec)</label><input type="number" className="input" value={f.maxGapSeconds} onChange={(e) => setF({ ...f, maxGapSeconds: Number(e.target.value) })} /></div>
              <div><label className="label">Time zone</label><input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></div>
            </div>
            <div className="border-t border-ink-100 pt-4 space-y-3">
              <div className="flex items-start gap-4">
                <p className="text-sm flex-1">Custom domain tracking (Recommended). Users with a custom tracking domain see a boost in deliverability.</p>
                <Toggle checked={f.trackingOn} onChange={(v) => setF({ ...f, trackingOn: v })} />
              </div>
              {f.trackingOn && (
                <>
                  <div className="inline-block rounded-xl bg-ink-100 px-4 py-3 text-sm space-y-0.5">
                    <div>Record Type: <span className="text-brand-700">CNAME</span></div>
                    <div>Host/Name: <span className="text-brand-700">{host || "track"}</span></div>
                    <div>Value: <span className="text-brand-700">{target.data?.value ?? "…"}</span></div>
                  </div>
                  <p className="text-xs text-ink-500">Add this record at your domain's DNS provider, then enter the full domain below. Open/click tracking and the unsubscribe link will use it once it's active.</p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input className="input h-10 pr-20" placeholder={`track.${mailbox.email.split("@")[1]}`} value={f.trackingDomain}
                        onChange={(e) => { setF({ ...f, trackingDomain: e.target.value }); setDomainState(null); }} />
                      {domainState && domain === (mailbox.trackingDomain ?? domain) && (
                        <span className={cx("absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium", domainState.verified ? "text-emerald-600" : "text-amber-600")}>{domainState.verified ? "Active" : "Pending"}</span>
                      )}
                    </div>
                    <button className="btn-secondary h-10" disabled={!domain || check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking…" : "Check status"}</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "provider" && (
          !prov ? <Spinner /> : prov.authType === "oauth" ? (
            <p className="text-sm text-ink-600">This mailbox is connected with {mailbox.provider === "microsoft" ? "Microsoft" : "Google"} sign-in, so there's no password or server to edit. If it stops working, remove it and connect it again.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 rounded-xl bg-ink-100 p-1">
                {(["imap", "smtp"] as const).map((s) => (
                  <button key={s} className={cx("h-10 rounded-lg text-sm font-semibold", providerSide === s ? "bg-surface shadow-card" : "text-ink-500")} onClick={() => setProviderSide(s)}>{s.toUpperCase()} Settings</button>
                ))}
              </div>
              <div>
                <h3 className="text-lg font-semibold">{providerSide.toUpperCase()}</h3>
                <p className="text-sm text-ink-500">Configure {providerSide.toUpperCase()} Settings. The username and password are used for both IMAP and SMTP.</p>
              </div>
              <div><label className="label">{providerSide.toUpperCase()} Username (optional)</label><input className="input h-10" value={prov.username} onChange={(e) => { setProv({ ...prov, username: e.target.value }); setProvDirty(true); }} /></div>
              <div>
                <label className="label">{providerSide.toUpperCase()} Password (optional)</label>
                <div className="relative">
                  <input className="input h-10 pr-10" type={showPw ? "text" : "password"} placeholder="Leave blank to keep the current password" value={password} onChange={(e) => { setPassword(e.target.value); setProvDirty(true); }} />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((s) => !s)}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </div>
              </div>
              {side && (
                <div className="grid grid-cols-[1fr_140px] gap-3">
                  <div><label className="label">{providerSide.toUpperCase()} Host</label><input className="input h-10" value={side.host} onChange={(e) => setSide({ host: e.target.value })} /></div>
                  <div><label className="label">{providerSide.toUpperCase()} Port</label><input type="number" className="input h-10" value={side.port} onChange={(e) => setSide({ port: Number(e.target.value) })} /></div>
                  <label className="flex items-center gap-2 text-sm col-span-2"><input type="checkbox" checked={side.secure} onChange={(e) => setSide({ secure: e.target.checked })} /> Use SSL/TLS {providerSide === "smtp" && <span className="text-ink-500">(port 465; turn off for 587 STARTTLS)</span>}</label>
                </div>
              )}
              {provDirty && <p className="text-xs text-ink-500">When you click Update, we test the connection first and only save if both IMAP and SMTP work.</p>}
            </div>
          )
        )}

        {tab === "signature" && (
          <div className="space-y-4">
            <div>
              <div className="label">Signature</div>
              <div className="rounded-xl border border-ink-200 overflow-hidden">
                <RichBody html={f.signatureHtml} onChange={(html) => setF((x) => ({ ...x, signatureHtml: html }))} editorKey={`sig-${mailbox.id}`} variables={SIGNATURE_VARIABLES} minHeight={160} placeholder="Name, title, company, phone…" />
              </div>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-xs text-ink-500">
              <span>Note</span><span>First and last name variables will be replaced with the actual names of the mailbox.</span>
              <span>Good practices</span>
              <span>Add job title, company name, and optionally website, address and phone number. Use spintax to vary your signature across emails, e.g. {"{{Client Partner|GTM Lead}}"}.</span>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} /> Use this signature on all mailboxes</label>
            <div className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 h-11 text-sm font-medium" title={spam?.issues.map((i) => i.message).join("\n") || "No problems found"}>
              <AlertTriangle size={17} /> Spam check
              <span className="w-12 h-1.5 rounded-full bg-ink-100 overflow-hidden"><span className={cx("block h-full", !spam ? "bg-ink-200" : spam.score >= 80 ? "bg-emerald-500" : spam.score >= 60 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${spam?.score ?? 0}%` }} /></span>
            </div>
          </div>
        )}

        {tab === "tags" && (
          <div className="space-y-3">
            <p className="text-sm text-ink-500">Tags help you filter and group mailboxes, e.g. by client, domain or warm-up stage.</p>
            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
              {f.tags.length ? f.tags.map((t) => (
                <span key={t} className="chip bg-brand-50 text-brand-700">{t}<button aria-label={`Remove ${t}`} onClick={() => setF({ ...f, tags: f.tags.filter((x) => x !== t) })}><X size={12} /></button></span>
              )) : <span className="text-sm text-ink-400">No tags yet</span>}
            </div>
            <div className="flex gap-2">
              <input className="input h-10" placeholder="Add a tag and press Enter" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
              <button className="btn-secondary h-10" onClick={addTag} disabled={!tagInput.trim()}>Add</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

const PASSWORD_HINT: Record<Provider, string> = {
  google: "Google: turn on 2-step verification for the account, then create an app password and paste it below.",
  microsoft: "Microsoft 365: your admin may need to enable Authenticated SMTP for this mailbox.",
  smtp: "Zoho, Fastmail, cPanel hosting, or your own mail server. Your host's help pages list these server settings.",
};

function AddMailboxModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [f, setF] = useState({
    email: "", fromName: "", username: "", password: "", dailyLimit: 30, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    smtpHost: "", smtpPort: 465, smtpSecure: true, imapHost: "", imapPort: 993, imapSecure: true,
  });
  const [test, setTest] = useState<{ smtp: { ok: boolean; error?: string }; imap: { ok: boolean; error?: string } } | null>(null);
  const payload = () => ({
    email: f.email, fromName: f.fromName, provider, username: f.username || undefined, password: f.password, dailyLimit: f.dailyLimit, timezone: f.timezone,
    ...(provider === "smtp" ? { smtp: { host: f.smtpHost, port: f.smtpPort, secure: f.smtpSecure }, imap: { host: f.imapHost, port: f.imapPort, secure: f.imapSecure } } : {}),
  });
  const runTest = useMutation({ mutationFn: () => api<typeof test>(`/v1/workspaces/${ws}/mailboxes/test`, { body: payload() }), onSuccess: setTest });
  const create = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/mailboxes`, { body: payload() }),
    onSuccess: () => { toast("Mailbox connected"); qc.invalidateQueries({ queryKey: ["mailboxes", ws] }); onClose(); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.details) setTest(e.details as typeof test);
      toast(e.message, "error");
    },
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value });

  const oauth = useQuery({ queryKey: oauthStatusKey(ws), queryFn: () => api<OAuthStatus>(`/v1/workspaces/${ws}/oauth/providers`) });
  const [redirecting, setRedirecting] = useState(false);
  const [help, setHelp] = useState<"google" | "microsoft" | null>(null);
  const [guide, setGuide] = useState<GuideProvider | null>(null);
  const startOAuth = async (p: "google" | "microsoft") => {
    setRedirecting(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const r = await api<{ url: string }>(`/v1/workspaces/${ws}/mailboxes/oauth/${p}/start?timezone=${encodeURIComponent(tz)}`);
      window.location.href = r.url;
    } catch (e) {
      toast((e as Error).message, "error");
      setRedirecting(false);
    }
  };
  const me = useMe();
  const isAdmin = ["owner", "admin"].includes(me.data?.workspaces.find((w) => w.slug === ws)?.role ?? "");
  // Configured: open the Login dialog. Not configured: admins add the Client ID and Secret first; others are told who can.
  const openProvider = (p: "google" | "microsoft") => {
    if (oauth.data?.[p].configured) return setGuide(p);
    if (isAdmin) return setHelp(p);
    toast(`${p === "google" ? "Google" : "Microsoft"} login isn't set up yet. Ask a workspace admin to add the Client ID in Settings → Integrations.`, "error");
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [bulkResult, setBulkResult] = useState<{ connected: number; failed: number; results: { row: number; email: string; ok: boolean; error?: string }[] } | null>(null);
  const bulk = useMutation({
    mutationFn: async (file: File) => api<NonNullable<typeof bulkResult>>(`/v1/workspaces/${ws}/mailboxes/bulk`, {
      body: { csv: await file.text(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    }),
    onSuccess: (r) => { setBulkResult(r); qc.invalidateQueries({ queryKey: ["mailboxes", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (bulkResult) return <BulkResultModal result={bulkResult} onClose={onClose} />;
  if (help) return <OAuthSetupModal provider={help} status={oauth.data?.[help]} saveLabel="Save and log in" onClose={() => setHelp(null)}
    onSaved={() => { const p = help; setHelp(null); void startOAuth(p); }} />;
  if (guide) return <ProviderGuideModal provider={guide} busy={redirecting} onClose={onClose} onLogin={() => startOAuth(guide)} />;

  const section = "px-5 py-4";
  const heading = "text-sm font-semibold text-ink-900 mb-1.5 px-3";
  const googleOn = !!oauth.data?.google.configured;
  const microsoftOn = !!oauth.data?.microsoft.configured;

  return (
    <Modal open onClose={onClose} title="Connect a new email account" subtitle="Select a method to add email accounts to your workspace." icon={<Mail size={20} />} wide={!!provider} flush={!provider} footer={provider ? <>
      <button className="btn-ghost mr-auto" onClick={() => { setProvider(null); setTest(null); }}>Back</button>
      <button className="btn-secondary" disabled={runTest.isPending || !f.email || !f.password} onClick={() => runTest.mutate()}>{runTest.isPending ? "Testing…" : "Test connection"}</button>
      <button className="btn-primary" disabled={create.isPending || !f.email || !f.password || !f.fromName} onClick={() => create.mutate()}>{create.isPending ? "Connecting…" : "Connect"}</button>
    </> : undefined}>
      {!provider ? (
        <div className="divide-y divide-ink-100">
          <div className={section}>
            <div className={heading}>Connect existing inboxes</div>
            <ChooserRow icon={<GoogleMark />} title="Google" sub={redirecting ? "Redirecting…" : !googleOn && isAdmin ? "Gmail / GSuite · add the Client ID to enable" : "Gmail / GSuite"} onClick={() => openProvider("google")} />
            <ChooserRow icon={<MicrosoftMark />} title="Microsoft 365 / Outlook" sub={!microsoftOn && isAdmin ? "Add the Client ID to enable" : undefined} onClick={() => openProvider("microsoft")} />
          </div>
          <div className={section}>
            <div className={heading}>Manual setup</div>
            <ChooserRow icon={<Mail size={17} className="text-ink-600" />} title="Connect email (IMAP / SMTP)" onClick={() => setProvider("smtp")} />
            <ChooserRow
              icon={<FileText size={17} className="text-ink-600" />}
              title="Bulk connect email (IMAP / SMTP)"
              sub={bulk.isPending ? "Testing each mailbox… this can take a minute" : undefined}
              right={
                <span className="flex items-center gap-4 text-sm font-medium text-ink-600">
                  <button className="flex items-center gap-1.5 hover:text-ink-900" onClick={downloadSample}>Sample <Download size={15} /></button>
                  <button className="flex items-center gap-1.5 hover:text-ink-900 disabled:opacity-50" disabled={bulk.isPending} onClick={() => fileRef.current?.click()}>
                    {bulk.isPending ? "Uploading…" : "Upload CSV"} <Upload size={15} />
                  </button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) bulk.mutate(file); e.target.value = ""; }} />
                </span>
              }
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">{PASSWORD_HINT[provider]}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label">Email address</label><input className="input" type="email" value={f.email} onChange={set("email")} autoFocus /></div>
            <div><label className="label">Sender name</label><input className="input" value={f.fromName} onChange={set("fromName")} placeholder="Alex Morgan" /></div>
            <div><label className="label">Username <span className="text-ink-400 font-normal">(if not the email)</span></label><input className="input" value={f.username} onChange={set("username")} /></div>
            <div><label className="label">{provider === "google" ? "App password" : "Password"}</label><input className="input" type="password" value={f.password} onChange={set("password")} /></div>
            <div><label className="label">Daily cold limit</label><input className="input" type="number" value={f.dailyLimit} onChange={set("dailyLimit")} /></div>
            <div><label className="label">Time zone</label><input className="input" value={f.timezone} onChange={set("timezone")} /></div>
          </div>
          {provider === "smtp" && (
            <div className="grid sm:grid-cols-2 gap-4">
              {(["smtp", "imap"] as const).map((k) => (
                <div key={k} className="rounded-lg border border-ink-200 p-3 space-y-2">
                  <div className="text-sm font-medium uppercase text-ink-600">{k}</div>
                  <input className="input" placeholder={`${k}.example.com`} value={f[`${k}Host`]} onChange={set(`${k}Host`)} />
                  <div className="flex items-center gap-3">
                    <input className="input w-24" type="number" value={f[`${k}Port`]} onChange={set(`${k}Port`)} />
                    <label className="flex items-center gap-1.5 text-sm text-ink-600"><input type="checkbox" checked={f[`${k}Secure`]} onChange={set(`${k}Secure`)} /> SSL/TLS</label>
                  </div>
                </div>
              ))}
            </div>
          )}
          {test && (
            <div className="rounded-lg border border-ink-200 p-3 space-y-1.5 text-sm">
              {(["smtp", "imap"] as const).map((k) => (
                <div key={k} className="flex items-start gap-2">
                  {test[k].ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" /> : <XCircle size={16} className="text-red-600 mt-0.5" />}
                  <span><b className="uppercase">{k}</b> {test[k].ok ? "connected" : test[k].error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

interface Guide { title: string; mark: ReactNode; heading?: string; intro?: string; steps: ReactNode[]; help?: { href: string; text: string } }
type GuideProvider = "google" | "microsoft";

const PROVIDER_GUIDES: Record<GuideProvider, Guide> = {
  google: {
    title: "Connect a Google mailbox",
    mark: <GmailMark />,
    intro: "Connect a Gmail or Google Workspace mailbox. You'll sign in with Google and approve access to send and read email for that mailbox. If your Workspace restricts third-party apps, your admin may need to allow this app first.",
    steps: [],
  },
  microsoft: {
    title: "Connect a new Outlook account",
    mark: <MicrosoftMark />,
    heading: "Enable SMTP to access your Outlook workspace",
    steps: [
      <>Open the <a className="text-brand-700 underline" href="https://admin.microsoft.com" target="_blank" rel="noreferrer">Microsoft 365 admin center</a> and go to Users &gt; Active users.</>,
      <>Select the user, and in the right panel that appears, click Mail.</>,
      <>In the Email apps section, click Manage email apps.</>,
      <>Verify the Authenticated SMTP setting: unchecked = disabled, checked = enabled. It has to be enabled.</>,
      <>When you're finished, click Save changes.</>,
      <>Now you are ready to authenticate, click the "Login" button below.</>,
    ],
    help: { href: "https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission", text: "For more detailed instructions follow Microsoft's guide." },
  },
};

function ProviderGuideModal({ provider, busy, onClose, onLogin }: { provider: GuideProvider; busy: boolean; onClose: () => void; onLogin: () => void }) {
  const g = PROVIDER_GUIDES[provider];
  return (
    <Modal open onClose={onClose} title={g.title} icon={g.mark} footer={
      <button className="btn-primary w-full h-11" disabled={busy} onClick={onLogin}>{busy ? "Redirecting…" : "Login"}</button>
    }>
      <div className="space-y-4 text-[15px] text-ink-700">
        {g.heading && <p className="font-semibold text-ink-900">{g.heading}</p>}
        {g.intro && <p className="leading-relaxed">{g.intro}</p>}
        {g.steps.length > 0 && <ol className="space-y-4">{g.steps.map((step, i) => <li key={i}>{i + 1}. {step}</li>)}</ol>}
        {g.help && <a className="block text-brand-700 underline" href={g.help.href} target="_blank" rel="noreferrer">{g.help.text}</a>}
      </div>
    </Modal>
  );
}

const BULK_SAMPLE = [
  "email,from_name,password,smtp_host,smtp_port,imap_host,imap_port,daily_limit,username",
  "alex@yourdomain.com,Alex Morgan,app-password-here,smtp.yourhost.com,465,imap.yourhost.com,993,30,",
  "sam@yourdomain.com,Sam Lee,app-password-here,smtp.yourhost.com,587,imap.yourhost.com,993,30,",
].join("\n");

function downloadSample() {
  const url = URL.createObjectURL(new Blob([BULK_SAMPLE], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "bulk-mailboxes-sample.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function ChooserRow({ icon, title, sub, onClick, right }: { icon: ReactNode; title: string; sub?: string; onClick?: () => void; right?: ReactNode }) {
  const inner = (
    <>
      <span className="w-5 grid place-items-center shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] text-ink-900">{title}</span>
        {sub && <span className="block text-xs text-ink-500">{sub}</span>}
      </span>
      {right ?? <ChevronRight size={18} className="text-ink-400" />}
    </>
  );
  return onClick
    ? <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-50" onClick={onClick}>{inner}</button>
    : <div className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5">{inner}</div>;
}

function BulkResultModal({ result, onClose }: { result: { connected: number; failed: number; results: { row: number; email: string; ok: boolean; error?: string }[] }; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Bulk connect results" footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <p className="text-sm mb-3"><b className="text-emerald-700">{result.connected} connected</b>{result.failed > 0 && <> · <b className="text-red-600">{result.failed} failed</b></>}</p>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
        {result.results.map((r) => (
          <div key={r.row} className="flex items-start gap-2 px-3 py-2 text-sm">
            {r.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : <XCircle size={16} className="text-red-600 mt-0.5 shrink-0" />}
            <div className="min-w-0"><div className="truncate">Row {r.row}: {r.email || "(no email)"}</div>{r.error && <div className="text-xs text-red-600 break-words">{r.error}</div>}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ProfileList({ onEdit }: { onEdit: (p: SenderProfile) => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/sender-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sender-profiles", ws] }),
    onError: (e: Error) => toast(e.message, "error"),
  });
  if (list.isLoading) return <Spinner />;
  return (
    <div className="card overflow-hidden">
      {!list.data?.length ? (
        <Empty icon={<Send size={20} />} title="No rotations yet" text="A rotation groups mailboxes. Sequences send from a rotation and take turns across its mailboxes, within each mailbox's daily limit." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Rotation</th><th className="th">Emails sent today</th><th className="th">Mailboxes</th><th className="th" /></tr></thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium text-ink-800">{p.name}</td>
                  <td className="td">{p.sentToday} / {p.dailyCap}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{p.mailboxes.slice(0, 4).map((m) => <span key={m.id} className="chip bg-ink-100 text-ink-600">{m.email}</span>)}{p.mailboxes.length > 4 && <span className="chip bg-ink-100 text-ink-600">+{p.mailboxes.length - 4}</span>}</div></td>
                  <td className="td"><div className="flex justify-end gap-1"><button className="btn-ghost btn-sm" onClick={() => onEdit(p)}>Edit</button><button className="btn-ghost btn-sm" onClick={() => confirm(`Delete ${p.name}?`) && del.mutate(p.id)}><Trash2 size={14} /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProfileModal({ ws, profile, onClose }: { ws: string; profile: SenderProfile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const [name, setName] = useState(profile?.name ?? "");
  const [ids, setIds] = useState<string[]>(profile?.mailboxes.map((m) => m.id) ?? []);
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/sender-profiles${profile ? `/${profile.id}` : ""}`, { method: profile ? "PATCH" : "POST", body: { name, mailboxIds: ids } }),
    onSuccess: () => { toast("Rotation saved"); qc.invalidateQueries({ queryKey: ["sender-profiles", ws] }); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title={profile ? "Edit rotation" : "Create rotation"} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!name.trim()} onClick={() => save.mutate()}>Save</button></>}>
      <div className="space-y-4">
        <div><label className="label">Rotation name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex (sales team)" autoFocus /></div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className="label mb-0">Mailboxes</span>
            <button className="text-xs text-brand-700" onClick={() => setIds((mailboxes.data ?? []).map((m) => m.id))}>Select all</button></div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
            {(mailboxes.data ?? []).map((m) => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
                <input type="checkbox" checked={ids.includes(m.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, m.id] : x.filter((y) => y !== m.id)))} />
                <span className="flex-1">{m.email}</span><span className="text-xs text-ink-400">{m.dailyLimit}/day</span>
              </label>
            ))}
            {!mailboxes.data?.length && <div className="p-3 text-sm text-ink-400">Connect a mailbox first.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
