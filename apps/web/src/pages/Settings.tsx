import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, ChevronDown, Copy, Download, HelpCircle, KeyRound, Plus, Search, Settings as SettingsIcon, Trash2, User as UserIcon, UserPlus, UserX, Webhook } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Paged } from "../api";
import { useMe, useWs } from "../App";
import { cx, Empty, fmtDate, Modal, PageHeader, Pager, PortalMenu, Spinner, Toggle, useToast } from "../ui";

type TabKey = "usage" | "team" | "integrations" | "dnc" | "api" | "notifications";

const TABS: { k: TabKey; label: string; help?: string }[] = [
  { k: "usage", label: "Usage", help: "Contacts, emails and mailboxes this workspace is using, plus workspace name and time zone." },
  { k: "team", label: "Users & Roles", help: "Who can access this workspace and what they can do." },
  { k: "integrations", label: "Integrations", help: "Connected services such as Google and Microsoft sign-in." },
  { k: "dnc", label: "DNC list", help: "Emails and domains that are never contacted." },
  { k: "api", label: "API & MCP" },
  { k: "notifications", label: "Notifications" },
];

export function SettingsPage() {
  const [params] = useSearchParams();
  const wanted = params.get("tab");
  const [tab, setTab] = useState<TabKey>(TABS.some((t) => t.k === wanted) ? (wanted as TabKey) : "team");
  return (
    <div>
      <PageHeader icon={<SettingsIcon size={18} />} title="Settings">
        {TABS.map((t) => (
          <button key={t.k} className={cx("tab flex items-center gap-1.5", tab === t.k && "tab-active")} onClick={() => setTab(t.k)}>
            {t.label}
            {t.help && <span title={t.help} className="text-ink-400 cursor-help"><HelpCircle size={14} /></span>}
          </button>
        ))}
      </PageHeader>
      <div className="p-4 md:p-8">
        {tab === "usage" && <UsageTab />}
        {tab === "team" && <TeamTab />}
        {tab === "integrations" && <IntegrationsTab onApiKey={() => setTab("api")} />}
        {tab === "dnc" && <DncTab />}
        {tab === "api" && <ApiTab />}
        {tab === "notifications" && <NotificationsTab />}
      </div>
    </div>
  );
}

