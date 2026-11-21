import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ChevronRight, Copy, FileText, GitBranch, HelpCircle, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Send, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ReportsModal } from "../ReportsModal";
import { api, type SenderProfile, type SequenceRow } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, Modal, PageHeader, PagerBar, pct, PortalMenu, Progress, Spinner, StatusPill, Toggle, useToast } from "../ui";

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
  return (
    <>
      <button className="btn-secondary" onClick={() => setOpen(true)}><FileText size={16} /> Reporting</button>
      {open && <ReportsModal ws={ws} onClose={() => setOpen(false)} />}
    </>
  );
}

interface SeqFilters { status: string[]; priority: string; senderId: string }
const NO_FILTERS: SeqFilters = { status: [], priority: "", senderId: "" };

function SeqFiltersButton({ ws, value, onChange }: { ws: string; value: SeqFilters; onChange: (f: SeqFilters) => void }) {
  // Opened inside a floating layer (PortalMenu), so the table's edges can't cut the panel off.
  const [cat, setCat] = useState<"status" | "priority" | "rotation">("status");
  const [search, setSearch] = useState("");
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`), });
  const counts = { status: value.status.length, priority: value.priority ? 1 : 0, rotation: value.senderId ? 1 : 0 };
  const count = counts.status + counts.priority + counts.rotation;

  const categories: { key: typeof cat; label: string }[] = [
    { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "rotation", label: "Rotation" },
  ];
  // Options of the open category: id, label and whether it is ticked.
  const options: { id: string; label: string; on: boolean; pick: () => void }[] = cat === "status"
    ? [["active", "In progress"], ["draft", "Draft"], ["completed", "Finished"], ["paused", "Disabled"]].map(([id, label]) => ({
        id: id!, label: label!, on: value.status.includes(id!),
        pick: () => onChange({ ...value, status: value.status.includes(id!) ? value.status.filter((x) => x !== id) : [...value.status, id!] }),
      }))
    : cat === "priority"
      ? [["high", "High"], ["regular", "Regular"]].map(([id, label]) => ({ id: id!, label: label!, on: value.priority === id, pick: () => onChange({ ...value, priority: value.priority === id ? "" : id! }) }))
      : (profiles.data ?? []).map((p) => ({ id: p.id, label: p.name, on: value.senderId === p.id, pick: () => onChange({ ...value, senderId: value.senderId === p.id ? "" : p.id }) }));
  const shown = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <PortalMenu align="left" width={620} trigger={
      <button className={cx("btn-secondary", count > 0 && "border-brand-500 text-brand-700")}>
        <SlidersHorizontal size={15} /> Filters{count > 0 && <span className="chip bg-brand-600 text-white">{count}</span>}
      </button>
    }>
      {() => (
        <div className="-m-1.5">
          <div className="flex">
            <div className="w-56 shrink-0 bg-ink-50/70 border-r border-ink-100">
              <div className="px-4 py-3 text-sm font-semibold text-ink-500">Filters</div>
              <div className="p-2.5 space-y-1">
                {categories.map((c) => (
                  <button key={c.key} className={cx("w-full flex items-center gap-2 rounded-lg px-3 h-10 text-[15px] text-left", cat === c.key ? "bg-ink-100 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-100/70")}
                    onClick={() => { setCat(c.key); setSearch(""); }}>
                    <span className="flex-1">{c.label}</span>
                    {counts[c.key] > 0 && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md bg-brand-600 text-xs font-medium text-white">{counts[c.key]}</span>}
                    <ChevronRight size={16} className="text-ink-500" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="px-4 pt-3 border-b border-ink-100"><span className="inline-block pb-2.5 -mb-px border-b-2 border-brand-600 text-sm font-semibold text-brand-700">Include</span></div>
              <div className="p-3">
                <div className="relative">
                  <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
                  <input className="input h-11 pl-10 rounded-xl" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="mt-2 max-h-64 overflow-y-auto">
                  {!shown.length ? <div className="px-3 py-3 text-sm text-ink-400">{cat === "rotation" && profiles.isLoading ? "Loading…" : "Nothing found"}</div> : shown.map((o) => (
                    <button key={o.id} className="w-full flex items-center gap-3 rounded-lg px-3 h-11 text-[15px] text-ink-800 text-left hover:bg-ink-50" onClick={o.pick}>
                      <span className={cx("grid place-items-center w-5 h-5 rounded-md border shrink-0", o.on ? "bg-brand-600 border-brand-600 text-white" : "border-ink-300")}>{o.on && <Check size={13} strokeWidth={3} />}</span>
                      <span className="flex-1 truncate">{o.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-ink-100 bg-surface">
            <button className="btn-secondary btn-sm" disabled={count === 0} onClick={() => { onChange(NO_FILTERS); setSearch(""); }}><RotateCcw size={14} /> Reset filters</button>
            <span className="text-xs text-ink-500">{count ? `${count} filter${count === 1 ? "" : "s"} on` : "No filters on"}</span>
          </div>
        </div>
      )}
    </PortalMenu>
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

  // Switching a draft (or a completed sequence) on launches it. A running sequence keeps running; there is no pause.
  const toggle = useMutation({
    mutationFn: async (s: SequenceRow) => {
      await api(`/v1/workspaces/${ws}/sequences/${s.id}/launch`, { body: {} });
      return { name: s.name };
    },
    onSuccess: ({ name }) => {
      toast(`"${name}" is active — sending starts in its next send window`);
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
  // The list is paged in the browser: 10 rows at first, changeable from the bar under the table (the choice is remembered).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => { try { return Number(localStorage.getItem("seq-page-size")) || 10; } catch { return 10; } });
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { setPage(1); }, [q, filters, pageSize]);
  const pageRows = rows.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const num = (n: number, of: number) => (
    <div className="text-right"><div>{n.toLocaleString()}</div>{of > 0 && <div className="text-xs text-ink-400">{pct(n / of)}</div>}</div>
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
                <th className="th w-10"><input type="checkbox" checked={allSelected} onChange={(e) => setSelected((x) => { const n = new Set(x); pageRows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} /></th>
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
              {pageRows.map((s) => (
                <tr key={s.id} className={cx("hover:bg-ink-50/60 cursor-pointer", selected.has(s.id) && "bg-brand-50/40")} onClick={() => nav(`/${ws}/sequences/${s.id}`)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => setSelected((x) => { const n = new Set(x); e.target.checked ? n.add(s.id) : n.delete(s.id); return n; })} />
                  </td>
                  <td className="td min-w-[240px]">
                    <div className="flex items-center gap-3">
                      <span onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={s.status === "active"}
                          disabled={(s.status !== "draft" && s.status !== "completed") || (toggle.isPending && toggle.variables?.id === s.id)}
                          title={{ draft: "Draft — switch on to launch", active: "Active", paused: "Active", completed: "Completed — switch on to activate it again" }[s.status]}
                          onChange={() => {
                            if (s.status === "draft" && !confirm(`Launch "${s.name}"? Emails start sending in its next send window.`)) return;
                            if (s.status === "completed" && !confirm(`Activate "${s.name}" again? Contacts added to it will start sending in its next send window.`)) return;
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
                      {s.status === "completed" ? <>
                        <button className={menuItem} onClick={() => { close(); if (confirm(`Mark "${s.name}" as incomplete? It becomes active again and sends to any contacts or emails that are still waiting, in its next send window.`)) toggle.mutate(s); }}><RotateCcw size={14} /> Mark as incomplete</button>
                        <button className={menuItem} onClick={() => { close(); dup.mutate(s.id); }}><Copy size={14} /> Duplicate</button>
                      </> : (
                        <button className={menuItem} onClick={() => { close(); nav(`/${ws}/sequences/${s.id}/edit`); }}><Pencil size={14} /> Edit</button>
                      )}
                      <button className={cx(menuItem, "text-red-600")} onClick={() => { close(); if (confirm(`Delete "${s.name}"? This removes its stats too.`)) del.mutate(s.id); }}><Trash2 size={14} /> Delete</button>
                    </>}</RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!rows.length && <PagerBar page={Math.min(page, pages)} pageSize={pageSize} total={rows.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); try { localStorage.setItem("seq-page-size", String(n)); } catch { /* not saved */ } }} />}
    </div>
  );
}
