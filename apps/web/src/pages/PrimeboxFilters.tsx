import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ChevronRight, Mail, Send, SlidersHorizontal, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Mailbox, type SenderProfile, type SequenceRow } from "../api";
import { cx } from "../ui";

type Mode = "include" | "exclude";
interface ListFilter { mode: Mode; ids: string[] }
export interface InboxFilters {
  sequence: ListFilter;
  mailbox: ListFilter;
  profile: ListFilter;
  reminder: "" | "with" | "without";
}

export const EMPTY_FILTERS: InboxFilters = {
  sequence: { mode: "include", ids: [] },
  mailbox: { mode: "include", ids: [] },
  profile: { mode: "include", ids: [] },
  reminder: "",
};

export function activeFilterCount(f: InboxFilters) {
  return [f.sequence.ids.length, f.mailbox.ids.length, f.profile.ids.length, f.reminder ? 1 : 0].filter(Boolean).length;
}

// Rotations are expanded to their mailboxes, since threads belong to mailboxes.
export function filtersToQuery(f: InboxFilters, profiles: SenderProfile[]): string {
  const profileMailboxes = profiles.filter((p) => f.profile.ids.includes(p.id)).flatMap((p) => p.mailboxes.map((m) => m.id));
  const inc = new Set<string>();
  const exc = new Set<string>();
  for (const id of f.mailbox.ids) (f.mailbox.mode === "include" ? inc : exc).add(id);
  for (const id of profileMailboxes) (f.profile.mode === "include" ? inc : exc).add(id);
  const p = new URLSearchParams();
  if (f.sequence.ids.length) p.set(f.sequence.mode === "include" ? "sequenceIds" : "excludeSequenceIds", f.sequence.ids.join(","));
  if (inc.size) p.set("mailboxIds", [...inc].join(","));
  if (exc.size) p.set("excludeMailboxIds", [...exc].join(","));
  if (f.reminder) p.set("reminder", f.reminder);
  // A profile with no mailboxes selected as "include" should match nothing rather than everything.
  if (f.profile.mode === "include" && f.profile.ids.length && !profileMailboxes.length && !f.mailbox.ids.length) p.set("mailboxIds", "00000000-0000-0000-0000-000000000000");
  return p.toString();
}

type Category = "sequence" | "mailbox" | "profile" | "reminder";

export function FiltersButton({ ws, value, onChange }: { ws: string; value: InboxFilters; onChange: (f: InboxFilters) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<Category>("sequence");
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const sequences = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`), enabled: open });
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`), enabled: open });
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`) });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  useEffect(() => setQ(""), [cat]);

  const options = useMemo(() => {
    if (cat === "sequence") return (sequences.data ?? []).map((s) => ({ id: s.id, label: s.name }));
    if (cat === "mailbox") return (mailboxes.data ?? []).map((m) => ({ id: m.id, label: m.email }));
    if (cat === "profile") return (profiles.data ?? []).map((p) => ({ id: p.id, label: p.name }));
    return [];
  }, [cat, sequences.data, mailboxes.data, profiles.data]);
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));

  const count = activeFilterCount(value);
  const cats: { k: Category; label: string; icon: React.ReactNode; n: number }[] = [
    { k: "sequence", label: "Sequence", icon: <Send size={15} />, n: value.sequence.ids.length },
    { k: "mailbox", label: "Mailbox", icon: <Mail size={15} />, n: value.mailbox.ids.length },
    { k: "profile", label: "Rotation", icon: <Users size={15} />, n: value.profile.ids.length },
    { k: "reminder", label: "Reminder", icon: <AlarmClock size={15} />, n: value.reminder ? 1 : 0 },
  ];

  const list = cat !== "reminder" ? value[cat] : null;
  const setList = (next: ListFilter) => cat !== "reminder" && onChange({ ...value, [cat]: next });
  const toggle = (id: string) => list && setList({ ...list, ids: list.ids.includes(id) ? list.ids.filter((x) => x !== id) : [...list.ids, id] });

  return (
    <div className="relative" ref={ref}>
      <button className={cx("btn-secondary btn-sm", count > 0 && "border-brand-500 text-brand-700")} onClick={() => setOpen((o) => !o)}>
        <SlidersHorizontal size={15} /> Filters{count > 0 && <span className="chip bg-brand-600 text-white ml-0.5">{count}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 w-[min(560px,calc(100vw-32px))] card flex flex-col sm:flex-row overflow-hidden">
          <div className="sm:w-48 border-b sm:border-b-0 sm:border-r border-ink-100 p-1.5 flex sm:flex-col overflow-x-auto">
            {cats.map((c) => (
              <button key={c.k} onClick={() => setCat(c.k)}
                className={cx("flex items-center gap-2 rounded-md px-2.5 h-9 text-sm whitespace-nowrap", cat === c.k ? "bg-brand-50 text-brand-700 font-medium" : "hover:bg-ink-50")}>
                {c.icon}<span className="flex-1 text-left">{c.label}</span>
                {c.n > 0 && <span className="chip bg-brand-600 text-white">{c.n}</span>}
                <ChevronRight size={14} className="hidden sm:block text-ink-400" />
              </button>
            ))}
            {count > 0 && (
              <button className="sm:mt-auto flex items-center gap-1.5 rounded-md px-2.5 h-9 text-sm text-red-600 hover:bg-red-50 whitespace-nowrap" onClick={() => onChange(EMPTY_FILTERS)}>
                <X size={14} /> Clear all
              </button>
            )}
          </div>
          <div className="flex-1 p-3 min-h-[260px] flex flex-col">
            {cat === "reminder" ? (
              <div className="space-y-1">
                {([["", "Any"], ["with", "Has a reminder"], ["without", "No reminder"]] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm cursor-pointer hover:bg-ink-50">
                    <input type="radio" name="reminder" checked={value.reminder === v} onChange={() => onChange({ ...value, reminder: v })} /> {l}
                  </label>
                ))}
              </div>
            ) : list && (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex rounded-lg bg-ink-100 p-0.5">
                    {(["include", "exclude"] as Mode[]).map((m) => (
                      <button key={m} className={cx("px-3 h-7 rounded-md text-xs font-medium capitalize", list.mode === m ? "bg-surface shadow-card" : "text-ink-500")} onClick={() => setList({ ...list, mode: m })}>{m}</button>
                    ))}
                  </div>
                  <button className="ml-auto text-xs text-brand-700 font-medium" onClick={() => setList({ ...list, ids: list.ids.length === options.length ? [] : options.map((o) => o.id) })}>
                    {list.ids.length === options.length && options.length ? "Clear" : "Select all"}
                  </button>
                </div>
                <input className="input h-8 mb-2" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
                <div className="flex-1 overflow-y-auto max-h-56 -mx-1">
                  {!shown.length ? (
                    <div className="text-sm text-ink-500 px-2 py-6 text-center">{options.length ? "No matches" : `No ${cat === "profile" ? "rotations" : `${cat}s`} yet`}</div>
                  ) : shown.map((o) => (
                    <label key={o.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-ink-50">
                      <input type="checkbox" checked={list.ids.includes(o.id)} onChange={() => toggle(o.id)} />
                      <span className="truncate">{o.label}</span>
                    </label>
                  ))}
                </div>
                {list.ids.length > 0 && <div className="text-xs text-ink-500 pt-2">{list.mode === "include" ? "Showing only" : "Hiding"} replies from {list.ids.length} selected</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
