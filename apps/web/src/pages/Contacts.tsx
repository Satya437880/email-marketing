import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Tag as TagIcon, Trash2, Upload, User as UserIcon, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type Contact, type Paged, type SequenceRow, type Tag } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, Modal, PageHeader, Pager, Spinner, Tab, useToast } from "../ui";

const FIELD_OPTIONS = [
  { v: "email", l: "Email" }, { v: "first_name", l: "First name" }, { v: "last_name", l: "Last name" }, { v: "title", l: "Job title" },
  { v: "company_name", l: "Company" }, { v: "linkedin_url", l: "LinkedIn URL" }, { v: "skip", l: "Don't import" },
];

export function ContactsPage() {
  const [tab, setTab] = useState<"contacts" | "tags">("contacts");
  const [importing, setImporting] = useState(false);
  const [single, setSingle] = useState(false);
  return (
    <div>
      <PageHeader icon={<Users size={18} />} title="Contacts" actions={<>
        <button className="btn-secondary" onClick={() => setSingle(true)}><Plus size={16} /> Add one</button>
        <button className="btn-primary" onClick={() => setImporting(true)}><Upload size={16} /> Import CSV</button>
      </>}>
        <Tab active={tab === "contacts"} onClick={() => setTab("contacts")}>Contacts</Tab>
        <Tab active={tab === "tags"} onClick={() => setTab("tags")}>Tags</Tab>
      </PageHeader>
      <div className="p-4 md:p-8">{tab === "contacts" ? <ContactList onImport={() => setImporting(true)} /> : <TagList />}</div>
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {single && <SingleContactModal onClose={() => setSingle(false)} />}
    </div>
  );
}

