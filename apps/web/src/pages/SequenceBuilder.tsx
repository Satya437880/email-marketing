import { TimezoneSelect } from "../TimezoneSelect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Building2, CalendarClock, ChevronRight, Clock, DollarSign, Eye, FileText, Filter as Funnel, Forward, HelpCircle, Link2, Mail, MailOpen, MessageSquareReply,
  MousePointerClick, Pencil, Plus, Rocket, Save, Search, Send, Server, ShieldCheck, SlidersHorizontal, Trash2, Type, UserCheck, UserPlus, Users, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Contact, type Mailbox, type Paged, type SenderProfile, type SequenceDetail, type SequenceSettings, type Step, type Tag } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, fmtInZone, Modal, Pager, SafeHtml, Spinner, StatusPill, Toggle, useToast } from "../ui";
import { EditContactModal, ImportModal, type EditableContact } from "./Contacts";
import { SequenceOverview } from "./SequenceOverview";
import { StepBuilder } from "../StepBuilder";
import { NameServiceStep, Stepper, StepHeader, WIZARD_STEPS } from "./SequenceSteps";


// Launched sequences open on the overview (analytics and contacts); drafts and /edit open the editor.
export function SequenceBuilder() {
  const ws = useWs();
  const { id, "*": rest } = useParams();
  const seq = useQuery({ queryKey: ["sequence", ws, id], queryFn: () => api<SequenceDetail>(`/v1/workspaces/${ws}/sequences/${id}`) });
  if (seq.isLoading || !seq.data) return <Spinner />;
  if (rest !== "edit" && seq.data.status !== "draft") return <SequenceOverview sequence={seq.data} />;
  return <SequenceEditor />;
}

