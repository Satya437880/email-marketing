import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Copy, FileText, GitBranch, HelpCircle, MoreHorizontal, Plus, Search, Send, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SenderProfile, type SequenceRow } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, Modal, PageHeader, pct, PortalMenu, Progress, Spinner, StatusPill, Toggle, useToast } from "../ui";

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open, close]);
  return ref;
}

function ReportingMenu({ ws }: { ws: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const item = (href: string, title: string, text: string) => (
    <a href={href} className="block rounded-md px-3 py-2 hover:bg-ink-50" onClick={() => setOpen(false)}>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-ink-500">{text}</div>
    </a>
  );
  return (
    <div className="relative" ref={ref}>
      <button className="btn-secondary" onClick={() => setOpen((o) => !o)}><FileText size={16} /> Reporting</button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-72 card p-1.5">
          {item(`/v1/workspaces/${ws}/reports/sequence-contacts.csv`, "Contacts report", "Every contact in every sequence, with status and progress (CSV)")}
          {item(`/v1/workspaces/${ws}/reports/messages.csv`, "All emails", "Every email sent and received (CSV)")}
        </div>
      )}
    </div>
  );
}

interface SeqFilters { status: string[]; priority: string; senderId: string }
const NO_FILTERS: SeqFilters = { status: [], priority: "", senderId: "" };