function ContactList({ onImport }: { onImport: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [esp, setEsp] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"tag" | "add_to_sequence" | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ page: String(page), ...(search && { q: search }), ...(tagId && { tagId }), ...(esp && { esp }) });
  const list = useQuery({ queryKey: ["contacts", ws, params.toString()], queryFn: () => api<Paged<Contact>>(`/v1/workspaces/${ws}/contacts?${params}`) });
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });

  const del = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "delete", ids: [...selected] } }),
    onSuccess: () => { toast(`${selected.size} contacts deleted`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["contacts", ws] }); },
  });

  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((c) => selected.has(c.id));

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-ink-100">
        <span className="text-sm text-ink-500">{(list.data?.total ?? 0).toLocaleString()} contacts</span>
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search name, email, company" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-auto" value={tagId} onChange={(e) => { setTagId(e.target.value); setPage(1); }}>
          <option value="">All tags</option>
          {(tags.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input w-auto" value={esp} onChange={(e) => { setEsp(e.target.value); setPage(1); }}>
          <option value="">Any ESP</option><option value="google">Google</option><option value="microsoft">Microsoft</option><option value="other">Other</option><option value="unknown">Unknown</option>
        </select>
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-brand-50 border-b border-brand-100 text-sm">
          <span className="font-medium text-brand-800">{selected.size} selected</span>
          <button className="btn-secondary btn-sm" onClick={() => setBulk("tag")}><TagIcon size={14} /> Tag</button>
          <button className="btn-secondary btn-sm" onClick={() => setBulk("add_to_sequence")}>Add to sequence</button>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm(`Delete ${selected.size} contacts?`) && del.mutate()}><Trash2 size={14} /> Delete</button>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {list.isLoading ? <Spinner /> : !items.length ? (
        <Empty icon={<Users size={20} />} title={search || tagId || esp ? "No matches" : "No contacts yet"} text="Import a CSV of leads. We dedupe by email, detect each contact's email provider and group them by company." action={<button className="btn-primary" onClick={onImport}><Upload size={16} /> Import CSV</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-10"><input type="checkbox" checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); items.forEach((c) => (e.target.checked ? n.add(c.id) : n.delete(c.id))); return n; })} /></th>
                <th className="th">Name</th><th className="th">Email</th><th className="th">ESP</th><th className="th">Company</th><th className="th">Title</th><th className="th">Tags</th><th className="th">Last contacted</th><th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className={cx(selected.has(c.id) && "bg-brand-50/40")}>
                  <td className="td"><input type="checkbox" checked={selected.has(c.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                  <td className="td font-medium text-ink-800">{`${c.firstName} ${c.lastName}`.trim() || "—"}{c.unsubscribedAt && <span className="chip bg-orange-50 text-orange-700 ml-2">Unsubscribed</span>}</td>
                  <td className="td text-ink-600">{c.email}{c.validationStatus === "invalid" && <span className="chip bg-red-50 text-red-700 ml-2">Bounced</span>}</td>
                  <td className="td"><span className="chip bg-ink-100 text-ink-600 capitalize">{c.esp}</span></td>
                  <td className="td">{c.companyName || "—"}</td>
                  <td className="td text-ink-600 max-w-[180px] truncate">{c.title || "—"}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{c.tags.map((t) => <span key={t.id} className="chip bg-brand-50 text-brand-700">{t.name}</span>)}</div></td>
                  <td className="td text-ink-500">{fmtDate(c.lastContactedAt)}</td>
                  <td className="td text-right"><button className="btn-ghost btn-sm" title="Edit contact" aria-label={`Edit ${c.email}`} onClick={() => setEditing(c)}><Pencil size={14} /> Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      {editing && <EditContactModal contact={editing} onClose={() => setEditing(null)} />}
      {bulk && <BulkModal action={bulk} ids={[...selected]} onClose={() => setBulk(null)} onDone={() => {
        setSelected(new Set());
        for (const key of ["contacts", "tags", "sequences", "sequence", "seq-contacts"]) qc.invalidateQueries({ queryKey: [key, ws] });
      }} />}
    </div>
  );
}

function BulkModal({ action, ids, onClose, onDone }: { action: "tag" | "add_to_sequence"; ids: string[]; onClose: () => void; onDone: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const [target, setTarget] = useState("");
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`), enabled: action === "tag" });
  const seqs = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`), enabled: action === "add_to_sequence" });
  const run = useMutation({
    mutationFn: () => api<{ affected: number; alreadyIn?: number }>(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action, ids, ...(action === "tag" ? { tagId: target } : { sequenceId: target }) } }),
    onSuccess: (r) => {
      if (action === "tag") toast(`Tagged ${r.affected} contact${r.affected === 1 ? "" : "s"}`);
      else toast([`Added ${r.affected} to the sequence`, r.alreadyIn ? `${r.alreadyIn} already in it` : ""].filter(Boolean).join(" · "));
      onDone();
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const options = action === "tag" ? (tags.data ?? []).map((t) => ({ id: t.id, name: t.name })) : (seqs.data ?? []).filter((s) => s.status !== "completed").map((s) => ({ id: s.id, name: s.name }));
  return (
    <Modal open onClose={onClose} title={action === "tag" ? "Tag contacts" : "Add to sequence"} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!target} onClick={() => run.mutate()}>Apply</button></>}>
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </Modal>
  );
}

const SAMPLE_CSV = [
  ["first_name", "last_name", "email", "linkedin_url"],
  ["Jordan", "Lee", "jordan.lee@northwind-example.com", "https://www.linkedin.com/in/jordanlee-example/"],
  ["Priya", "Shah", "priya@acme-example.io", "https://www.linkedin.com/in/priyashah-example/"],
  ["Marcus", "Brown", "marcus.b@contoso-example.com", "https://www.linkedin.com/in/marcusbrown-example/"],
  ["Elena", "García", "elena@globex-example.co", "https://www.linkedin.com/in/elenagarcia-example/"],
  ["Sam", "Okafor", "sam.okafor@initech-example.com", "https://www.linkedin.com/in/samokafor-example/"],
];

export function ImportModal({ onClose, onBack, sequenceId, source = "csv" }: { onClose: () => void; onBack?: () => void; sequenceId?: string; source?: "csv" | "google_sheet" }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ headers: string[]; sample: Record<string, string>[]; mapping: Record<string, string> } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [newTag, setNewTag] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [loadingSheet, setLoadingSheet] = useState(false);

  const load = async (text: string, name: string) => {
    setCsv(text);
    setFileName(name);
    setNewTag(name.replace(/\.csv$/i, "").slice(0, 60));
    try {
      const p = await api<NonNullable<typeof preview>>(`/v1/workspaces/${ws}/imports/preview`, { body: { csv: text } });
      if (!p.headers.length) return toast("The file looks empty — the first row must be column headers", "error");
      setPreview(p);
      setMapping(p.mapping);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const onFile = async (file: File) => load(await file.text(), file.name);
  const onSheet = async () => {
    setLoadingSheet(true);
    try {
      const r = await api<{ csv: string }>(`/v1/workspaces/${ws}/imports/google-sheet`, { body: { url: sheetUrl } });
      await load(r.csv, `Google Sheet ${new Date().toLocaleDateString()}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoadingSheet(false);
    }
  };

  const start = useMutation({
    mutationFn: () => api<{ id: string }>(`/v1/workspaces/${ws}/imports`, { body: { csv, mapping, newTag: newTag.trim() || undefined, sequenceId, source } }),
    onSuccess: (j) => setJobId(j.id),
    onError: (e: Error) => toast(e.message, "error"),
  });
  const job = useQuery({
    queryKey: ["import", ws, jobId],
    queryFn: () => api<{ status: string; total: number; inserted: number; updated: number; skipped: number; errors: { row: number; error: string }[] }>(`/v1/workspaces/${ws}/imports/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
  useEffect(() => {
    if (job.data?.status === "done") {
      for (const k of ["contacts", "tags", "seq-contacts", "sequence", "sequences"]) qc.invalidateQueries({ queryKey: [k, ws] });
    }
  }, [job.data?.status, qc, ws]);

  const hasEmail = Object.values(mapping).includes("email");
  const title = source === "google_sheet" ? "Import from Google Sheet" : "Add contacts";
  const csvExampleStep = source === "csv" && !preview && !jobId;
  const fileRef = useRef<HTMLInputElement>(null);

  const footer = jobId
    ? <button className="btn-primary" onClick={onClose}>Done</button>
    : csvExampleStep
      ? <div className="flex justify-between w-full">
          <button className="btn-secondary h-11 px-5" onClick={onBack ?? onClose}>Back</button>
          <button className="btn-primary h-11 px-5" onClick={() => fileRef.current?.click()}>Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }} />
        </div>
      : <>
          <button className="btn-secondary" onClick={preview ? () => setPreview(null) : (onBack ?? onClose)}>Back</button>
          <button className="btn-primary" disabled={!preview || !hasEmail || start.isPending} onClick={() => start.mutate()}>Import</button>
        </>;

  return (
    <Modal open onClose={onClose} title={title} icon={<UserIcon size={20} />} subtitle={sequenceId && !csvExampleStep ? "Imported contacts are added to this sequence." : undefined} wide={!csvExampleStep} footer={footer}>
      {jobId ? (
        <div className="text-center py-6">
          {job.data?.status === "running" || !job.data ? <><Spinner /><p className="text-sm text-ink-500">Importing… checking duplicates and email providers</p></> : (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">{job.data.status === "done" ? "Import finished" : "Import failed"}</h3>
              <p className="text-sm text-ink-600">{job.data.inserted} new · {job.data.updated} updated · {job.data.skipped} skipped</p>
              {!!job.data.errors.length && (
                <ul className="text-left text-xs text-red-700 bg-red-50 rounded-lg p-3 max-h-40 overflow-y-auto">{job.data.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.error}</li>)}</ul>
              )}
            </div>
          )}
        </div>
      ) : !preview && source === "google_sheet" ? (
        <div className="space-y-3">
          <label className="label">Google Sheets link</label>
          <div className="flex gap-2">
            <input className="input" value={sheetUrl} autoFocus onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" onKeyDown={(e) => e.key === "Enter" && sheetUrl && onSheet()} />
            <button className="btn-primary" disabled={!sheetUrl || loadingSheet} onClick={onSheet}>{loadingSheet ? "Loading…" : "Load sheet"}</button>
          </div>
          <p className="text-xs text-ink-500">The sheet must be shared as “Anyone with the link can view”. The first row must be column headers, and the tab in your link is the one imported.</p>
        </div>
      ) : !preview ? (
        <div>
          <h3 className="text-lg font-semibold">Example</h3>
          <p className="text-sm text-ink-500 mt-1 mb-4">Upload a CSV file with your contacts (max. 100,000). Here is a sample of how your CSV could look like.</p>
          <div className="overflow-x-auto rounded border border-ink-200 bg-[#fff] text-[#000]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#f3f3f3] text-[#555]">
                  <th className="w-8 border border-[#e2e2e2]" />
                  {["A", "B", "C", "D"].map((c) => <th key={c} className="border border-[#e2e2e2] font-normal py-0.5">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_CSV.map((row, i) => (
                  <tr key={i}>
                    <td className="bg-[#f3f3f3] text-[#555] text-center border border-[#e2e2e2]">{i + 1}</td>
                    {row.map((cell, j) => <td key={j} className="border border-[#e2e2e2] px-1.5 py-0.5 whitespace-nowrap">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-500 mt-3">Only an email column is required. Other columns (company, title, anything else) can be mapped next or kept as custom variables.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-ink-600"><b>{fileName}</b> — map each column. Unmapped columns become custom variables you can use as {"{{column_name}}"}.</div>
          <div className="overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full">
              <thead><tr><th className="th">Column</th><th className="th">Sample</th><th className="th">Import as</th></tr></thead>
              <tbody>
                {preview.headers.map((h) => (
                  <tr key={h}>
                    <td className="td font-medium">{h}</td>
                    <td className="td text-ink-500 max-w-[220px] truncate">{preview.sample[0]?.[h]}</td>
                    <td className="td">
                      <select className="input h-8" value={FIELD_OPTIONS.some((o) => o.v === mapping[h]) ? mapping[h] : "custom"} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value === "custom" ? h : e.target.value })}>
                        {FIELD_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                        <option value="custom">Custom variable ({h.toLowerCase().replace(/[\s-]+/g, "_")})</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!hasEmail && <div className="text-sm text-red-600">Map one column to Email.</div>}
          <div><label className="label">Tag these contacts</label><input className="input" value={newTag} onChange={(e) => setNewTag(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

export interface EditableContact { id: string; email: string; firstName: string; lastName: string; companyName: string; title?: string; linkedinUrl?: string; variables?: Record<string, string> }

// Change a contact's details. The email address stays fixed (it identifies the contact and its history).
export function EditContactModal({ contact, onClose }: { contact: EditableContact; onClose: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName, title: contact.title ?? "", linkedinUrl: contact.linkedinUrl ?? "" });
  const [vars, setVars] = useState<{ key: string; value: string }[]>(Object.entries(contact.variables ?? {}).map(([key, value]) => ({ key, value })));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/contacts/${contact.id}`, {
      method: "PATCH",
      body: {
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])),
        ...(contact.variables ? { variables: Object.fromEntries(vars.filter((v) => v.key.trim() && v.value.trim()).map((v) => [v.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), v.value.trim()])) } : {}),
      },
    }),
    onSuccess: () => {
      toast("Contact updated");
      for (const k of ["contacts", "seq-contacts", "sequence", "sequences"]) void qc.invalidateQueries({ queryKey: [k, ws] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title="Edit contact" icon={<UserIcon size={20} />} footer={
      <div className="grid grid-cols-2 gap-3 w-full">
        <button className="btn-secondary h-11" onClick={onClose}>Cancel</button>
        <button className="btn-primary h-11" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes"}</button>
      </div>
    }>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">First name</label><input className="input h-10" value={f.firstName} onChange={set("firstName")} autoFocus /></div>
          <div><label className="label">Last name</label><input className="input h-10" value={f.lastName} onChange={set("lastName")} /></div>
        </div>
        <div><label className="label">Email</label><input className="input h-10 bg-ink-100 text-ink-500" value={contact.email} readOnly aria-readonly title="The email address can't be changed" /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Company</label><input className="input h-10" value={f.companyName} onChange={set("companyName")} /></div>
          <div><label className="label">Job title</label><input className="input h-10" value={f.title} onChange={set("title")} /></div>
        </div>
        <div><label className="label">LinkedIn URL</label><input className="input h-10" value={f.linkedinUrl} onChange={set("linkedinUrl")} /></div>
        {contact.variables && (
          <div className="space-y-2">
            {vars.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input className="input h-10 w-40" placeholder="Variable name" value={v.key} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)))} />
                <input className="input h-10 flex-1" placeholder="Value" value={v.value} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
                <button type="button" className="btn-ghost" aria-label="Remove variable" onClick={() => setVars((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" className="flex items-center gap-2 text-sm font-medium text-brand-700 px-1" onClick={() => setVars((x) => [...x, { key: "", value: "" }])}><Plus size={16} /> Add custom variable</button>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function SingleContactModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const allTags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const [f, setF] = useState({ first_name: "", last_name: "", email: "", linkedin_url: "", company_name: "" });
  const [vars, setVars] = useState<{ key: string; value: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [tagQ, setTagQ] = useState("");
  const [tried, setTried] = useState(false);

  const emailOk = EMAIL_OK.test(f.email.trim());
  const valid = emailOk && chosen.length > 0;
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/contacts`, {
      body: {
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])),
        variables: Object.fromEntries(vars.filter((v) => v.key.trim() && v.value.trim()).map((v) => [v.key.trim(), v.value.trim()])),
        tags: chosen,
      },
    }),
    onSuccess: () => {
      toast("Contact saved");
      qc.invalidateQueries({ queryKey: ["contacts", ws] });
      qc.invalidateQueries({ queryKey: ["tags", ws] });
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const addTag = (name: string) => {
    const n = name.trim().slice(0, 60);
    if (n && !chosen.includes(n)) setChosen((c) => [...c, n]);
    setTagQ("");
  };
  const matches = (allTags.data ?? []).filter((t) => !chosen.includes(t.name) && t.name.toLowerCase().includes(tagQ.toLowerCase())).slice(0, 6);
  const exact = (allTags.data ?? []).some((t) => t.name.toLowerCase() === tagQ.trim().toLowerCase());

  return (
    <Modal open onClose={onClose} title="Add contact" icon={<UserIcon size={20} />} footer={
      <div className="grid grid-cols-2 gap-3 w-full">
        <button className="btn-secondary h-11" onClick={onClose}>Discard</button>
        <button className="btn-primary h-11" disabled={save.isPending} onClick={() => { setTried(true); if (valid) save.mutate(); }}>{save.isPending ? "Saving…" : "Save changes & Close"}</button>
      </div>
    }>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">First name</label><input className="input h-10" placeholder="First name" value={f.first_name} onChange={set("first_name")} autoFocus /></div>
          <div><label className="label">Last name</label><input className="input h-10" placeholder="Last name" value={f.last_name} onChange={set("last_name")} /></div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className={cx("input h-10", tried && !emailOk && "border-red-500")} type="email" placeholder="Email" value={f.email} onChange={set("email")} />
          {tried && !emailOk && <p className="text-xs text-red-600 mt-1">Enter a valid email address</p>}
        </div>
        <div><label className="label">LinkedIn URL</label><input className="input h-10" placeholder="LinkedIn URL" value={f.linkedin_url} onChange={set("linkedin_url")} /></div>
        <div><label className="label">Company</label><input className="input h-10" placeholder="Company" value={f.company_name} onChange={set("company_name")} /></div>

        {vars.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input className="input h-10 w-40" placeholder="Variable name" value={v.key} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)))} />
            <input className="input h-10 flex-1" placeholder="Value" value={v.value} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
            <button className="btn-ghost" aria-label="Remove variable" onClick={() => setVars((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
          </div>
        ))}
        <button className="flex items-center gap-2 text-sm font-medium text-brand-700 px-1" onClick={() => setVars((x) => [...x, { key: "", value: "" }])}><Plus size={16} /> Add custom variable</button>
        {vars.some((v) => v.key.trim()) && <p className="text-xs text-ink-500 -mt-2 px-1">Use them in emails as {vars.filter((v) => v.key.trim()).map((v) => `{{${v.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}}}`).join(", ")}</p>}

        <div className="border-t border-ink-100 pt-4">
          <div className="label">Tags</div>
          {chosen.length ? (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {chosen.map((t) => <span key={t} className="chip bg-brand-50 text-brand-700">{t}<button aria-label={`Remove ${t}`} onClick={() => setChosen((c) => c.filter((x) => x !== t))}><X size={12} /></button></span>)}
            </div>
          ) : <p className="text-sm text-ink-500 mb-2">No tags selected</p>}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className={cx("input h-10 pl-9", tried && !chosen.length && "border-red-500")} placeholder="Enter tag name" value={tagQ}
              onChange={(e) => setTagQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const existing = (allTags.data ?? []).find((t) => t.name.toLowerCase() === tagQ.trim().toLowerCase());
                addTag(existing?.name ?? tagQ);
              }} />
            {tagQ.trim() && (
              <div className="absolute left-0 right-0 top-11 z-10 card p-1 max-h-48 overflow-y-auto">
                {matches.map((t) => <button key={t.id} className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50" onClick={() => addTag(t.name)}>{t.name} <span className="text-xs text-ink-400">{t.contacts} contacts</span></button>)}
                {!exact && <button className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50 text-brand-700" onClick={() => addTag(tagQ)}><Plus size={13} className="inline mr-1" />Create “{tagQ.trim()}”</button>}
              </div>
            )}
          </div>
          <p className={cx("text-xs mt-1.5", tried && !chosen.length ? "text-red-600" : "text-ink-500")}>Tags are required</p>
        </div>
      </div>
    </Modal>
  );
}

function TagList() {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const create = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/tags`, { body: { name } }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["tags", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/v1/workspaces/${ws}/tags/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["tags", ws] }) });
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-2 p-4 border-b border-ink-100">
        <input className="input sm:w-64" placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()} />
        <button className="btn-primary" disabled={!name.trim()} onClick={() => create.mutate()}><Plus size={15} /> Add tag</button>
      </div>
      {tags.isLoading ? <Spinner /> : !tags.data?.length ? <Empty icon={<TagIcon size={20} />} title="No tags" text="Tags group contacts so you can add them to sequences together." /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Tag</th><th className="th">Contacts</th><th className="th">In sequences</th><th className="th" /></tr></thead>
            <tbody>
              {tags.data.map((t) => (
                <tr key={t.id}>
                  <td className="td font-medium"><span className="chip bg-brand-50 text-brand-700">{t.name}</span></td>
                  <td className="td">{t.contacts.toLocaleString()}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{t.sequences.map((s) => <span key={s.id} className="chip bg-ink-100 text-ink-600">{s.name} · {s.progress}%</span>)}{!t.sequences.length && <span className="text-ink-400 text-sm">—</span>}</div></td>
                  <td className="td text-right"><button className="btn-ghost btn-sm" onClick={() => confirm(`Delete tag ${t.name}? Contacts are kept.`) && del.mutate(t.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