function WorkspaceTab() {
  const ws = useWs();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const current = me.data?.workspaces.find((w) => w.slug === ws);
  const [name, setName] = useState(current?.name ?? "");
  const [timezone, setTimezone] = useState(current?.timezone ?? "UTC");
  const zones = useMemo(() => {
    try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
  }, []);
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}`, { method: "PATCH", body: { name, timezone } }),
    onSuccess: () => { toast("Workspace saved"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  return (
    <div className="card p-5 max-w-xl space-y-4">
      <div><label className="label">Workspace name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Default time zone for new sequences</label>
        <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select>
      </div>
      <div className="text-xs text-ink-500">Workspace URL: /{ws}</div>
      <button className="btn-primary" onClick={() => save.mutate()}>Save</button>
    </div>
  );
}

const ROLE_OPTIONS = [
  { v: "member", l: "Standard", d: "Sequences, contacts, mailboxes and Primebox" },
  { v: "primebox", l: "Primebox Only", d: "Can only read and answer replies in Primebox" },
  { v: "admin", l: "Admin", d: "Everything, including users and API keys" },
];
const roleLabel = (r: string) => ROLE_OPTIONS.find((o) => o.v === r)?.l ?? (r === "owner" ? "Owner" : r === "viewer" ? "Viewer" : r);

function RoleSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <PortalMenu
      trigger={
        <button className="w-full flex items-center justify-between rounded-lg px-3 h-10 text-sm hover:bg-ink-100">
          {roleLabel(value)} <ChevronDown size={18} className="text-ink-500" />
        </button>
      }
    >
      {(close) => ROLE_OPTIONS.map((r) => (
        <button key={r.v} className={cx("w-full flex items-center gap-2 rounded-md px-3 py-2.5 text-left hover:bg-ink-50", value === r.v && "bg-ink-50")}
          onClick={() => { close(); if (r.v !== value) onChange(r.v); }}>
          <span className="flex-1"><span className="block text-sm">{r.l}</span><span className="block text-xs text-ink-500">{r.d}</span></span>
          {value === r.v && <Check size={16} className="text-brand-600" />}
        </button>
      ))}
    </PortalMenu>
  );
}

function SectionHeader({ title, text, actions }: { title: string; text: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-ink-500 mt-0.5">{text}</p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function TeamTab() {
  const ws = useWs();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [modal, setModal] = useState<null | "existing" | "new">(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "member" });
  const myRole = me.data?.workspaces.find((w) => w.slug === ws)?.role;
  const canManage = myRole === "owner" || myRole === "admin";
  const members = useQuery({ queryKey: ["members", ws], queryFn: () => api<{ id: string; name: string; email: string; role: string }[]>(`/v1/workspaces/${ws}/members`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["members", ws] });
  const close = () => { setModal(null); setF({ name: "", email: "", password: "", role: "member" }); };
  const addExisting = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/members`, { body: { email: f.email, role: f.role } }),
    onSuccess: () => { toast("User added to the workspace"); close(); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const addNew = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/members/new`, { body: f }),
    onSuccess: () => { toast(`Account created for ${f.email}. Share their password with them securely.`); close(); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) => api(`/v1/workspaces/${ws}/members/${id}`, { method: "PATCH", body: { role } }),
    onSuccess: () => { toast("Role updated"); refresh(); },
    onError: (e: Error) => { toast(e.message, "error"); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/members/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("User removed"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div>
      <SectionHeader
        title="Workspace members"
        text="Manage your existing team and change roles/permissions."
        actions={canManage && <>
          <button className="btn-secondary h-10" onClick={() => setModal("existing")}><Plus size={16} /> Add existing users</button>
          <button className="btn-primary h-10" onClick={() => setModal("new")}><UserPlus size={16} /> Add new user</button>
        </>}
      />
      <div className="card overflow-hidden">
        {members.isLoading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th w-[30%]">Role</th><th className="th w-16" /></tr></thead>
              <tbody>{(members.data ?? []).map((m) => {
                const isMe = m.id === me.data?.user.id;
                const locked = !canManage || m.role === "owner" || isMe;
                return (
                  <tr key={m.id}>
                    <td className="td"><span className="flex items-center gap-2.5"><span className="grid place-items-center w-7 h-7 rounded-md border border-ink-200"><UserIcon size={15} /></span><span className="font-medium">{m.name}{isMe && <span className="text-ink-400 font-normal"> (you)</span>}</span></span></td>
                    <td className="td text-ink-500">{m.email}</td>
                    <td className="td">
                      {locked
                        ? <span className="block px-3 py-2">{roleLabel(m.role)}</span>
                        : <RoleSelect value={m.role} onChange={(role) => changeRole.mutate({ id: m.id, role })} />}
                    </td>
                    <td className="td text-center">{!locked && <button className="btn-ghost btn-sm" title="Remove from workspace" onClick={() => confirm(`Remove ${m.name} from this workspace?`) && remove.mutate(m.id)}><Trash2 size={16} /></button>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        {ROLE_OPTIONS.map((r) => <div key={r.v} className="text-xs text-ink-500"><b className="text-ink-700">{r.l}:</b> {r.d}</div>)}
      </div>

      {modal && (
        <Modal open onClose={close} title={modal === "new" ? "Add new user" : "Add existing users"}
          subtitle={modal === "new" ? "Create an account for a teammate and add them to this workspace." : "Add someone who already has an account."}
          icon={<UserPlus size={20} />}
          footer={<>
            <button className="btn-secondary" onClick={close}>Cancel</button>
            {modal === "new"
              ? <button className="btn-primary" disabled={!f.name.trim() || !f.email || f.password.length < 8 || addNew.isPending} onClick={() => addNew.mutate()}>Create user</button>
              : <button className="btn-primary" disabled={!f.email || addExisting.isPending} onClick={() => addExisting.mutate()}>Add user</button>}
          </>}>
          <div className="space-y-3">
            {modal === "new" && <div><label className="label">Full name</label><input className="input" value={f.name} onChange={set("name")} autoFocus /></div>}
            <div><label className="label">Email</label><input className="input" type="email" value={f.email} onChange={set("email")} autoFocus={modal === "existing"} /></div>
            {modal === "new" && (
              <div><label className="label">Temporary password</label><input className="input" type="text" value={f.password} onChange={set("password")} placeholder="At least 8 characters" />
                <p className="text-xs text-ink-500 mt-1">Share it with them privately. They log in with this email and password.</p></div>
            )}
            <div><label className="label">Role</label>
              <select className="input" value={f.role} onChange={set("role")}>{ROLE_OPTIONS.map((r) => <option key={r.v} value={r.v}>{r.l} — {r.d}</option>)}</select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Meter({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-ink-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value.toLocaleString()}</div>
      {sub && <div className="text-xs text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function UsageTab() {
  const ws = useWs();
  const u = useQuery({ queryKey: ["usage", ws], queryFn: () => api<Record<string, number>>(`/v1/workspaces/${ws}/usage`) });
  return (
    <div className="space-y-8">
      <div>
        <SectionHeader title="Usage" text="What this workspace is using right now." />
        {u.isLoading || !u.data ? <Spinner /> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Meter label="Active contacts" value={u.data.active_contacts ?? 0} sub={`${(u.data.contacts ?? 0).toLocaleString()} contacts in total`} />
            <Meter label="Emails this month" value={u.data.emails_this_month ?? 0} sub={`${u.data.emails_24h ?? 0} in the last 24 hours`} />
            <Meter label="Mailboxes" value={u.data.active_mailboxes ?? 0} sub={`active of ${u.data.mailboxes ?? 0} · ${u.data.daily_capacity ?? 0} emails/day capacity`} />
            <Meter label="Sequences" value={u.data.active_sequences ?? 0} sub={`active of ${u.data.sequences ?? 0} · ${u.data.members ?? 0} members`} />
          </div>
        )}
      </div>
      <div>
        <SectionHeader title="Workspace" text="Name and default time zone for new sequences." />
        <WorkspaceTab />
      </div>
    </div>
  );
}

const WEBHOOK_EVENTS = [
  { v: "reply.received", l: "Reply received" }, { v: "label.changed", l: "Label changed" }, { v: "email.sent", l: "Email sent" },
  { v: "contact.bounced", l: "Contact bounced" }, { v: "contact.unsubscribed", l: "Contact unsubscribed" }, { v: "sequence.completed", l: "Sequence completed" },
];

type Integration = {
  name: string; color: string; text: string;
  action: "soon" | "api_key" | "slack" | "webhook"; badge?: string;
};

function IntegrationCard({ i, onAction }: { i: Integration; onAction: (i: Integration) => void }) {
  return (
    <div className="card flex flex-col">
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="grid place-items-center w-8 h-8 rounded-lg text-white text-sm font-bold shrink-0" style={{ background: i.color }}>{i.name[0]}</span>
          <span className="font-semibold flex-1 truncate">{i.name}</span>
          {i.badge && <span className="chip bg-emerald-50 text-emerald-700 border border-emerald-200">{i.badge}</span>}
        </div>
        <p className="text-xs text-ink-500 leading-relaxed">{i.text}</p>
      </div>
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ink-100">
        {i.action === "soon" && <button className="btn-secondary btn-sm" disabled title="Not available yet — use Webhooks or the API meanwhile">Coming soon</button>}
        {i.action === "api_key" && <button className="btn-primary btn-sm" onClick={() => onAction(i)}>Get API Key</button>}
        {i.action === "slack" && <button className="btn-primary btn-sm" onClick={() => onAction(i)}>Connect</button>}
        {i.action === "webhook" && <button className="btn-primary btn-sm" onClick={() => onAction(i)}>Add webhook</button>}
      </div>
    </div>
  );
}

function IntegrationsTab({ onApiKey }: { onApiKey: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const hooks = useQuery({ queryKey: ["webhooks", ws], queryFn: () => api<{ id: string; name: string; url: string; kind: string; events: string[]; lastStatus: number | null; lastError: string | null; lastAt: string | null }[]>(`/v1/workspaces/${ws}/webhooks`) });
  const [modal, setModal] = useState<null | "slack" | "webhook">(null);
  const [form, setForm] = useState({ name: "", url: "", events: ["reply.received"] as string[] });
  const [secret, setSecret] = useState<string | null>(null);
  const slackConnected = (hooks.data ?? []).some((h) => h.kind === "slack");

  const create = useMutation({
    mutationFn: () => api<{ secret?: string }>(`/v1/workspaces/${ws}/webhooks`, {
      body: { name: form.name || (modal === "slack" ? "Slack" : "Webhook"), url: form.url, kind: modal === "slack" ? "slack" : "generic", events: form.events },
    }),
    onSuccess: (r) => {
      toast(modal === "slack" ? "Slack connected" : "Webhook added");
      setModal(null);
      setForm({ name: "", url: "", events: ["reply.received"] });
      if (r.secret) setSecret(r.secret);
      qc.invalidateQueries({ queryKey: ["webhooks", ws] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const test = useMutation({
    mutationFn: (id: string) => api<{ status: number | null; error: string | null }>(`/v1/workspaces/${ws}/webhooks/${id}/test`, { body: {} }),
    onSuccess: (r) => { toast(r.error ? `Test failed: ${r.error}` : `Test delivered (HTTP ${r.status})`, r.error ? "error" : "success"); qc.invalidateQueries({ queryKey: ["webhooks", ws] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", ws] }),
  });

  const act = (i: Integration) => {
    if (i.action === "api_key") return onApiKey();
    setForm({ name: i.action === "slack" ? "Slack" : "", url: "", events: i.action === "slack" ? ["reply.received", "label.changed"] : ["reply.received"] });
    setModal(i.action === "slack" ? "slack" : "webhook");
  };

  const sections: { title: string; items: Integration[] }[] = [
    {
      title: "CRM",
      items: [
        { name: "HubSpot", color: "#ff7a59", text: "Sync contacts and replies with your HubSpot CRM.", action: "soon" },
        { name: "Salesforce", color: "#00a1e0", text: "Sync leads who replied and track their activity.", action: "soon" },
        { name: "Pipedrive", color: "#1a1a1a", text: "Create deals in Pipedrive from positive replies.", action: "soon" },
        { name: "HighLevel", color: "#f5b700", text: "Push leads into HighLevel pipelines and sub-accounts.", action: "soon" },
        { name: "Breakcold", color: "#2563eb", text: "Combine email outreach with social selling.", action: "soon" },
        { name: "Attio", color: "#111827", text: "Keep Attio records in sync with outreach activity.", action: "soon" },
        { name: "Folk", color: "#4b5563", text: "Send contacts and replies to your Folk workspace.", action: "soon" },
      ],
    },
    {
      title: "Data",
      items: [
        { name: "Clay", color: "#2f80ed", text: "Push enriched leads from Clay into Maple MPSS with an HTTP request using your API key.", action: "api_key" },
        { name: "Bitscale", color: "#111827", text: "Send enriched lead data into your contacts through the API.", action: "api_key" },
        { name: "RB2B", color: "#0f172a", text: "Turn identified website visitors into contacts through the API.", action: "api_key" },
        { name: "Databar AI", color: "#4f46e5", text: "Enrich prospecting data and send it to Maple MPSS through the API.", action: "api_key" },
        { name: "Airscale", color: "#0ea5e9", text: "Add enriched lead data to your contacts through the API.", action: "api_key" },
        { name: "Sendspark", color: "#6366f1", text: "Use personalised video links as custom variables in your emails.", action: "api_key" },
      ],
    },
    {
      title: "Automation & Workflows",
      items: [
        { name: "Slack", color: "#4a154b", text: "Post new replies and label changes to a Slack channel.", action: "slack", badge: slackConnected ? "Connected" : undefined },
        { name: "Zapier", color: "#ff4a00", text: "Trigger Zaps from webhooks and call the API to connect thousands of apps.", action: "api_key" },
        { name: "Make", color: "#6d00cc", text: "Build Make scenarios with webhooks and the API.", action: "api_key" },
        { name: "Webhooks", color: "#64748b", text: "Send events (replies, labels, bounces, sends) to your own server.", action: "webhook" },
      ],
    },
  ];

  return (
    <div className="space-y-8">
      {sections.map((s) => (
        <div key={s.title}>
          <h2 className="text-sm font-semibold mb-3">{s.title}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
            {s.items.map((i) => <IntegrationCard key={i.name} i={i} onAction={act} />)}
          </div>
        </div>
      ))}

      <div>
        <SectionHeader title="Workspace webhooks" text="A list of all webhooks created for this workspace."
          actions={<button className="btn-primary h-10" onClick={() => act({ name: "Webhooks", color: "", text: "", action: "webhook" })}><Plus size={16} /> Add webhook</button>} />
        <div className="card overflow-hidden">
          {hooks.isLoading ? <Spinner /> : !hooks.data?.length ? (
            <Empty icon={<Webhook size={20} />} title="No webhooks yet" text="Webhooks send events to your server, Zapier, Make or Slack as they happen." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Webhook name</th><th className="th">Webhook URL</th><th className="th">Event type</th><th className="th">Last delivery</th><th className="th text-right">Actions</th></tr></thead>
                <tbody>{hooks.data.map((h) => (
                  <tr key={h.id}>
                    <td className="td font-medium">{h.name}{h.kind === "slack" && <span className="chip bg-ink-100 text-ink-600 ml-2">Slack</span>}</td>
                    <td className="td text-ink-500 max-w-[260px] truncate" title={h.url}>{h.kind === "slack" ? "hooks.slack.com/…" : h.url}</td>
                    <td className="td"><div className="flex flex-wrap gap-1">{h.events.map((e) => <span key={e} className="chip bg-ink-100 text-ink-600">{e}</span>)}</div></td>
                    <td className="td text-xs">{h.lastAt ? <span className={h.lastError ? "text-red-600" : "text-emerald-700"} title={h.lastError ?? undefined}>{h.lastError ? `Failed · ${h.lastError}` : `OK · ${fmtDate(h.lastAt, true)}`}</span> : <span className="text-ink-400">Never</span>}</td>
                    <td className="td text-right whitespace-nowrap">
                      <button className="btn-ghost btn-sm" onClick={() => test.mutate(h.id)} disabled={test.isPending}>Send test</button>
                      <button className="btn-ghost btn-sm" aria-label="Delete" onClick={() => confirm(`Delete webhook "${h.name}"?`) && remove.mutate(h.id)}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <Modal open onClose={() => setModal(null)} title={modal === "slack" ? "Connect Slack" : "Add webhook"} icon={<Webhook size={20} />} footer={<>
          <button className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn-primary" disabled={!form.url || !form.events.length || create.isPending} onClick={() => create.mutate()}>{modal === "slack" ? "Connect" : "Add webhook"}</button>
        </>}>
          <div className="space-y-4">
            {modal === "slack" ? (
              <p className="text-sm text-ink-600">In Slack, create an app with <b>Incoming Webhooks</b> turned on, add it to a channel, and paste the webhook URL here. New replies will be posted to that channel.</p>
            ) : (
              <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CRM sync" autoFocus /></div>
            )}
            <div>
              <label className="label">{modal === "slack" ? "Slack webhook URL" : "Endpoint URL"}</label>
              <input className="input" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={modal === "slack" ? "https://hooks.slack.com/services/…" : "https://your-server.com/webhooks/maple"} autoFocus={modal === "slack"} />
            </div>
            <div>
              <div className="label">Events</div>
              <div className="grid sm:grid-cols-2 gap-1.5">
                {WEBHOOK_EVENTS.filter((e) => modal !== "slack" || e.v !== "email.sent").map((e) => (
                  <label key={e.v} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.events.includes(e.v)} onChange={(ev) => setForm({ ...form, events: ev.target.checked ? [...form.events, e.v] : form.events.filter((x) => x !== e.v) })} /> {e.l}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Webhook signing secret" subtitle="It won't be shown again." icon={<KeyRound size={20} />} footer={<button className="btn-primary" onClick={() => setSecret(null)}>Done</button>}>
        <p className="text-sm text-ink-600 mb-3">Each request carries an <code>X-Webhook-Signature</code> header: <code>sha256=</code> HMAC of the raw body with this secret. Check it on your server to be sure the request came from Maple MPSS.</p>
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={secret ?? ""} onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(secret ?? ""); toast("Copied"); }}><Copy size={15} /> Copy</button>
        </div>
      </Modal>
    </div>
  );
}

function ApiTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ["api-keys", ws], queryFn: () => api<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; createdBy: string | null }[]>(`/v1/workspaces/${ws}/api-keys`) });
  const create = useMutation({
    mutationFn: () => api<{ key: string }>(`/v1/workspaces/${ws}/api-keys`, { body: { name } }),
    onSuccess: (r) => { setNewKey(r.key); setCreating(false); setName(""); qc.invalidateQueries({ queryKey: ["api-keys", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Key revoked"); qc.invalidateQueries({ queryKey: ["api-keys", ws] }); },
  });
  return (
    <div className="space-y-6">
      <div>
        <SectionHeader title="API keys" text="Use the REST API from your own tools. Keys act as an admin of this workspace only."
          actions={<button className="btn-primary h-10" onClick={() => setCreating(true)}><Plus size={16} /> Add new key</button>} />
        <div className="card overflow-hidden">
          {keys.isLoading ? <Spinner /> : !keys.data?.length ? (
            <Empty icon={<KeyRound size={20} />} title="No API keys" text="Create a key to call the API from scripts, Zapier or your CRM." />
          ) : (
            <table className="w-full">
              <thead><tr><th className="th">Key name</th><th className="th">Key</th><th className="th">Created</th><th className="th">Last used</th><th className="th" /></tr></thead>
              <tbody>{keys.data.map((k) => (
                <tr key={k.id}>
                  <td className="td font-medium">{k.name}{k.createdBy && <div className="text-xs font-normal text-ink-500">by {k.createdBy}</div>}</td>
                  <td className="td font-mono text-xs">{k.prefix}…</td>
                  <td className="td text-ink-500">{fmtDate(k.createdAt)}</td>
                  <td className="td text-ink-500">{k.lastUsedAt ? fmtDate(k.lastUsedAt, true) : "Never"}</td>
                  <td className="td text-right"><button className="btn-ghost btn-sm text-red-600" onClick={() => confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`) && revoke.mutate(k.id)}>Revoke</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card p-5">
        <div className="font-medium mb-1">Using the API</div>
        <p className="text-sm text-ink-500 mb-3">Send the key as a Bearer token. Every route is under your workspace:</p>
        <pre className="text-xs bg-ink-50 rounded-lg p-3 overflow-x-auto">{`curl ${location.origin}/v1/workspaces/${ws}/sequences \\
  -H "Authorization: Bearer mpk_…"`}</pre>
        <p className="text-sm text-ink-500 mt-3">MCP (letting AI assistants manage outreach) isn't available yet.</p>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add new key" icon={<KeyRound size={20} />} footer={<>
        <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create key</button>
      </>}>
        <label className="label">Key name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. HubSpot sync" />
      </Modal>
      <Modal open={!!newKey} onClose={() => setNewKey(null)} title="Copy your API key" subtitle="It won't be shown again." icon={<KeyRound size={20} />} footer={<button className="btn-primary" onClick={() => setNewKey(null)}>Done</button>}>
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={newKey ?? ""} onFocus={(e) => e.target.select()} />
          <button className="btn-secondary" onClick={() => { navigator.clipboard?.writeText(newKey ?? ""); toast("Copied"); }}><Copy size={15} /> Copy</button>
        </div>
      </Modal>
    </div>
  );
}