function SequenceEditor() {
  const ws = useWs();
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const seq = useQuery({ queryKey: ["sequence", ws, id], queryFn: () => api<SequenceDetail>(`/v1/workspaces/${ws}/sequences/${id}`) });
  const [steps, setSteps] = useState<Step[]>([]);
  const [dirty, setDirty] = useState(false);
  const settingsSave = useRef<SaveSettings | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  // Bumped by Discard so the editors and the settings form start over from what is saved.
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (seq.data && !dirty) {
      setSteps(seq.data.steps);
    }
  }, [seq.data, dirty]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["sequence", ws, id] });

  // Warn before closing the tab or reloading with unsaved changes.
  useEffect(() => {
    if (!dirty && !settingsDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, settingsDirty]);

  const saveSteps = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/sequences/${id}/steps`, {
      method: "PUT",
      body: { steps: steps.map((s) => ({ id: s.id, type: s.type, name: s.name, delayDays: s.delayDays, delayMinutes: s.delayMinutes, threadMode: s.threadMode ?? null, variants: s.variants.map((v) => ({ id: v.id, label: v.label, subject: v.subject, bodyHtml: v.bodyHtml, weight: v.weight, attachments: v.attachments ?? [] })) })) },
    }),
    onSuccess: () => { setDirty(false); toast("Sequence saved"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const action = useMutation({
    mutationFn: (a: "launch") => api(`/v1/workspaces/${ws}/sequences/${id}/${a}`, { body: {} }),
    onSuccess: (_, a) => { toast("Sequence launched — sending starts in the next send window"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (seq.isLoading || !seq.data) return <Spinner />;
  const s = seq.data;
  // One button saves whatever changed: the steps, and/or the Schedule and Settings.
  const updateSequence = async () => {
    if (dirty) saveSteps.mutate();
    if (settingsDirty && settingsSave.current) await settingsSave.current();
  };
  const discardChanges = () => {
    if (!confirm("Discard your unsaved changes? The sequence goes back to how it was last saved.")) return;
    if (dirty && seq.data) { setSteps(seq.data.steps); setDirty(false); }
    setResetKey((k) => k + 1);
  };
  const discardButton = <button className="btn-secondary h-10" onClick={discardChanges} disabled={saveSteps.isPending}>Discard changes</button>;
  // Leaving the Schedule or Settings screen saves any unsaved changes first.
  const go = async (n: number) => {
    if ((step === 3 || step === 4) && settingsSave.current && !(await settingsSave.current())) return;
    setStep(n);
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="bg-surface border-b border-ink-200 px-4 md:px-8 pt-5 pb-6">
        <div className="flex flex-wrap items-center gap-3 mb-7">
          <Link to={`/${ws}/sequences`} className="btn-ghost btn-sm" aria-label="Back to sequences"><ArrowLeft size={16} /></Link>
          <h1 className="text-2xl font-semibold flex-1 min-w-0 truncate">Sequence builder</h1>
          <span className="hidden sm:inline text-sm text-ink-500 truncate max-w-[260px]">{s.name}</span>
          <StatusPill status={s.status} />
          <div className="flex flex-wrap gap-2">
            {(dirty || settingsDirty) && discardButton}
            {(dirty || settingsDirty) && <button className="btn-primary h-10" onClick={() => void updateSequence()} disabled={saveSteps.isPending}>Update sequence</button>}
            {s.status === "draft" && <button className="btn-primary" disabled={dirty || action.isPending} title={dirty ? "Save first" : undefined} onClick={() => { if (confirm(`Launch "${s.name}"? Emails start going out in its next sending window to the ${s.contactCount.toLocaleString()} contact${s.contactCount === 1 ? "" : "s"} in it.`)) action.mutate("launch"); }}><Rocket size={15} /> Launch</button>}
          </div>
        </div>
        <Stepper step={step} onStep={(n) => void go(n)} />
      </div>

      <div className={cx("flex-1 p-4 md:p-8 w-full", step === 2 ? "max-w-[1800px]" : "max-w-6xl")}>
        {step === 0 && <NameServiceStep sequence={s} onSaved={refresh} />}
        {step === 1 && <>
          <StepHeader title="Contacts" help="Who receives this sequence." text={`${s.contactCount.toLocaleString()} contact${s.contactCount === 1 ? "" : "s"} in this sequence`} />
          <div className="mt-6"><ContactsTab sequenceId={s.id} onChange={refresh} /></div>
        </>}
        {step === 2 && <StepHeader title="Sequence steps" help="Add emails and the waits between them. Add variants to A/B test." text="Draft your sequence by adding steps and customizing them" />}
        {step === 2 && <div className="mt-6"><StepBuilder key={resetKey} steps={steps} onChange={(next) => { setSteps(next); setDirty(true); }} /></div>}

        {(step === 3 || step === 4) && <>
          {step === 3
            ? <StepHeader title="Schedule" help="The days and hours emails may be sent, in the time zone below." text="Activate the days on which emails should be sent out." />
            : <StepHeader title="Settings" help="Rotation, priorities and deliverability rules." text="Choose the mailboxes that send this sequence and how it behaves." />}
          {step === 4 && <section className="pt-6"><h3 className="text-sm font-semibold mb-3">Rotation</h3><SendersTab sequence={s} onChange={refresh} /></section>}
          <SettingsTab key={resetKey} sequence={s} onChange={refresh} section={step === 3 ? "schedule" : "settings"} registerSave={(fn) => { settingsSave.current = fn; }} onDirty={setSettingsDirty} />
        </>}

        <div className="flex items-center justify-between pt-8 mt-4 border-t border-ink-200">
          <button className="btn-secondary h-10" disabled={step === 0} onClick={() => void go(Math.max(0, step - 1))}>Back</button>
          {step < WIZARD_STEPS.length - 1
            ? <button className="btn-primary h-10" onClick={() => void go(Math.min(WIZARD_STEPS.length - 1, step + 1))}>Next: {WIZARD_STEPS[step + 1]!.label}</button>
            : <span className="text-sm text-ink-500">{s.status === "draft" ? "All set? Use Launch at the top." : ""}</span>}
        </div>
      </div>

    </div>
  );
}

export function ContactsTab({ sequenceId, onChange }: { sequenceId: string; onChange: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [state, setState] = useState("");
  const [engagement, setEngagement] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditableContact | null>(null);
  // Times are shown in the sequence's own time zone, not this computer's.
  const tz = useQuery({ queryKey: ["sequence", ws, sequenceId], queryFn: () => api<SequenceDetail>(`/v1/workspaces/${ws}/sequences/${sequenceId}`) }).data?.settings.schedule.timezone;

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  type Row = { id: string; state: string; currentStep: number; nextRunAt: string | null; lastError: string | null; sent: number; opened: number; clicked: number; replied: number; contact: { id: string; email: string; firstName: string; lastName: string; companyName: string; title: string; linkedinUrl: string } };
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const params = new URLSearchParams({ page: String(page) });
  if (term) params.set("q", term);
  if (state) params.set("state", state);
  if (engagement) params.set("engagement", engagement);
  if (mailboxId) params.set("mailboxId", mailboxId);
  const list = useQuery({
    queryKey: ["seq-contacts", ws, sequenceId, params.toString()],
    queryFn: () => api<Paged<Row>>(`/v1/workspaces/${ws}/sequences/${sequenceId}/contacts?${params}`),
  });
  const rows = list.data?.items ?? [];
  const activeFilters = [state, engagement, mailboxId].filter(Boolean).length;
  const allPicked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const refresh = () => {
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: ["seq-contacts", ws, sequenceId] });
    qc.invalidateQueries({ queryKey: ["sequences", ws] });
    onChange();
  };
  const onAdded = (r: { added: number; alreadyIn: number }) => {
    toast([`Added ${r.added} contact${r.added === 1 ? "" : "s"}`, r.alreadyIn ? `${r.alreadyIn} already in this sequence` : ""].filter(Boolean).join(" · "));
    setAdding(false);
    refresh();
  };
  const base = `/v1/workspaces/${ws}/sequences/${sequenceId}/contacts`;
  const resumeOoo = useMutation({
    mutationFn: (ids?: string[]) => api<{ resumed: number }>(`${base}/resume-ooo`, { body: { ids } }),
    onSuccess: (r) => { toast(r.resumed ? `Resumed ${r.resumed} out-of-office contact${r.resumed === 1 ? "" : "s"}` : "No out-of-office contacts to resume"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const retry = useMutation({
    mutationFn: (ids?: string[]) => api<{ retried: number }>(`${base}/retry-interrupted`, { body: { ids } }),
    onSuccess: (r) => { toast(r.retried ? `Retrying ${r.retried} interrupted contact${r.retried === 1 ? "" : "s"}` : "No interrupted contacts to retry"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api<{ removed: number }>(`${base}/remove`, { body: { ids } }),
    onSuccess: (r) => { toast(`Removed ${r.removed} contact${r.removed === 1 ? "" : "s"} from this sequence`); setSelected(new Set()); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const togglePage = () => setSelected(allPicked ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const num = (n: number) => (n > 0 ? n : <span className="text-ink-300">—</span>);

  return (
    <div className="card">
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-3 p-4">
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[9rem] sm:max-w-[22rem]">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-500" />
          <input className="input !h-11 !rounded-xl !pl-11 !text-[15px]" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="relative">
          <button className={cx("btn-secondary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold", activeFilters > 0 && "border-brand-500 text-brand-700")} onClick={() => setFilterOpen((o) => !o)}>
            <Funnel size={18} /> Filter{activeFilters > 0 && <span className="chip bg-brand-600 text-white ml-1">{activeFilters}</span>}
          </button>
          {filterOpen && (
            <div className="absolute z-30 left-0 mt-2 w-72 card p-4 space-y-3 shadow-lg">
              <div>
                <label className="label">Status</label>
                <select className="input" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
                  <option value="">All statuses</option>
                  {["queued", "active", "sending", "replied", "ooo", "bounced", "opted_out", "finished", "error"].map((s) => <option key={s} value={s}>{s === "ooo" ? "Out of office" : s === "error" ? "Interrupted" : s.replace("_", " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Engagement</label>
                <select className="input" value={engagement} onChange={(e) => { setEngagement(e.target.value); setPage(1); }}>
                  <option value="">Any</option>
                  <option value="opened">Opened</option>
                  <option value="not_opened">Not opened</option>
                  <option value="clicked">Clicked</option>
                  <option value="replied">Replied</option>
                </select>
              </div>
              <div>
                <label className="label">Mailbox</label>
                <select className="input" value={mailboxId} onChange={(e) => { setMailboxId(e.target.value); setPage(1); }}>
                  <option value="">All mailboxes</option>
                  {mailboxes.data?.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between pt-1">
                <button className="btn-ghost btn-sm" disabled={!activeFilters} onClick={() => { setState(""); setEngagement(""); setMailboxId(""); setPage(1); }}>Clear all</button>
                <button className="btn-primary btn-sm" onClick={() => setFilterOpen(false)}>Done</button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-2 ml-auto [&>button]:whitespace-nowrap [&>button]:shrink-0">
          <button className="btn-secondary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold" disabled={resumeOoo.isPending} onClick={() => resumeOoo.mutate(selected.size ? [...selected] : undefined)}>Resume all OOOs</button>
          <button className="btn-secondary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold" disabled={retry.isPending} onClick={() => retry.mutate(selected.size ? [...selected] : undefined)}>Retry interrupted contacts</button>
          <button className="btn-secondary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold" disabled={!rows.length} onClick={togglePage}>{allPicked ? "Deselect all" : "Select all"}</button>
          {selected.size > 0 && <button className="btn-secondary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold text-red-700" disabled={remove.isPending} onClick={() => remove.mutate([...selected])}>Remove ({selected.size})</button>}
          <button className="btn-primary !h-11 !rounded-xl !px-5 !text-[15px] !font-semibold" onClick={() => setAdding(true)}>Add contacts</button>
        </div>
      </div>
      {list.isLoading ? <Spinner /> : !rows.length ? (
        term || activeFilters
          ? <Empty icon={<Search size={20} />} title="No contacts match" text="Try a different search or clear the filters." action={<button className="btn-secondary" onClick={() => { setSearch(""); setState(""); setEngagement(""); setMailboxId(""); }}>Clear search and filters</button>} />
          : <Empty icon={<Users size={20} />} title="No contacts in this sequence" text="Add a single contact, pick existing ones, or import a CSV or Google Sheet." action={<button className="btn-primary" onClick={() => setAdding(true)}>Add contacts</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 border-r"><span className="inline-flex items-center gap-3"><input type="checkbox" className="w-5 h-5 rounded-md border-ink-300" aria-label="Select all on this page" checked={allPicked} onChange={togglePage} />Contact</span></th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 border-r"><span className="inline-flex items-center gap-1.5">Status <span title="Active: sending on schedule. Out of office: waiting for a return date. Interrupted: stopped by an error, use Retry. Replied, bounced and opted out are finished." className="text-ink-500 cursor-help"><HelpCircle size={17} /></span></span></th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center">Scheduled</th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center">Sent</th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center">Opened</th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center">Clicked</th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center border-r">Replied</th>
                <th className="th !py-3.5 !text-sm !font-medium !text-ink-700 !text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? "bg-brand-50/50" : undefined}>
                  <td className="td border-r">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" className="w-5 h-5 rounded-md border-ink-300 shrink-0" aria-label={`Select ${r.contact.email}`} checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                      <div><div className="font-medium text-ink-800">{`${r.contact.firstName} ${r.contact.lastName}`.trim() || "—"}</div><div className="text-xs text-ink-500">{r.contact.email}{r.contact.companyName ? ` · ${r.contact.companyName}` : ""}</div></div>
                    </div>
                  </td>
                  <td className="td border-r"><StatusPill status={r.state === "error" ? "interrupted" : r.state} />{r.lastError && <div className="text-xs text-ink-400 mt-0.5">{WAIT_REASONS[r.lastError] ?? r.lastError.replace(/_/g, " ")}</div>}</td>
                  <td className="td text-center text-ink-500 whitespace-nowrap">{fmtInZone(r.nextRunAt, tz)}</td>
                  <td className="td text-center">{num(r.sent)}</td>
                  <td className="td text-center">{num(r.opened)}</td>
                  <td className="td text-center">{num(r.clicked)}</td>
                  <td className="td text-center border-r">{num(r.replied)}</td>
                  <td className="td text-center whitespace-nowrap">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(r.contact)} title="Edit contact" aria-label={`Edit ${r.contact.email}`}><Pencil size={14} /></button>
                    {r.state === "ooo" && <button className="btn-ghost btn-sm" onClick={() => resumeOoo.mutate([r.id])}>Resume</button>}
                    {r.state === "error" && <button className="btn-ghost btn-sm" onClick={() => retry.mutate([r.id])}>Retry</button>}
                    {r.state !== "sending" && <button className="btn-ghost btn-sm text-red-700" onClick={() => remove.mutate([r.id])} title="Remove from this sequence"><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pageSize={20} total={list.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      {editing && <EditContactModal contact={editing} onClose={() => setEditing(null)} />}
      {adding && <AddContactsModal sequenceId={sequenceId} onClose={() => setAdding(false)} onAdded={onAdded} />}
    </div>
  );
}

// First screen: choose where contacts come from. "Existing contacts" opens the picker; the others run an import into this sequence.
function AddContactsModal(props: { sequenceId: string; onClose: () => void; onAdded: (r: { added: number; alreadyIn: number }) => void }) {
  const [source, setSource] = useState<"choose" | "single" | "existing" | "google_sheet" | "csv">("choose");
  if (source === "single") return <SingleContactModal sequenceId={props.sequenceId} onBack={() => setSource("choose")} onClose={props.onClose} onAdded={props.onAdded} />;
  if (source === "existing") return <ExistingContactsModal {...props} />;
  if (source === "google_sheet" || source === "csv") return <ImportModal sequenceId={props.sequenceId} source={source} onClose={props.onClose} onBack={() => setSource("choose")} />;
  const row = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[15px] hover:bg-ink-50" onClick={onClick}>
      <span className="w-5 grid place-items-center text-ink-600">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={18} className="text-ink-400" />
    </button>
  );
  return (
    <Modal open onClose={props.onClose} title="Add contacts" flush>
      <div className="p-4">
        <div className="rounded-xl border border-ink-200 divide-y divide-ink-100 overflow-hidden">
          {row(<UserPlus size={18} />, "Add a single contact", () => setSource("single"))}
          {row(<Users size={18} />, "Existing contacts", () => setSource("existing"))}
          {row(<GoogleG />, "Google sheet URL", () => setSource("google_sheet"))}
          {row(<FileText size={18} />, "Upload a CSV file", () => setSource("csv"))}
        </div>
      </div>
    </Modal>
  );
}

// Type one contact's details; they are saved to Contacts (or matched if the email already exists) and added to this sequence.
function SingleContactModal({ sequenceId, onBack, onClose, onAdded }: { sequenceId: string; onBack: () => void; onClose: () => void; onAdded: (r: { added: number; alreadyIn: number }) => void }) {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ first_name: "", last_name: "", email: "", company_name: "", title: "" });
  const [tried, setTried] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const save = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      const contact = await api<Contact>(`/v1/workspaces/${ws}/contacts`, { body });
      return api<{ added: number; alreadyIn: number }>(`/v1/workspaces/${ws}/sequences/${sequenceId}/contacts`, { body: { contactIds: [contact.id] } });
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["contacts", ws] }); onAdded(r); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title="Add a single contact" footer={<>
      <button className="btn-secondary" onClick={onBack}>Back</button>
      <button className="btn-primary" disabled={save.isPending} onClick={() => { setTried(true); if (emailOk) save.mutate(); }}>{save.isPending ? "Adding…" : "Add to sequence"}</button>
    </>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTried(true); if (emailOk) save.mutate(); }}>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">First name</label><input className="input h-10" value={f.first_name} onChange={set("first_name")} autoFocus /></div>
          <div><label className="label">Last name</label><input className="input h-10" value={f.last_name} onChange={set("last_name")} /></div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className={cx("input h-10", tried && !emailOk && "border-red-500")} type="email" value={f.email} onChange={set("email")} />
          {tried && !emailOk && <p className="text-xs text-red-600 mt-1">Enter a valid email address</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className="label">Company <span className="text-ink-400 font-normal">(optional)</span></label><input className="input h-10" value={f.company_name} onChange={set("company_name")} /></div>
          <div><label className="label">Job title <span className="text-ink-400 font-normal">(optional)</span></label><input className="input h-10" value={f.title} onChange={set("title")} /></div>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
  );
}

function ExistingContactsModal({ sequenceId, onClose, onAdded }: { sequenceId: string; onClose: () => void; onAdded: (r: { added: number; alreadyIn: number }) => void }) {
  const ws = useWs();
  const toast = useToast();
  const [mode, setMode] = useState<"pick" | "tag" | "all">("pick");
  const [tagId, setTagId] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const contacts = useQuery({
    queryKey: ["contacts", ws, `picker:${q}`],
    queryFn: () => api<Paged<Contact>>(`/v1/workspaces/${ws}/contacts?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ""}`),
    enabled: mode === "pick",
  });
  const add = useMutation({
    mutationFn: () => api<{ added: number; alreadyIn: number }>(`/v1/workspaces/${ws}/sequences/${sequenceId}/contacts`, {
      body: mode === "all" ? { all: true } : mode === "tag" ? { tagId } : { contactIds: [...picked] },
    }),
    onSuccess: onAdded,
    onError: (e: Error) => toast(e.message, "error"),
  });
  const total = contacts.data?.total ?? 0;
  const canAdd = mode === "all" || (mode === "tag" && !!tagId) || (mode === "pick" && picked.size > 0);

  return (
    <Modal open onClose={onClose} title="Add contacts to sequence" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!canAdd || add.isPending} onClick={() => add.mutate()}>
        {add.isPending ? "Adding…" : mode === "pick" ? `Add ${picked.size || ""} selected` : "Add"}
      </button>
    </>}>
      <div className="flex gap-1 mb-4">
        {([["pick", "Choose contacts"], ["tag", "By tag"], ["all", "All contacts"]] as const).map(([k, l]) => (
          <button key={k} className={cx("btn-sm btn", mode === k ? "bg-ink-900 text-ink-50" : "bg-ink-100 text-ink-700")} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      {mode === "pick" && (
        <div>
          <input className="input mb-2" placeholder="Search name, email, company" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="max-h-72 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
            {contacts.isLoading ? <Spinner /> : !contacts.data?.items.length ? (
              <div className="p-4 text-sm text-ink-500">No contacts found. Add them on the Contacts page first.</div>
            ) : contacts.data.items.map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
                <input type="checkbox" checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-ink-800">{`${c.firstName} ${c.lastName}`.trim() || c.email}</span>
                  <span className="block truncate text-xs text-ink-500">{c.email}{c.companyName ? ` · ${c.companyName}` : ""}</span>
                </span>
              </label>
            ))}
          </div>
          {total > 100 && <p className="text-xs text-ink-500 mt-2">Showing the first 100 of {total}. Search to narrow down, or use "By tag" / "All contacts".</p>}
        </div>
      )}
      {mode === "tag" && (
        (tags.data ?? []).length ? (
          <select className="input" value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">Choose a tag…</option>
            {(tags.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.contacts})</option>)}
          </select>
        ) : <p className="text-sm text-ink-500">You don't have any tags yet. Tag contacts on the Contacts page, or use "Choose contacts".</p>
      )}
      {mode === "all" && <p className="text-sm text-ink-600">Every contact in this workspace will be added.</p>}
      <p className="text-xs text-ink-500 mt-3">Contacts already in this sequence are skipped. Do-not-contact entries and unsubscribes are checked before every send.</p>
    </Modal>
  );
}

function SendersTab({ sequence, onChange }: { sequence: SequenceDetail; onChange: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState<null | "choose" | "profiles" | "mailboxes" | "create">(null);
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`) });
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const picked = useQuery({ queryKey: ["seq-mailboxes", ws, sequence.id], queryFn: () => api<{ mailboxIds: string[] }>(`/v1/workspaces/${ws}/sequences/${sequence.id}/mailboxes`) });

  const attached = (profiles.data ?? []).filter((p) => sequence.senderProfileIds.includes(p.id));
  const pickedMailboxes = (mailboxes.data ?? []).filter((m) => picked.data?.mailboxIds.includes(m.id));
  const allMailboxes = new Map<string, Mailbox>();
  for (const p of attached) for (const m of p.mailboxes) { const full = mailboxes.data?.find((x) => x.id === m.id); if (full) allMailboxes.set(full.id, full); }
  for (const m of pickedMailboxes) allMailboxes.set(m.id, m);
  const capacity = [...allMailboxes.values()].filter((m) => m.status === "active").reduce((s, m) => s + m.dailyLimit, 0);

  const refresh = () => {
    onChange();
    qc.invalidateQueries({ queryKey: ["seq-mailboxes", ws, sequence.id] });
    qc.invalidateQueries({ queryKey: ["sender-profiles", ws] });
  };
  const setProfiles = useMutation({
    mutationFn: (ids: string[]) => api(`/v1/workspaces/${ws}/sequences/${sequence.id}/senders`, { method: "PUT", body: { senderProfileIds: ids } }),
    onSuccess: () => { toast("Rotation updated"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const setMailboxes = useMutation({
    mutationFn: (ids: string[]) => api(`/v1/workspaces/${ws}/sequences/${sequence.id}/mailboxes`, { method: "PUT", body: { mailboxIds: ids } }),
    onSuccess: () => { toast("Mailboxes updated"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const empty = !attached.length && !pickedMailboxes.length;
  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1 min-w-[280px]">
          <div className="card px-4 py-3"><div className="text-xs text-ink-500">Rotations</div><div className="text-xl font-semibold">{attached.length}</div></div>
          <div className="card px-4 py-3"><div className="text-xs text-ink-500">Total mailboxes</div><div className="text-xl font-semibold">{allMailboxes.size}</div></div>
          <div className="card px-4 py-3"><div className="text-xs text-ink-500">Daily capacity</div><div className="text-xl font-semibold">{capacity}</div></div>
        </div>
        <button className="btn-primary" onClick={() => setAdding("choose")}><Plus size={16} /> Add rotation</button>
      </div>

      <div className="card overflow-hidden">
        {profiles.isLoading || picked.isLoading ? <Spinner /> : empty ? (
          <Empty icon={<Mail size={20} />} title="No rotation yet" text="Choose which mailboxes this sequence sends from. Sending is spread across all of them within each mailbox's daily limit." action={<button className="btn-primary" onClick={() => setAdding("choose")}><Plus size={16} /> Add rotation</button>} />
        ) : (
          <table className="w-full">
            <thead><tr><th className="th">Rotation</th><th className="th">Mailboxes</th><th className="th text-right">Daily capacity</th><th className="th" /></tr></thead>
            <tbody>
              {attached.map((p) => (
                <tr key={p.id}>
                  <td className="td font-medium">{p.name}<div className="text-xs font-normal text-ink-500">Rotation</div></td>
                  <td className="td"><div className="flex flex-wrap gap-1">{p.mailboxes.slice(0, 3).map((m) => <span key={m.id} className="chip bg-ink-100 text-ink-600">{m.email}</span>)}{p.mailboxes.length > 3 && <span className="chip bg-ink-100 text-ink-600">+{p.mailboxes.length - 3}</span>}</div></td>
                  <td className="td text-right">{p.dailyCap}</td>
                  <td className="td text-right"><button className="btn-ghost btn-sm" title="Remove from sequence" onClick={() => setProfiles.mutate(sequence.senderProfileIds.filter((x) => x !== p.id && attached.some((a) => a.id === x)))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
              {pickedMailboxes.map((m) => (
                <tr key={m.id}>
                  <td className="td font-medium">{m.fromName}<div className="text-xs font-normal text-ink-500">Mailbox</div></td>
                  <td className="td"><span className="chip bg-ink-100 text-ink-600">{m.email}</span>{m.status !== "active" && <StatusPill status={m.status} />}</td>
                  <td className="td text-right">{m.dailyLimit}</td>
                  <td className="td text-right"><button className="btn-ghost btn-sm" title="Remove from sequence" onClick={() => setMailboxes.mutate((picked.data?.mailboxIds ?? []).filter((x) => x !== m.id))}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {adding === "choose" && (
        <Modal open onClose={() => setAdding(null)} title="Add rotation" flush>
          <div className="p-4">
            <div className="rounded-xl border border-ink-200 overflow-hidden">
              {([
                [<UserCheck key="a" size={18} />, `Select an existing rotation${profiles.data?.length ? ` (${profiles.data.length})` : ""}`, () => setAdding("profiles")],
                [<Mail key="b" size={18} />, "Select single mailboxes", () => setAdding("mailboxes")],
              ] as const).map(([icon, label, go]) => (
                <button key={label} className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[15px] hover:bg-ink-50 border-b border-ink-100" onClick={go}>
                  <span className="w-5 grid place-items-center text-ink-600">{icon}</span><span className="flex-1">{label}</span><ChevronRight size={18} className="text-ink-400" />
                </button>
              ))}
              <div className="h-2 bg-ink-50/60 border-b border-ink-100" />
              <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-[15px] hover:bg-ink-50" onClick={() => setAdding("create")}>
                <span className="w-5 grid place-items-center text-ink-600"><UserPlus size={18} /></span><span className="flex-1">Create new rotation</span><ChevronRight size={18} className="text-ink-400" />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {adding === "profiles" && (
        <PickProfilesModal profiles={profiles.data ?? []} initial={attached.map((p) => p.id)} onClose={() => setAdding(null)}
          onSave={(ids) => { setProfiles.mutate(ids); setAdding(null); }} onCreate={() => setAdding("create")} />
      )}
      {adding === "mailboxes" && (
        <PickMailboxesModal mailboxes={mailboxes.data ?? []} initial={picked.data?.mailboxIds ?? []} onClose={() => setAdding(null)}
          onSave={(ids) => { setMailboxes.mutate(ids); setAdding(null); }} />
      )}
      {adding === "create" && (
        <CreateSenderModal mailboxes={mailboxes.data ?? []} onClose={() => setAdding(null)}
          onCreated={(id) => { setProfiles.mutate([...attached.map((p) => p.id), id]); setAdding(null); }} />
      )}
    </div>
  );
}

function PickProfilesModal({ profiles, initial, onClose, onSave, onCreate }: { profiles: SenderProfile[]; initial: string[]; onClose: () => void; onSave: (ids: string[]) => void; onCreate: () => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  return (
    <Modal open onClose={onClose} title="Select an existing rotation" icon={<UserCheck size={20} />} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" onClick={() => onSave(sel)}>Use selected rotations</button>
    </>}>
      {!profiles.length ? (
        <Empty icon={<UserCheck size={20} />} title="No rotations yet" text="A rotation groups mailboxes that send together." action={<button className="btn-primary" onClick={onCreate}><UserPlus size={16} /> Create new rotation</button>} />
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
          {profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-ink-50">
              <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel((x) => (e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-ink-500">{p.mailboxes.length} mailboxes · {p.dailyCap}/day</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

// Full-width "Add mailboxes" picker: count, search, filters, select all, and a table of every mailbox.
function PickMailboxesModal({ mailboxes, initial, onClose, onSave }: { mailboxes: Mailbox[]; initial: string[]; onClose: () => void; onSave: (ids: string[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const rows = mailboxes.filter((m) =>
    (!q || `${m.email} ${m.fromName}`.toLowerCase().includes(q.toLowerCase())) && (!status || m.status === status) && (!provider || m.provider === provider));
  const allSel = rows.length > 0 && rows.every((m) => sel.has(m.id));
  const changed = sel.size !== initial.length || [...sel].some((id) => !initial.includes(id));
  return (
    <div className="fixed inset-0 z-50 bg-black/50 p-2 sm:p-6 flex" onMouseDown={onClose}>
      <div className="card w-full flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 px-5 py-4 border-b border-ink-100">
          <span className="grid place-items-center w-12 h-12 rounded-xl border border-ink-200"><Mail size={20} /></span>
          <h2 className="font-semibold text-lg flex-1">Add mailboxes</h2>
          <button className="btn-primary h-11 px-5" disabled={!changed} onClick={() => onSave([...sel])}>Add to sequence</button>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-4 sm:p-6 flex-1 overflow-hidden flex flex-col">
          <div className="card flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b border-ink-100">
              <span className="font-semibold">Mailboxes: {mailboxes.length}</span>
              <div className="relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="relative">
                <button className={cx("btn-secondary", (status || provider) && "border-brand-500 text-brand-700")} onClick={() => setShowFilters((s) => !s)}><SlidersHorizontal size={15} /> Filters</button>
                {showFilters && (
                  <div className="absolute left-0 top-11 z-10 w-64 card p-4 space-y-3">
                    <div><div className="label">Status</div>
                      <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option><option value="active">Active</option><option value="paused">Paused</option><option value="error">Error</option></select>
                    </div>
                    <div><div className="label">Provider</div>
                      <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Any</option><option value="google">Google</option><option value="microsoft">Microsoft</option><option value="smtp">IMAP/SMTP</option></select>
                    </div>
                  </div>
                )}
              </div>
              <span className="text-sm text-ink-500">{sel.size} selected</span>
              <button className="btn-secondary ml-auto" onClick={() => setSel((s) => { const n = new Set(s); rows.forEach((m) => (allSel ? n.delete(m.id) : n.add(m.id))); return n; })}>{allSel ? "Clear all" : "Select all"}</button>
            </div>
            <div className="flex-1 overflow-auto">
              {!mailboxes.length ? (
                <Empty icon={<Mail size={20} />} title="No mailboxes connected" text="Connect mailboxes on the Senders & Mailboxes page first." />
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0"><tr><th className="th w-10" /><th className="th">Mailbox</th><th className="th">Status</th><th className="th">Provider</th><th className="th text-right">Sent today / limit</th><th className="th">Tags</th></tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id} className={cx("cursor-pointer hover:bg-ink-50/60", sel.has(m.id) && "bg-brand-50/40")} onClick={() => setSel((s) => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}>
                        <td className="td"><input type="checkbox" readOnly checked={sel.has(m.id)} /></td>
                        <td className="td"><div className="font-medium">{m.fromName}</div><div className="text-xs text-ink-500">{m.email}</div></td>
                        <td className="td"><StatusPill status={m.status} /></td>
                        <td className="td capitalize">{m.provider === "smtp" ? "IMAP/SMTP" : m.provider}</td>
                        <td className="td text-right">{m.sentToday} / {m.dailyLimit}</td>
                        <td className="td"><div className="flex flex-wrap gap-1">{m.tags.map((t) => <span key={t} className="chip bg-ink-100 text-ink-600">{t}</span>)}</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateSenderModal({ mailboxes, onClose, onCreated }: { mailboxes: Mailbox[]; onClose: () => void; onCreated: (id: string) => void }) {
  const ws = useWs();
  const toast = useToast();
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/v1/workspaces/${ws}/sender-profiles`, { body: { name, mailboxIds: ids } }),
    onSuccess: (r) => { toast("Rotation created"); onCreated(r.id); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title="Create new rotation" subtitle="Group mailboxes that take turns sending." icon={<UserPlus size={20} />} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!name.trim() || !ids.length || create.isPending} onClick={() => create.mutate()}>Create and add</button>
    </>}>
      <div className="space-y-4">
        <div><label className="label">Rotation name</label><input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Satya (sales)" /></div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className="label mb-0">Mailboxes</span>
            {!!mailboxes.length && <button className="text-xs text-brand-700" onClick={() => setIds(ids.length === mailboxes.length ? [] : mailboxes.map((m) => m.id))}>{ids.length === mailboxes.length ? "Clear" : "Select all"}</button>}</div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-200 divide-y divide-ink-100">
            {mailboxes.map((m) => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-ink-50">
                <input type="checkbox" checked={ids.includes(m.id)} onChange={(e) => setIds((x) => (e.target.checked ? [...x, m.id] : x.filter((y) => y !== m.id)))} />
                <span className="flex-1">{m.email}</span><span className="text-xs text-ink-400">{m.dailyLimit}/day</span>
              </label>
            ))}
            {!mailboxes.length && <div className="p-3 text-sm text-ink-500">Connect a mailbox first on the Senders & Mailboxes page.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// One labelled band of the settings page: section name on the left, controls on the right.
function SettingsRow({ title, hint, children, show = true }: { title: string; hint?: string; children: React.ReactNode; show?: boolean }) {
  if (!show) return null;
  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-3 md:gap-8 py-6 border-b border-ink-200 last:border-0">
      <div className="pt-1">
        <div className="text-sm font-semibold">{title}</div>
        {hint && <p className="text-sm text-ink-500 mt-1">{hint}</p>}
      </div>
      <div className="space-y-3 max-w-2xl">{children}</div>
    </div>
  );
}

function OptionCard({ icon, title, text, checked, onChange, badge, children }: {
  icon: React.ReactNode; title: string; text: string; checked: boolean; onChange: (v: boolean) => void; badge?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className={cx("rounded-xl border p-3.5 transition-colors", checked ? "border-brand-500 bg-brand-50/40" : "border-ink-200 bg-surface")}>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-8 h-8 shrink-0 rounded-lg border border-ink-200 bg-surface text-ink-500">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-ink-500 mt-0.5">{text}</div>
        </div>
        {badge}
        <Toggle checked={checked} onChange={onChange} />
      </div>
      {checked && children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  );
}


const WEEK = [1, 2, 3, 4, 5, 6, 0];
// Why an active contact is waiting. These are normal pauses, not errors.
const WAIT_REASONS: Record<string, string> = {
  outside_window: "Waiting for the next sending window",
  throttled: "Waiting for the gap between emails",
  no_capacity: "Mailbox daily limit reached, trying again later",
  sticky_at_capacity: "Mailbox daily limit reached, trying again later",
  sticky_unavailable: "Waiting for the original mailbox",
  company_sequential: "Waiting for another contact at this company",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const hourOf = (hhmm: string) => (hhmm === "23:59" ? 24 : Number(hhmm.slice(0, 2)));
const fromHour = (h: number) => `${pad2(Math.min(23, Math.max(0, h)))}:00`;
const toHourStr = (h: number) => (h >= 24 ? "23:59" : `${pad2(Math.max(1, h))}:00`);
const ampm = (h: number) => (h % 24 === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
const hoursFor = (sc: SequenceSettings["schedule"], d: number) => sc.hours?.[String(d)] ?? { start: sc.start, end: sc.end };
const scheduleInvalid = (sc: SequenceSettings["schedule"]) => !sc.days.length || sc.days.some((d) => { const h = hoursFor(sc, d); return h.end <= h.start; });
// jsonb returns object keys in its own order, so compare with sorted keys.
const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
const withoutProduct = (x: SequenceSettings) => { const { language: _l, productId: _p, ...rest } = x; return rest; };

function ScheduleDays({ schedule, onChange }: { schedule: SequenceSettings["schedule"]; onChange: (s: SequenceSettings["schedule"]) => void }) {
  const apply = (days: number[], changed: Record<string, { start: string; end: string }>) => {
    // Every active day keeps its own saved hours. A day with no entry follows the shared start/end, and those move whenever any day changes,
    // so without this one edit (say Monday) would silently change all the other days.
    const hours: Record<string, { start: string; end: string }> = { ...changed };
    for (const d of days) hours[String(d)] ??= hoursFor(schedule, d);
    const act = days.map((d) => hours[String(d)]!);
    onChange({
      ...schedule, days, hours,
      start: act.length ? act.map((h) => h.start).sort()[0]! : schedule.start,
      end: act.length ? act.map((h) => h.end).sort().at(-1)! : schedule.end,
    });
  };
  const setHours = (d: number, patch: Partial<{ start: string; end: string }>) =>
    apply(schedule.days, { ...(schedule.hours ?? {}), [String(d)]: { ...hoursFor(schedule, d), ...patch } });
  const toggleDay = (d: number, on: boolean) => {
    const days = on ? [...new Set([...schedule.days, d])].sort() : schedule.days.filter((x) => x !== d);
    apply(days, { ...(schedule.hours ?? {}), [String(d)]: hoursFor(schedule, d) });
  };
  return (
    <div className="divide-y divide-ink-200 border-y border-ink-200">
      {WEEK.map((d) => {
        const on = schedule.days.includes(d);
        const h = hoursFor(schedule, d);
        const bad = on && h.end <= h.start;
        return (
          <div key={d} className="grid md:grid-cols-[160px_1fr] gap-3 py-4">
            <div className="text-sm font-semibold pt-1">{DAY_NAMES[d]}</div>
            <div className="space-y-2">
              {on && (
                <div className="flex flex-wrap gap-3">
                  <div><div className="text-xs text-brand-700 mb-1">From Hour</div>
                    <input type="number" min={0} max={23} className="input h-10 w-32" value={hourOf(h.start)} onChange={(e) => setHours(d, { start: fromHour(Number(e.target.value)) })} /></div>
                  <div><div className="text-xs text-brand-700 mb-1">To Hour</div>
                    <input type="number" min={1} max={24} className="input h-10 w-32" value={hourOf(h.end)} onChange={(e) => setHours(d, { end: toHourStr(Number(e.target.value)) })} /></div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Toggle checked={on} onChange={(v) => toggleDay(d, v)} />
                <span className={cx("text-xs font-medium", bad ? "text-red-600" : on ? "text-brand-700" : "text-ink-500")}>
                  {bad ? "The end hour must be after the start hour" : on ? `Active from ${ampm(hourOf(h.start))} - ${ampm(hourOf(h.end))}` : "Inactive"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const tzLabel = (tz: string) => {
  try {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return `${tz} (${off})`;
  } catch { return tz; }
};

type SaveSettings = () => Promise<boolean>;

function SettingsTab({ sequence, onChange, section = "all", registerSave, onDirty }: { sequence: SequenceDetail; onChange: () => void; section?: "all" | "schedule" | "settings"; registerSave?: (fn: SaveSettings | null) => void; onDirty?: (dirty: boolean) => void }) {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const initial = useMemo(() => ({ pauseOnClick: false, pauseOnOpen: false, bounceShield: true, trackOpportunities: true, ...sequence.settings }), [sequence.settings]);
  const [st, setSt] = useState<SequenceSettings>(initial);
  const [priority, setPriority] = useState(sequence.priority);
  const [ccOn, setCcOn] = useState(initial.cc.length > 0 || initial.bcc.length > 0);
  const [ccText, setCcText] = useState({ cc: initial.cc.join(", "), bcc: initial.bcc.join(", ") });
  const show = (g: "schedule" | "settings") => section === "all" || section === g;
  const dirty = stable(withoutProduct(st)) !== stable(withoutProduct(initial)) || priority !== sequence.priority
    || ccText.cc !== initial.cc.join(", ") || ccText.bcc !== initial.bcc.join(", ") || ccOn !== (initial.cc.length > 0 || initial.bcc.length > 0);
  const parseList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/sequences/${sequence.id}`, {
      method: "PATCH",
      body: { priority, settings: { ...withoutProduct(st), cc: ccOn ? parseList(ccText.cc) : [], bcc: ccOn ? parseList(ccText.bcc) : [] } },
    }),
    onSuccess: () => { toast("Settings saved"); onChange(); void qc.invalidateQueries({ queryKey: ["emails", ws] }); void qc.invalidateQueries({ queryKey: ["seq-contacts", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Next / Back / the step tabs call this first, so the timezone, days and hours are never lost when leaving the screen.
  useEffect(() => {
    registerSave?.(async () => {
      if (!dirty) return true;
      if (scheduleInvalid(st.schedule)) { toast("Fix the schedule first: each end hour must be after its start hour", "error"); return false; }
      try { await save.mutateAsync(); return true; } catch { return false; }
    });
    return () => registerSave?.(null);
  });
  const set = <K extends keyof SequenceSettings>(k: K, v: SequenceSettings[K]) => setSt((x) => ({ ...x, [k]: v }));
  const notRecommended = <span className="chip bg-red-50 text-red-600 border border-red-200 shrink-0">Not recommended</span>;

  return (
    <div className="max-w-5xl pb-20">
      <div className="card px-5 md:px-8">
        <SettingsRow title="Timezone" show={show("schedule")}>
          <TimezoneSelect className="h-10" value={st.schedule.timezone} onChange={(tz) => set("schedule", { ...st.schedule, timezone: tz })} />
          <p className="text-xs text-ink-500">Send windows are measured in this time zone.</p>
        </SettingsRow>
        {show("schedule") && <ScheduleDays schedule={st.schedule} onChange={(sc) => set("schedule", sc)} />}

        <SettingsRow title="Priority among your sequences" show={show("settings")}>
          <select className="input h-10 max-w-xs" value={priority} onChange={(e) => setPriority(e.target.value as "high" | "regular")}>
            <option value="regular">Regular</option><option value="high">High</option>
          </select>
          <p className="text-xs text-ink-500">{priority === "high" ? "High-priority sequences use mailbox capacity first each day." : "Shares the capacity left after high-priority sequences. Sending capacity goes from older to newer."}</p>
        </SettingsRow>

        <SettingsRow title="In-sequence sending priority" show={show("settings")}>
          <select className="input h-10 max-w-xs" value={st.inSequencePriority} onChange={(e) => set("inSequencePriority", e.target.value as "new_first" | "followups_first")}>
            <option value="new_first">New contacts first</option><option value="followups_first">Follow-ups first</option>
          </select>
          <p className="text-xs text-ink-500">{st.inSequencePriority === "new_first" ? "Daily sending focuses on new contacts first. Leftover capacity goes to follow-ups." : "Follow-ups are sent first so conversations keep moving. Leftover capacity goes to new contacts."}</p>
        </SettingsRow>

        <SettingsRow title="Multithreading" show={show("settings")}>
          <OptionCard icon={<Users size={16} />} title="Sequential sending within a company" text="Send messages to people at a company one by one, after each has completed their sequence." checked={st.sequentialWithinCompany} onChange={(v) => set("sequentialWithinCompany", v)} />
          <OptionCard icon={<Building2 size={16} />} title="Set a company limit" text="Set the maximum number of people you'll contact at the same company." checked={st.companyLimit !== null} onChange={(v) => set("companyLimit", v ? 3 : null)}>
            <label className="flex items-center gap-2 text-sm">Max <input type="number" min={1} max={1000} className="input h-8 w-20" value={st.companyLimit ?? 3} onChange={(e) => set("companyLimit", Math.max(1, Number(e.target.value)))} /> people per company</label>
          </OptionCard>
        </SettingsRow>

        <SettingsRow title="Out of office" show={show("settings")}>
          <OptionCard icon={<CalendarClock size={16} />} title="Auto-resume after OOO" text="When an OOO reply includes a return date, the contact goes back to Active after the buffer below and continues from the next step. If that day or time is outside this sequence's schedule, it waits for the next open window." checked={st.oooAutoResume} onChange={(v) => set("oooAutoResume", v)}>
            <label className="flex items-center gap-2 text-sm">Buffer <input type="number" min={0} max={30} className="input h-8 w-20" value={st.oooBufferDays} onChange={(e) => set("oooBufferDays", Math.max(0, Number(e.target.value)))} /> days after they're back</label>
          </OptionCard>
        </SettingsRow>

        <SettingsRow title="Email only" show={show("settings")}>
          <div className="text-sm font-medium text-ink-600">Sending</div>
          <OptionCard icon={<Forward size={16} />} title="CC and BCC" text="Add CC and BCC recipients to your emails." checked={ccOn} onChange={setCcOn}>
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="input h-9" placeholder="CC: name@company.com" value={ccText.cc} onChange={(e) => setCcText({ ...ccText, cc: e.target.value })} />
              <input className="input h-9" placeholder="BCC: crm@company.com" value={ccText.bcc} onChange={(e) => setCcText({ ...ccText, bcc: e.target.value })} />
            </div>
          </OptionCard>
          <OptionCard icon={<MousePointerClick size={16} />} title="Pause on click" text="Pause sequence for recipients who click on your emails. Needs link-click tracking." checked={!!st.pauseOnClick} onChange={(v) => set("pauseOnClick", v)} />
          <OptionCard icon={<MailOpen size={16} />} title="Pause on open" text="Pause sequence for recipients who open your emails. Needs open tracking." checked={!!st.pauseOnOpen} onChange={(v) => set("pauseOnOpen", v)} />

          <div className="text-sm font-medium text-ink-600 pt-3">Deliverability</div>
          <OptionCard icon={<ShieldCheck size={16} />} title="Bounce shield" text="Checks each address before sending and skips contacts that already bounced or whose email domain can't receive mail, preventing bounces." checked={st.bounceShield ?? true} onChange={(v) => set("bounceShield", v)} />
          <OptionCard icon={<Type size={16} />} title="Plain Text" text="Send emails as text-only, with no HTML, for the best deliverability." checked={st.plainText} onChange={(v) => set("plainText", v)}
            badge={<span className="chip bg-brand-50 text-brand-700 border border-brand-200 shrink-0">Boost deliverability</span>} />
          <OptionCard icon={<Server size={16} />} title="Email service provider (ESP) matching" text="Match the sender's and recipient's ESP (Gmail and Outlook only)." checked={st.espMatching} onChange={(v) => set("espMatching", v)} />
        </SettingsRow>

        <SettingsRow title="Include opt-out (Recommended)" hint="If recipients can easily unsubscribe, they are less likely to mark your email as spam" show={show("settings")}>
          <Toggle label="Opt-out link at the bottom of email" checked={st.optOut.enabled} onChange={(v) => set("optOut", { ...st.optOut, enabled: v })} />
          {st.optOut.enabled && (
            <label className="block">
              <span className="block text-sm font-medium mb-1">Customize opt-out link</span>
              <input className="input h-10" value={st.optOut.text} maxLength={200} onChange={(e) => set("optOut", { ...st.optOut, text: e.target.value })} placeholder="Opt-out" />
            </label>
          )}
          {!st.optOut.enabled && <p className="text-xs text-amber-700">Without an opt-out link, recipients can only unsubscribe by replying. CAN-SPAM, CASL and Gmail/Yahoo bulk-sender rules expect an easy opt-out in cold email.</p>}
        </SettingsRow>

        <SettingsRow title="Tracking" show={show("settings")}>
          <OptionCard icon={<DollarSign size={16} />} title="Track opportunities" text="Keep track of opportunities value: positive replies, booked or completed meetings, closed deals." checked={st.trackOpportunities ?? true} onChange={(v) => set("trackOpportunities", v)} />
          <OptionCard icon={<Eye size={16} />} title="Track open rate" text="Keep track of who's opening your emails." checked={st.trackOpens} onChange={(v) => set("trackOpens", v)} badge={notRecommended} />
          <OptionCard icon={<Link2 size={16} />} title="Track link clicks" text="Keep track of the link clicks in your emails." checked={st.trackClicks} onChange={(v) => set("trackClicks", v)} badge={notRecommended} />
          {st.plainText && (st.trackOpens || st.trackClicks) && <p className="text-xs text-amber-700">Plain text emails can't carry tracking, so opens and clicks won't be tracked while Plain Text is on.</p>}
        </SettingsRow>
      </div>
    </div>
  );
}