function SeqFiltersButton({ ws, value, onChange }: { ws: string; value: SeqFilters; onChange: (f: SeqFilters) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`), enabled: open });
  const count = value.status.length + (value.priority ? 1 : 0) + (value.senderId ? 1 : 0);
  return (
    <div className="relative" ref={ref}>
      <button className={cx("btn-secondary", count > 0 && "border-brand-500 text-brand-700")} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={15} /> Filters{count > 0 && <span className="chip bg-brand-600 text-white">{count}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-72 card p-4 space-y-4">
          <div>
            <div className="label">Status</div>
            <div className="flex flex-wrap gap-1.5">
              {["draft", "active", "completed"].map((s) => (
                <button key={s} className={cx("btn-sm btn capitalize", value.status.includes(s) ? "bg-brand-600 text-white" : "bg-ink-100")}
                  onClick={() => onChange({ ...value, status: value.status.includes(s) ? value.status.filter((x) => x !== s) : [...value.status, s] })}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label">Priority</div>
            <select className="input" value={value.priority} onChange={(e) => onChange({ ...value, priority: e.target.value })}>
              <option value="">Any</option><option value="high">High</option><option value="regular">Regular</option>
            </select>
          </div>
          <div>
            <div className="label">Rotation</div>
            <select className="input" value={value.senderId} onChange={(e) => onChange({ ...value, senderId: e.target.value })}>
              <option value="">Any</option>
              {(profiles.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {count > 0 && <button className="text-sm text-red-600 flex items-center gap-1" onClick={() => onChange(NO_FILTERS)}><X size={14} /> Clear filters</button>}
        </div>
      )}
    </div>
  );
}

function RowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  return (
    <PortalMenu align="right" width={176} className="inline-block" trigger={<button className="btn-ghost btn-sm" aria-label="Actions"><MoreHorizontal size={16} /></button>}>
      {children}
    </PortalMenu>
  );
}

const menuItem = "w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-ink-50 text-left";

export function SequencesPage() {
  const ws = useWs();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        icon={<Send size={18} />}
        title="Sequences"
        actions={<>
          <ReportingMenu ws={ws} />
          <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Add sequence</button>
        </>}
      >
        <span className="tab tab-active">List of Sequences</span>
      </PageHeader>
      <div className="p-4 md:p-8">
        <SequenceList onCreate={() => setCreating(true)} />
      </div>
      {creating && <NewSequenceModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewSequenceModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ id: string }>(`/v1/workspaces/${ws}/sequences`, { body: { name } }),
    onSuccess: (s) => nav(`/${ws}/sequences/${s.id}`),
  });
  return (
    <Modal open onClose={onClose} title="New sequence" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create</button>
    </>}>
      <label className="label">Sequence name</label>
      <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()} placeholder="e.g. SaaS founders — Q4" />
    </Modal>
  );
}

function SequenceList({ onCreate }: { onCreate: () => void }) {
  const ws = useWs();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<SeqFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`), refetchInterval: 30_000 });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sequences", ws] });

  // Switching a draft on launches it. A launched sequence keeps running; there is no pause.
  const toggle = useMutation({
    mutationFn: async (s: SequenceRow) => {
      await api(`/v1/workspaces/${ws}/sequences/${s.id}/launch`, { body: {} });
      return { name: s.name };
    },
    onSuccess: ({ name }) => {
      toast(`"${name}" launched — sending starts in its next send window`);
      refresh();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const dup = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/sequences/${id}/duplicate`, { body: {} }),
    onSuccess: () => { toast("Sequence duplicated"); refresh(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/v1/workspaces/${ws}/sequences/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const bulk = useMutation({
    mutationFn: async (action: "delete") => {
      const rows = (list.data ?? []).filter((s) => selected.has(s.id));
      for (const s of rows) {
        if (action === "delete") await api(`/v1/workspaces/${ws}/sequences/${s.id}`, { method: "DELETE" });
      }
      return rows.length;
    },
    onSuccess: (n) => { toast(`Deleted ${n} sequence${n === 1 ? "" : "s"}`); setSelected(new Set()); refresh(); },
  });

  const rows = (list.data ?? []).filter((s) =>
    (!q || s.name.toLowerCase().includes(q.toLowerCase()))
    && (!filters.status.length || filters.status.includes(s.status))
    && (!filters.priority || s.priority === filters.priority)
    && (!filters.senderId || s.senders.some((x) => x.id === filters.senderId)));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const num = (n: number, of: number) => (
    <div className="text-right"><div>{n.toLocaleString()}</div>{of > 0 && <div className="text-[11px] text-ink-400">{pct(n / of)}</div>}</div>
  );

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-ink-100">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <SeqFiltersButton ws={ws} value={filters} onChange={setFilters} />
        <span className="text-sm text-ink-500 sm:ml-auto">{rows.length} of {list.data?.length ?? 0} sequences</span>
      </div>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-brand-50 border-b border-brand-100 text-sm">
          <span className="font-medium text-brand-800">{selected.size} selected</span>
          <button className="btn-secondary btn-sm text-red-600" onClick={() => confirm(`Delete ${selected.size} sequences and their stats?`) && bulk.mutate("delete")}><Trash2 size={14} /> Delete</button>
          <button className="btn-ghost btn-sm ml-auto" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {list.isLoading ? <Spinner /> : !rows.length ? (
        list.data?.length
          ? <Empty icon={<Search size={20} />} title="No sequences match" text="Try a different search or clear the filters." action={<button className="btn-secondary" onClick={() => { setQ(""); setFilters(NO_FILTERS); }}>Clear</button>} />
          : <Empty icon={<Send size={20} />} title="No sequences yet" text="A sequence is the set of emails each contact receives, with delays between them." action={<button className="btn-primary" onClick={onCreate}><Plus size={16} /> Add sequence</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-10"><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                <th className="th">Name</th>
                <th className="th">Progress</th>
                <th className="th text-right">Contacts</th>
                <th className="th text-right">Bounced</th>
                <th className="th text-right">Opt-outs</th>
                <th className="th text-right">Opened</th>
                <th className="th text-right">Clicked</th>
                <th className="th text-right">Replied</th>
                <th className="th text-right">Positive</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={cx("hover:bg-ink-50/60 cursor-pointer", selected.has(s.id) && "bg-brand-50/40")} onClick={() => nav(`/${ws}/sequences/${s.id}`)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => setSelected((x) => { const n = new Set(x); e.target.checked ? n.add(s.id) : n.delete(s.id); return n; })} />
                  </td>
                  <td className="td min-w-[240px]">
                    <div className="flex items-center gap-3">
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={s.status === "active"}
                          disabled={s.status !== "draft" || (toggle.isPending && toggle.variables?.id === s.id)}
                          title={{ draft: "Draft — switch on to launch", active: "Active", paused: "Active", completed: "Completed" }[s.status]}
                          onChange={() => {
                            if (s.status === "draft" && !confirm(`Launch "${s.name}"? Emails start sending in its next send window.`)) return;
                            toggle.mutate(s);
                          }}
                        />
                      </span>
                      <span className="font-medium truncate max-w-[320px]" title={`${s.name} · ${s.status} · created ${fmtDate(s.createdAt)}`}>{s.name}</span>
                    </div>
                  </td>
                  <td className="td"><Progress value={s.progress} /></td>
                  <td className="td text-right">{s.contacts.toLocaleString()}</td>
                  <td className="td">{num(s.bounced, s.contacted)}</td>
                  <td className="td">{num(s.optedOut, s.contacted)}</td>
                  <td className="td">{num(s.opened, s.contacted)}</td>
                  <td className="td">{num(s.clicked, s.contacted)}</td>
                  <td className="td">{num(s.replied, s.contacted)}</td>
                  <td className="td">{num(s.positive, s.contacted)}</td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                    <RowMenu>{(close) => <>
                      <button className={menuItem} onClick={() => { close(); nav(`/${ws}/sequences/${s.id}`); }}><Send size={14} /> Open</button>
                      <button className={menuItem} onClick={() => { close(); dup.mutate(s.id); }}><Copy size={14} /> Duplicate</button>
                      <button className={cx(menuItem, "text-red-600")} onClick={() => { close(); if (confirm(`Delete "${s.name}"? This removes its stats too.`)) del.mutate(s.id); }}><Trash2 size={14} /> Delete</button>
                    </>}</RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