function NotificationsTab() {
  const toast = useToast();
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [pref, setPref] = useState(() => { try { return localStorage.getItem("notify-replies") === "1"; } catch { return false; } });
  const [perm, setPerm] = useState(supported ? Notification.permission : "denied");
  const toggle = async (on: boolean) => {
    if (on && supported && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== "granted") return toast("Your browser blocked notifications for this site", "error");
    }
    try { localStorage.setItem("notify-replies", on ? "1" : "0"); } catch { /* storage blocked */ }
    setPref(on);
  };
  return (
    <div>
      <SectionHeader title="Notifications" text="Get alerted when things need your attention." />
      <div className="card divide-y divide-ink-100">
        <div className="flex items-center gap-4 p-4">
          <div className="flex-1">
            <div className="font-medium">New reply in Primebox</div>
            <div className="text-sm text-ink-500">Desktop notification in this browser while the app is open.{!supported && " Not supported by this browser."}{supported && perm === "denied" && " Notifications are blocked in your browser settings."}</div>
          </div>
          <Toggle checked={pref && perm === "granted"} disabled={!supported} onChange={toggle} />
        </div>
        <div className="flex items-center gap-4 p-4">
          <div className="flex-1">
            <div className="font-medium">Mailbox disconnected</div>
            <div className="text-sm text-ink-500">Shown on the Senders & Mailboxes page with the reason and a reconnect option.</div>
          </div>
          <span className="chip bg-emerald-50 text-emerald-700">Always on</span>
        </div>
      </div>
    </div>
  );
}

