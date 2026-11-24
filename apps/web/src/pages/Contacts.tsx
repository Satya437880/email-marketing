import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HelpCircle, ListPlus, Pencil, Plus, Search, UserX, Tag as TagIcon, Trash2, Upload, User as UserIcon, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ContactFiltersButton, contactFiltersToParam, NO_CONTACT_FILTERS, type ContactFilterState } from "./ContactFilters";
import { api, type Contact, type Paged, type SequenceRow, type Tag } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, Modal, PageHeader, Pager, PortalMenu, Spinner, Tab, useToast } from "../ui";

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

// Columns of the contacts table. "Full Name" is always shown; the rest can be switched on and off with "Add column".
type ColKey = "email" | "esp" | "validation" | "company" | "location" | "linkedin" | "tags" | "variables" | "title" | "last" | "created";
const COLUMNS: { key: ColKey; label: string; hint?: string }[] = [
  { key: "email", label: "Email" }, { key: "esp", label: "ESP", hint: "Email service provider (Google, Microsoft…)" },
  { key: "validation", label: "Validation status" }, { key: "company", label: "Company" }, { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn" }, { key: "tags", label: "Tags" }, { key: "variables", label: "Variables" },
  { key: "title", label: "Job title" }, { key: "last", label: "Last contacted" }, { key: "created", label: "Created" },
];
const DEFAULT_COLS: ColKey[] = ["email", "esp", "validation", "company", "location", "linkedin", "tags", "variables"];
function loadCols(): ColKey[] {
  try {
    const v = JSON.parse(localStorage.getItem("contact-columns") ?? "null");
    if (Array.isArray(v)) return v.filter((k): k is ColKey => COLUMNS.some((c) => c.key === k));
  } catch { /* use the defaults */ }
  return DEFAULT_COLS;
}

function ContactList({ onImport }: { onImport: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ContactFilterState>(NO_CONTACT_FILTERS);
  const filterParam = contactFiltersToParam(filters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"tags" | "add_to_sequence" | null>(null);
  const [cols, setCols] = useState<ColKey[]>(loadCols);
  const toggleCol = (k: ColKey) => setCols((c) => {
    const next = c.includes(k) ? c.filter((x) => x !== k) : [...c, k];
    try { localStorage.setItem("contact-columns", JSON.stringify(next)); } catch { /* not saved */ }
    return next;
  });
  const show = (k: ColKey) => cols.includes(k);
  const [editing, setEditing] = useState<Contact | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ page: String(page), ...(search && { q: search }), ...(filterParam && { filters: filterParam }) });
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
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search name, email, company" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ContactFiltersButton ws={ws} value={filters} onChange={(f) => { setFilters(f); setPage(1); setSelected(new Set()); }} />
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-4 py-2 bg-brand-50 border-b border-brand-100 text-sm">
          <span className="font-medium text-brand-800 mr-2">{selected.size} selected</span>
          {selected.size === 1 && items.find((c) => selected.has(c.id)) && (
            <button className="grid place-items-center w-9 h-9 rounded-lg text-ink-700 hover:bg-white" title="Edit this contact" aria-label="Edit contact" onClick={() => setEditing(items.find((c) => selected.has(c.id)) ?? null)}><Pencil size={18} /></button>
          )}
          <button className="grid place-items-center w-9 h-9 rounded-lg text-ink-700 hover:bg-white" title="Add or remove tags" aria-label="Add or remove tags" onClick={() => setBulk("tags")}><TagIcon size={18} /></button>
          <button className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-ink-700 hover:bg-white" title="Add the selected contacts to a sequence" onClick={() => setBulk("add_to_sequence")}><ListPlus size={18} /> Add to sequence</button>
          <button className="grid place-items-center w-9 h-9 rounded-lg text-red-600 hover:bg-red-50" title="Delete the selected contacts" aria-label="Delete selected contacts" onClick={() => confirm(`Delete ${selected.size} contacts?`) && del.mutate()}><Trash2 size={18} /></button>
          <button className="grid place-items-center w-9 h-9 rounded-lg text-ink-500 hover:bg-white ml-auto" title="Clear selection" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X size={18} /></button>
        </div>
      )}
      {list.isLoading ? <Spinner /> : !items.length ? (
        <Empty icon={<Users size={20} />} title={search || filterParam ? "No matches" : "No contacts yet"} text="Import a CSV of leads. We dedupe by email, detect each contact's email provider and group them by company." action={<button className="btn-primary" onClick={onImport}><Upload size={16} /> Import CSV</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-10"><input type="checkbox" ref={(el) => { if (el) el.indeterminate = !allOnPage && items.some((c) => selected.has(c.id)); }} checked={allOnPage} onChange={(e) => setSelected((s) => { const n = new Set(s); items.forEach((c) => (e.target.checked ? n.add(c.id) : n.delete(c.id))); return n; })} /></th>
                <th className="th">Full Name</th>
                {COLUMNS.filter((c) => show(c.key)).map((c) => (
                  <th key={c.key} className="th whitespace-nowrap">{c.label}{c.hint && <span title={c.hint} className="inline-block align-middle ml-1 text-ink-400 cursor-help"><HelpCircle size={13} /></span>}</th>
                ))}
                <th className="th">
                  <PortalMenu align="right" width={220} className="inline-block" trigger={<button className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-800 hover:text-brand-700"><Plus size={15} /> Add column</button>}>
                    {() => (
                      <div className="py-1">
                        {COLUMNS.map((c) => (
                          <label key={c.key} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-pointer hover:bg-ink-50">
                            <input type="checkbox" checked={show(c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </PortalMenu>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const vars = Object.entries(c.variables ?? {}).filter(([k, v]) => k !== "location" && v);
                const validation = c.validationStatus || "unverified";
                return (
                  <tr key={c.id} className={cx("cursor-pointer hover:bg-ink-50/60", selected.has(c.id) && "bg-brand-50/40")} onClick={() => setEditing(c)}>
                    <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(c.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} /></td>
                    <td className="td font-medium text-ink-800 whitespace-nowrap">{`${c.firstName} ${c.lastName}`.trim() || "—"}{c.unsubscribedAt && <span className="chip bg-orange-50 text-orange-700 ml-2">Unsubscribed</span>}</td>
                    {show("email") && (
                      <td className="td text-ink-600" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="hover:text-brand-700 hover:underline text-left" title="Click to copy this email address" onClick={async () => {
                          try { await navigator.clipboard.writeText(c.email); toast(`Copied ${c.email}`); } catch { toast("Could not copy. Select the address and copy it by hand.", "error"); }
                        }}>{c.email}</button>
                      </td>
                    )}
                    {show("esp") && <td className="td"><span className="chip bg-ink-100 text-ink-600 capitalize">{c.esp}</span></td>}
                    {show("validation") && <td className="td"><span className={cx("chip capitalize", validation === "valid" ? "bg-emerald-50 text-emerald-700" : validation === "invalid" ? "bg-red-50 text-red-700" : "bg-ink-100 text-ink-600")}>{validation === "invalid" ? "Bounced" : validation}</span></td>}
                    {show("company") && <td className="td">{c.companyName || "—"}</td>}
                    {show("location") && <td className="td text-ink-600">{c.variables?.location || "—"}</td>}
                    {show("linkedin") && <td className="td" onClick={(e) => e.stopPropagation()}>{c.linkedinUrl ? <a className="text-brand-700 hover:underline" href={/^https?:\/\//i.test(c.linkedinUrl) ? c.linkedinUrl : `https://${c.linkedinUrl}`} target="_blank" rel="noreferrer noopener">Profile</a> : "—"}</td>}
                    {show("tags") && <td className="td"><div className="flex flex-wrap gap-1">{c.tags.map((t) => <span key={t.id} className="chip bg-brand-50 text-brand-700">{t.name}</span>)}</div></td>}
                    {show("variables") && <td className="td text-ink-600 max-w-[220px]">{vars.length ? <span className="block truncate" title={vars.map(([k, v]) => `${k}: ${v}`).join("\n")}>{vars.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")}{vars.length > 2 ? ` +${vars.length - 2}` : ""}</span> : "—"}</td>}
                    {show("title") && <td className="td text-ink-600 max-w-[180px] truncate">{c.title || "—"}</td>}
                    {show("last") && <td className="td text-ink-500">{fmtDate(c.lastContactedAt)}</td>}
                    {show("created") && <td className="td text-ink-500">{fmtDate(c.createdAt ?? null)}</td>}
                    <td className="td" />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      {editing && <EditContactModal contact={editing} onClose={() => setEditing(null)} />}
      {bulk && (() => {
        const done = () => {
          setSelected(new Set());
          for (const key of ["contacts", "tags", "sequences", "sequence", "seq-contacts"]) qc.invalidateQueries({ queryKey: [key, ws] });
        };
        return bulk === "tags"
          ? <TagsModal ids={[...selected]} onClose={() => setBulk(null)} onDone={done} />
          : <BulkModal action="add_to_sequence" ids={[...selected]} onClose={() => setBulk(null)} onDone={done} />;
      })()}
    </div>
  );
}

// "Modify tags to contact list": add tags to, and remove tags from, the selected contacts in one go.
function TagsModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<string[]>([]);
  const [addQ, setAddQ] = useState("");
  const [removeQ, setRemoveQ] = useState("");
  const all = tags.data ?? [];
  const lower = (x: string) => x.trim().toLowerCase();
  const addTag = (name: string) => {
    const n = name.trim().slice(0, 60);
    if (n && !toAdd.some((t) => lower(t) === lower(n)) && toAdd.length < 20) setToAdd([...toAdd, n]);
    setAddQ("");
  };
  const addMatches = all.filter((t) => addQ.trim() && lower(t.name).includes(lower(addQ)) && !toAdd.some((x) => lower(x) === lower(t.name))).slice(0, 5);
  const removeMatches = all.filter((t) => lower(t.name).includes(lower(removeQ)) && !toRemove.includes(t.id)).slice(0, 6);

  const run = useMutation({
    mutationFn: async () => {
      for (const name of toAdd) {
        const existing = all.find((t) => lower(t.name) === lower(name));
        const id = existing ? existing.id : (await api<Tag>(`/v1/workspaces/${ws}/tags`, { body: { name } })).id;
        await api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "tag", ids, tagId: id } });
      }
      for (const id of toRemove) await api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "untag", ids, tagId: id } });
    },
    onSuccess: () => {
      toast([toAdd.length && `Added ${toAdd.length} tag${toAdd.length === 1 ? "" : "s"}`, toRemove.length && `removed ${toRemove.length}`].filter(Boolean).join(", ") + ` · ${ids.length} contact${ids.length === 1 ? "" : "s"}`);
      onDone();
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const chip = (label: string, onX: () => void) => (
    <span key={label} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 text-sm pl-3 pr-1.5 h-7">{label}<button className="grid place-items-center w-5 h-5 rounded-full hover:bg-brand-100" aria-label={`Remove ${label}`} onClick={onX}><X size={13} /></button></span>
  );

  return (
    <Modal open onClose={onClose} title="Modify tags to contact list" subtitle={`${ids.length} selected contact${ids.length === 1 ? "" : "s"}`} icon={<TagIcon size={20} />}
      footer={<button className="btn-primary w-full h-12 text-[15px]" disabled={(!toAdd.length && !toRemove.length) || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Working…" : "Modify tags & Close"}</button>}>
      <div>
        <h3 className="text-[15px] font-semibold text-ink-800">Contact tags to add</h3>
        <p className="text-sm text-ink-500 mb-3">Add a tag to selected contacts</p>
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input className="input h-12 pl-10 rounded-xl" placeholder="Type and press 'Enter'" maxLength={60} value={addQ} onChange={(e) => setAddQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const exact = all.find((t) => lower(t.name) === lower(addQ)); addTag(exact?.name ?? addQ); } }} />
          {!!addMatches.length && (
            <div className="absolute left-0 right-0 top-14 z-10 card p-1.5">
              {addMatches.map((t) => <button key={t.id} className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50" onClick={() => addTag(t.name)}>{t.name} <span className="text-xs text-ink-400">{t.contacts} contacts</span></button>)}
            </div>
          )}
        </div>
        {!!toAdd.length && <div className="flex flex-wrap gap-1.5 mt-2.5">{toAdd.map((t) => chip(t, () => setToAdd(toAdd.filter((x) => x !== t))))}</div>}
        <p className="text-sm text-ink-500 mt-2.5">Later you can select which contact list will be executed on a sequence level based on the tags</p>
      </div>
      <div className="border-t border-ink-100 mt-5 pt-5">
        <h3 className="text-[15px] font-semibold text-ink-800">Contact tags to remove</h3>
        <p className="text-sm text-ink-500 mb-3">Remove a tag from selected contacts</p>
        <div className="relative">
          <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
          <input className="input h-12 pl-10 rounded-xl" placeholder="Search" value={removeQ} onChange={(e) => setRemoveQ(e.target.value)} />
          {removeQ.trim() && (
            <div className="absolute left-0 right-0 top-14 z-10 card p-1.5">
              {!removeMatches.length ? <div className="px-2.5 py-1.5 text-sm text-ink-400">No tags found</div> : removeMatches.map((t) => (
                <button key={t.id} className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50" onClick={() => { setToRemove([...toRemove, t.id]); setRemoveQ(""); }}>{t.name}</button>
              ))}
            </div>
          )}
        </div>
        {!!toRemove.length && <div className="flex flex-wrap gap-1.5 mt-2.5">{toRemove.map((id) => chip(all.find((t) => t.id === id)?.name ?? "tag", () => setToRemove(toRemove.filter((x) => x !== id))))}</div>}
        <p className="text-sm text-ink-500 mt-2.5">Tags will be removed if found in selected lists</p>
      </div>
    </Modal>
  );
}

function BulkModal({ action, ids, onClose, onDone }: { action: "tag" | "untag" | "add_to_sequence"; ids: string[]; onClose: () => void; onDone: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const [target, setTarget] = useState("");
  // Tagging can also create a new tag: type a name and it is made (or reused if it already exists) and given to the selected contacts.
  const [newName, setNewName] = useState("");
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`), enabled: action !== "add_to_sequence" });
  const seqs = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`), enabled: action === "add_to_sequence" });
  const run = useMutation({
    mutationFn: async () => {
      let tagId = target;
      const typed = newName.trim();
      if (action === "tag" && typed) {
        const existing = (tags.data ?? []).find((t) => t.name.toLowerCase() === typed.toLowerCase());
        tagId = existing ? existing.id : (await api<Tag>(`/v1/workspaces/${ws}/tags`, { body: { name: typed } })).id;
      }
      return api<{ affected: number; alreadyIn?: number }>(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action, ids, ...(action !== "add_to_sequence" ? { tagId } : { sequenceId: target }) } });
    },
    onSuccess: (r) => {
      if (action === "tag") toast(`Tagged ${r.affected} contact${r.affected === 1 ? "" : "s"}`);
      else if (action === "untag") toast(`Removed the tag from ${r.affected} contact${r.affected === 1 ? "" : "s"}`);
      else toast([`Added ${r.affected} to the sequence`, r.alreadyIn ? `${r.alreadyIn} already in it` : ""].filter(Boolean).join(" · "));
      onDone();
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const options = action !== "add_to_sequence" ? (tags.data ?? []).map((t) => ({ id: t.id, name: t.name })) : (seqs.data ?? []).map((s) => ({ id: s.id, name: s.status === "completed" ? `${s.name} (completed, will start again)` : s.name }));
  return (
    <Modal open onClose={onClose} title={action === "tag" ? "Tag contacts" : action === "untag" ? "Remove a tag from contacts" : "Add to sequence"} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={(!target && !(action === "tag" && newName.trim())) || run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Applying…" : "Apply"}</button></>}>
      <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); if (e.target.value) setNewName(""); }}>
        <option value="">{action === "tag" ? "Choose an existing tag…" : "Choose…"}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {action === "tag" && (
        <div className="mt-4">
          <label className="label">Or create a new tag <span className="text-ink-400 font-normal">(type a name)</span></label>
          <input className="input" placeholder="e.g. Webinar leads" maxLength={60} value={newName} onChange={(e) => { setNewName(e.target.value); if (e.target.value) setTarget(""); }} onKeyDown={(e) => e.key === "Enter" && (target || newName.trim()) && run.mutate()} />
          <p className="text-xs text-ink-500 mt-1.5">{ids.length} selected contact{ids.length === 1 ? "" : "s"} will get this tag.</p>
        </div>
      )}
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
          <div><label className="label">Tag these contacts <span className="text-ink-400 font-normal">(optional, clear it to import without a tag)</span></label><input className="input" placeholder="No tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

export interface EditableContact { id: string; email: string; firstName: string; lastName: string; companyName: string; title?: string; linkedinUrl?: string; variables?: Record<string, string> }

type ContactDetails = Contact & { createdAt: string; sequences: { id: string; name: string; status: string; state: string }[] };

// The contact's details panel: edit the details, tags and custom variables, add them to the DNC list, or delete them.
// The email address stays fixed (it identifies the contact and its history).
export function EditContactModal({ contact, onClose }: { contact: EditableContact; onClose: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ["contact", ws, contact.id], queryFn: () => api<ContactDetails>(`/v1/workspaces/${ws}/contacts/${contact.id}`) });
  const allTags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const [f, setF] = useState({ firstName: contact.firstName, lastName: contact.lastName, companyName: contact.companyName, title: contact.title ?? "", linkedinUrl: contact.linkedinUrl ?? "" });
  // Location is kept as a custom variable called "location", so it can be used in emails too.
  const initialVars = Object.entries(contact.variables ?? {});
  const [location, setLocation] = useState(contact.variables?.location ?? "");
  const [vars, setVars] = useState<{ key: string; value: string }[]>(initialVars.filter(([k]) => k !== "location").map(([key, value]) => ({ key, value })));
  const [chosen, setChosen] = useState<{ id?: string; name: string }[] | null>(null);
  const [tagQ, setTagQ] = useState("");
  const [loadedFrom, setLoadedFrom] = useState(false);
  // Once the full details arrive, start the tag list and the variables from what is saved.
  useEffect(() => {
    if (!detail.data || loadedFrom) return;
    setLoadedFrom(true);
    setChosen(detail.data.tags.map((t) => ({ id: t.id, name: t.name })));
    const v = detail.data.variables ?? {};
    setLocation(v.location ?? "");
    setVars(Object.entries(v).filter(([k]) => k !== "location").map(([key, value]) => ({ key, value })));
    setF({ firstName: detail.data.firstName, lastName: detail.data.lastName, companyName: detail.data.companyName, title: detail.data.title ?? "", linkedinUrl: detail.data.linkedinUrl ?? "" });
  }, [detail.data, loadedFrom]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const lower = (x: string) => x.trim().toLowerCase();
  const tagList = chosen ?? [];
  const addTag = (name: string) => {
    const n = name.trim().slice(0, 60);
    if (n && !tagList.some((t) => lower(t.name) === lower(n)) && tagList.length < 20) {
      const existing = (allTags.data ?? []).find((t) => lower(t.name) === lower(n));
      setChosen([...tagList, { id: existing?.id, name: existing?.name ?? n }]);
    }
    setTagQ("");
  };
  const matches = (allTags.data ?? []).filter((t) => tagQ.trim() && lower(t.name).includes(lower(tagQ)) && !tagList.some((x) => lower(x.name) === lower(t.name))).slice(0, 5);

  const refresh = () => { for (const k of ["contacts", "contact", "tags", "seq-contacts", "sequence", "sequences"]) void qc.invalidateQueries({ queryKey: [k, ws] }); };

  const save = useMutation({
    mutationFn: async () => {
      const variables = Object.fromEntries([
        ...vars.filter((v) => v.key.trim() && v.value.trim()).map((v) => [v.key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"), v.value.trim()] as const),
        ...(location.trim() ? [["location", location.trim()] as const] : []),
      ]);
      await api(`/v1/workspaces/${ws}/contacts/${contact.id}`, { method: "PATCH", body: { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])), variables } });
      // Tags: add the new ones (created if needed) and take off the ones that were removed.
      const before = detail.data?.tags ?? [];
      for (const t of tagList.filter((t) => !before.some((b) => lower(b.name) === lower(t.name)))) {
        const id = t.id ?? (await api<Tag>(`/v1/workspaces/${ws}/tags`, { body: { name: t.name } })).id;
        await api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "tag", ids: [contact.id], tagId: id } });
      }
      for (const t of before.filter((b) => !tagList.some((x) => lower(x.name) === lower(b.name)))) {
        await api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "untag", ids: [contact.id], tagId: t.id } });
      }
    },
    onSuccess: () => { toast("Contact updated"); refresh(); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const dnc = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/dnc`, { body: { values: contact.email } }),
    onSuccess: () => { toast(`${contact.email} added to the Do not contact list`); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/contacts/bulk`, { body: { action: "delete", ids: [contact.id] } }),
    onSuccess: () => { toast("Contact deleted"); refresh(); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const name = `${f.firstName} ${f.lastName}`.trim() || contact.email;
  const seqs = detail.data?.sequences ?? [];
  const created = detail.data?.createdAt ? new Date(detail.data.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return (
    <Modal open onClose={onClose} title={name} subtitle={contact.email} icon={<UserIcon size={20} />} footer={
      <div className="grid grid-cols-2 gap-3 w-full">
        <button className="btn-secondary h-11" disabled={del.isPending} onClick={() => confirm(`Delete ${contact.email}? This removes them from every sequence.`) && del.mutate()}><Trash2 size={16} /> Delete contact</button>
        <button className="btn-primary h-11" disabled={save.isPending || !detail.data} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save changes & Close"}</button>
      </div>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-[130px_1fr] gap-y-2 text-sm items-center">
          <span className="text-ink-600">Current sequence</span>
          <span className="flex flex-wrap gap-1.5">{detail.isLoading ? "…" : seqs.length ? seqs.map((q) => <span key={q.id} className="chip bg-brand-50 text-brand-700 border border-brand-200">{q.name}</span>) : <span className="text-ink-400">Not in a sequence</span>}</span>
          <span className="text-ink-600">Created</span>
          <span className="text-ink-800">{created || "…"}</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">First name</label><input className="input h-10" value={f.firstName} onChange={set("firstName")} autoFocus /></div>
          <div><label className="label">Last name</label><input className="input h-10" value={f.lastName} onChange={set("lastName")} /></div>
        </div>
        <div><label className="label">LinkedIn URL</label><input className="input h-10" placeholder="LinkedIn URL" value={f.linkedinUrl} onChange={set("linkedinUrl")} /></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Company</label><input className="input h-10" value={f.companyName} onChange={set("companyName")} /></div>
          <div><label className="label">Job title</label><input className="input h-10" value={f.title} onChange={set("title")} /></div>
        </div>
        <div><label className="label">Location</label><input className="input h-10" placeholder="City, state, country…" value={location} onChange={(e) => setLocation(e.target.value)} /></div>

        <div>
          <div className="text-sm font-semibold text-ink-800 mb-2">Custom variables</div>
          <div className="space-y-3">
            {vars.map((v, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 mb-1">
                  <input className="text-sm text-ink-700 bg-transparent border-b border-transparent hover:border-ink-200 focus:border-brand-500 focus:outline-none" placeholder="Variable name" value={v.key} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, key: e.target.value } : y)))} />
                  <button type="button" className="ml-auto text-ink-400 hover:text-red-600" aria-label="Remove variable" onClick={() => setVars((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
                <textarea className="input min-h-[64px]" placeholder="Value" value={v.value} onChange={(e) => setVars((x) => x.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 flex items-center gap-2 text-sm font-medium text-brand-700" onClick={() => setVars((x) => [...x, { key: "", value: "" }])}><Plus size={16} /> Add custom variable</button>
        </div>

        <div className="border-t border-ink-100 pt-4">
          <div className="text-sm font-semibold text-ink-800 mb-2">Tags</div>
          {!!tagList.length && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tagList.map((t) => (
                <span key={t.name} className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-sm pl-3 pr-1.5 h-7">{t.name}
                  <button type="button" className="grid place-items-center w-5 h-5 rounded-full hover:bg-brand-100" aria-label={`Remove ${t.name}`} onClick={() => setChosen(tagList.filter((x) => x !== t))}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input className="input h-11 pl-10" placeholder="Enter tag name" maxLength={60} value={tagQ} onChange={(e) => setTagQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const ex = (allTags.data ?? []).find((t) => lower(t.name) === lower(tagQ)); addTag(ex?.name ?? tagQ); } }} />
            {!!matches.length && (
              <div className="absolute left-0 right-0 top-12 z-10 card p-1.5">
                {matches.map((t) => <button key={t.id} type="button" className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50" onClick={() => addTag(t.name)}>{t.name} <span className="text-xs text-ink-400">{t.contacts} contacts</span></button>)}
              </div>
            )}
          </div>
          <p className="text-xs text-ink-500 mt-1.5">Type a name and press Enter. Tags are saved when you click Save changes.</p>
        </div>

        <div className="border-t border-ink-100 pt-4">
          <div className="text-sm font-semibold text-ink-800">Do not contact list</div>
          <p className="text-sm text-ink-500 mb-2">Add this contact to the DNC list</p>
          <button type="button" className="btn-secondary" disabled={dnc.isPending} onClick={() => confirm(`Add ${contact.email} to the Do not contact list? No sequence will email them again.`) && dnc.mutate()}><UserX size={16} /> {dnc.isSuccess ? "Added to DNC" : "Add to DNC"}</button>
        </div>
      </div>
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
  const valid = emailOk;
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
            <input className={cx("input h-10 pl-9", "")} placeholder="Add a tag (optional)" value={tagQ}
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
          <p className="text-xs mt-1.5 text-ink-500">Tags are optional. You can skip this, or add or remove tags later.</p>
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
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const del = useMutation({
    mutationFn: (v: { id: string; withContacts: boolean }) => api<{ deletedContacts: number }>(`/v1/workspaces/${ws}/tags/${v.id}${v.withContacts ? "?withContacts=true" : ""}`, { method: "DELETE" }),
    onSuccess: (r, v) => {
      setDeleting(null);
      toast(v.withContacts ? `Tag and ${r.deletedContacts.toLocaleString()} contact${r.deletedContacts === 1 ? "" : "s"} deleted` : "Tag deleted. The contacts were kept.");
      for (const key of ["tags", "contacts", "sequences", "sequence", "seq-contacts"]) qc.invalidateQueries({ queryKey: [key, ws] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
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
                  <td className="td text-right"><button className="btn-ghost btn-sm" title="Delete this tag" aria-label={`Delete tag ${t.name}`} onClick={() => setDeleting(t)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={`Delete tag "${deleting.name}"`} icon={<Trash2 size={20} />}>
          <div className="grid gap-3">
            <button className="text-left rounded-lg border border-ink-200 p-3.5 hover:bg-ink-50 disabled:opacity-50" disabled={del.isPending} onClick={() => del.mutate({ id: deleting.id, withContacts: false })}>
              <div className="font-semibold text-ink-900">Delete tag only</div>
              <div className="text-sm text-ink-500">Removes the tag. The {deleting.contacts.toLocaleString()} contact{deleting.contacts === 1 ? "" : "s"} with this tag stay in your list.</div>
            </button>
            <button className="text-left rounded-lg border border-red-200 p-3.5 hover:bg-red-50 disabled:opacity-50" disabled={del.isPending}
              onClick={() => confirm(`Permanently delete the tag "${deleting.name}" AND its ${deleting.contacts.toLocaleString()} contact${deleting.contacts === 1 ? "" : "s"}? This cannot be undone.`) && del.mutate({ id: deleting.id, withContacts: true })}>
              <div className="font-semibold text-red-700">Delete tag with contacts</div>
              <div className="text-sm text-ink-500">Removes the tag and permanently deletes the {deleting.contacts.toLocaleString()} contact{deleting.contacts === 1 ? "" : "s"} that have it. This cannot be undone.</div>
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