function DncTab() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const list = useQuery({
    queryKey: ["dnc", ws, page, q],
    queryFn: () => api<Paged<{ id: string; type: string; value: string; source: string; createdAt: string }>>(`/v1/workspaces/${ws}/dnc?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });
  const add = useMutation({
    mutationFn: () => api<{ added: number }>(`/v1/workspaces/${ws}/dnc`, { body: { values } }),
    onSuccess: (r) => { toast(`${r.added} entries added`); setOpen(false); setValues(""); qc.invalidateQueries({ queryKey: ["dnc", ws] }); },
  });
  const del = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/dnc/delete`, { body: { ids: [...selected] } }),
    onSuccess: () => { toast(`Removed ${selected.size} entr${selected.size === 1 ? "y" : "ies"}`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["dnc", ws] }); },
  });
  const settings = useQuery({ queryKey: ["dnc-settings", ws], queryFn: () => api<{ mergeDnc: boolean; workspaceCount: number }>(`/v1/workspaces/${ws}/dnc/settings`) });
  const merge = useMutation({
    mutationFn: (v: boolean) => api(`/v1/workspaces/${ws}/dnc/settings`, { method: "PATCH", body: { mergeDnc: v } }),
    onSuccess: (_, v) => { toast(v ? "DNC lists merged across all workspaces" : "Each workspace now uses only its own DNC list"); qc.invalidateQueries({ queryKey: ["dnc-settings", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((d) => selected.has(d.id));
  const merged = settings.data?.mergeDnc ?? false;

  return (
    <div className="space-y-6">
      <div className="card flex items-center gap-4 p-4">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-ink-100 text-ink-600"><UserX size={18} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold">Merge all DNC lists</div>
          <div className="text-sm text-ink-500">Enable Do Not Contact (DNC) lists across all workspaces under this account.{settings.data && settings.data.workspaceCount < 2 && " You have one workspace, so this applies once you add another."}</div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <Toggle checked={merged} disabled={settings.isLoading || merge.isPending} onChange={(v) => merge.mutate(v)} /> {merged ? "On" : "Off"}
        </label>
      </div>

      <div>
        <SectionHeader title="Do Not Contact (DNC) list" text="Contacts and domains added within this workspace"
          actions={<>
            <a className="btn-secondary h-10" href={`/v1/workspaces/${ws}/dnc/export`}><Download size={15} /> Export DNC list</a>
            <button className="btn-primary h-10" onClick={() => setOpen(true)}><Plus size={16} /> Add DNC</button>
          </>} />
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-ink-100">
            <span className="font-semibold text-sm">{(list.data?.total ?? 0).toLocaleString()} DNCs</span>
            <div className="relative w-full sm:w-72">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" placeholder="Search..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <button className="btn-secondary ml-auto" disabled={!selected.size || del.isPending}
              onClick={() => confirm(`Remove ${selected.size} entr${selected.size === 1 ? "y" : "ies"} from the DNC list? They can be contacted again.`) && del.mutate()}>
              <Trash2 size={15} /> Bulk delete{selected.size ? ` (${selected.size})` : ""}
            </button>
          </div>
          {list.isLoading ? <Spinner /> : !items.length ? (
            <Empty icon={<Ban size={20} />} title={q ? "No matches" : "DNC list is empty"} text="Emails and domains here are never contacted. Unsubscribes and Primebox blocks are added automatically." />
          ) : (
            <>
              <table className="w-full">
                <thead><tr>
                  <th className="th w-10"><input type="checkbox" checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); items.forEach((d) => (e.target.checked ? n.add(d.id) : n.delete(d.id))); return n; })} /></th>
                  <th className="th w-40">DNC Type</th><th className="th">Value</th><th className="th">Source</th><th className="th">Added</th>
                </tr></thead>
                <tbody>{items.map((d) => (
                  <tr key={d.id} className={cx(selected.has(d.id) && "bg-brand-50/40")}>
                    <td className="td"><input type="checkbox" checked={selected.has(d.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(d.id) : n.delete(d.id); return n; })} /></td>
                    <td className="td capitalize">{d.type}</td>
                    <td className="td font-medium">{d.value}</td>
                    <td className="td text-ink-500 capitalize">{d.source.replace(/_/g, " ")}</td>
                    <td className="td text-ink-500">{fmtDate(d.createdAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
            </>
          )}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add DNC" icon={<Ban size={20} />} footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={!values.trim() || add.isPending} onClick={() => add.mutate()}>Add</button></>}>
        <label className="label">Emails or domains, one per line</label>
        <textarea className="textarea min-h-[160px]" value={values} onChange={(e) => setValues(e.target.value)} placeholder={"jane@competitor.com\ncompetitor.com"} />
        <p className="text-xs text-ink-500 mt-1.5">A domain blocks everyone at that company. Active sequences skip these contacts from the next send.</p>
      </Modal>
    </div>
  );
}
