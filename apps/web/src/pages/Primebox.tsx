import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, AlarmClockPlus, Ban, Bookmark, Bot, CalendarCheck, CheckCircle2, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, HelpCircle, Inbox, Mail, MailOpen, MailX, Plane, Plus, Reply, Search, Tag, ThumbsDown, ThumbsUp, Trash2, UserX, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Label, type Paged, type SenderProfile, type ThreadDetail, type ThreadRow } from "../api";
import { useMe, useWs } from "../App";
import { ReplyComposer } from "./ReplyComposer";
import { Avatar, cx, Empty, fmtDate, Modal, SafeHtml, Spinner, Toggle, useToast } from "../ui";
import { activeFilterCount, EMPTY_FILTERS, FiltersButton, filtersToQuery, type InboxFilters } from "./PrimeboxFilters";

type View = "all" | "unread" | "reminders";

function dayGroup(d: string) {
  const date = new Date(d);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function PrimeboxPage() {
  const ws = useWs();
  const params = useParams();
  const threadId = params["*"]?.split("/")[0] || null;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState<string>("");
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [newLabel, setNewLabel] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS);
  const labels = useQuery({ queryKey: ["labels", ws], queryFn: () => api<Label[]>(`/v1/workspaces/${ws}/labels`), refetchInterval: 15_000 });
  const counts = useQuery({ queryKey: ["thread-counts", ws], queryFn: () => api<{ all: number; unread: number; none: number; reminders: number }>(`/v1/workspaces/${ws}/threads/counts`), refetchInterval: 15_000 });
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`) });
  const filterQs = filtersToQuery(filters, profiles.data ?? []);
  // Tell the person when a new reply arrives, without them having to look.
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    const n = counts.data?.unread;
    if (n === undefined) return;
    if (lastUnread.current !== null && n > lastUnread.current) toast(`${n - lastUnread.current} new repl${n - lastUnread.current === 1 ? "y" : "ies"} received`);
    lastUnread.current = n;
  }, [counts.data?.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery({
    queryKey: ["threads", ws, label, view, search, filterQs],
    queryFn: () => api<Paged<ThreadRow>>(`/v1/workspaces/${ws}/threads?view=${view}${label ? `&label=${label}` : ""}${search ? `&q=${encodeURIComponent(search)}` : ""}${filterQs ? `&${filterQs}` : ""}`),
    refetchInterval: 15_000,
  });

  const items = list.data?.items ?? [];
  const labelMap = useMemo(() => new Map((labels.data ?? []).map((l) => [l.id, l])), [labels.data]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const me = useMe();
  const autoLabel = me.data?.workspaces.find((w) => w.slug === ws)?.autoLabel ?? true;
  const toggleAuto = useMutation({
    mutationFn: (v: boolean) => api(`/v1/workspaces/${ws}`, { method: "PATCH", body: { autoLabel: v } }),
    onSuccess: () => { toast("Auto-label setting saved"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });

  const grouped = useMemo(() => {
    const out: { group: string; items: ThreadRow[] }[] = [];
    for (const t of items) {
      const g = dayGroup(t.lastMessageAt);
      if (out.at(-1)?.group !== g) out.push({ group: g, items: [] });
      out.at(-1)!.items.push(t);
    }
    return out;
  }, [items]);

  // One row in the left list: an icon, the name, a small badge for unread conversations, and the total number.
  const folder = (key: string, name: string, count?: number, color?: string, icon?: React.ReactNode, unread?: number) => {
    const LabelIcon = color ? LABEL_ICONS[name] : undefined;
    return (
      <button
        key={key}
        onClick={() => { setLabel(key); nav(`/${ws}/inbox`); }}
        className={cx("w-full flex items-center gap-3 rounded-lg px-2.5 h-9 text-sm", label === key ? "bg-ink-100 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-50")}
        title={`${count ?? 0} conversation${count === 1 ? "" : "s"}${unread ? `, ${unread} unread` : ""}`}
      >
        {icon ?? (LabelIcon ? <LabelIcon size={18} className="text-ink-500 shrink-0" /> : color ? <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} /> : <Inbox size={18} />)}
        <span className="flex-1 text-left truncate">{name}</span>
        {!!unread && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md border border-brand-200 bg-brand-50 text-[11px] font-medium text-brand-700" aria-label={`${unread} unread`}>{unread}</span>}
        <span className={cx("min-w-[18px] text-right text-[11px] tabular-nums", count ? "text-ink-500" : "text-ink-300")}>{count ?? 0}</span>
      </button>
    );
  };

  return (
    <div className="flex h-full bg-surface">
      <div className={cx("w-[270px] shrink-0 border-r border-ink-200 flex-col", threadId ? "hidden xl:flex" : "hidden lg:flex")}>
        <div className="flex items-center gap-2 px-4 py-4 border-b border-ink-100">
          <h2 className="text-base font-semibold text-ink-900">Primebox</h2>
          <span className="text-ink-400 cursor-help" title="Every reply from every connected mailbox lands here. Label replies, reply in place, set reminders, or block a contact. Press / to search.">
            <HelpCircle size={16} />
          </span>
          <div className="ml-auto"><FiltersButton ws={ws} value={filters} onChange={setFilters} /></div>
        </div>
        <div className="flex-1 overflow-y-auto p-3.5">
        {folder("", "All", counts.data?.all, undefined, <Inbox size={18} className="text-brand-600" />, counts.data?.unread)}
        {folder("none", "No label", counts.data?.none, undefined, <Bookmark size={18} className="text-brand-600" />)}
        <div className="flex items-center justify-between px-2.5 mt-5 mb-2">
          <span className="text-[13px] text-ink-500">Labels</span>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-600" title="Label out-of-office, automatic and unsubscribe replies automatically">
            Auto-label
            <Toggle checked={autoLabel} onChange={(v) => toggleAuto.mutate(v)} />
          </label>
        </div>
        {(labels.data ?? []).map((l) => folder(l.id, l.name, l.count, l.color, undefined, l.unread))}
        <button className="w-full flex items-center gap-2 rounded-lg px-2.5 h-9 text-sm font-medium text-brand-700 hover:bg-ink-50 mt-1" onClick={() => setNewLabel(true)}>
          <Plus size={18} /> Add new label
        </button>
        </div>
      </div>

      <div className={cx("min-w-0 flex flex-col", threadId ? "hidden md:flex md:w-[345px] shrink-0 border-r border-ink-200" : "flex-1")}>
        <div className={cx("flex items-stretch border-b border-ink-100 min-h-14", threadId ? "flex-nowrap px-4 gap-4" : "flex-wrap px-6 gap-x-6")}>
          <div className="flex gap-4 text-sm items-end">
            {(["all", "unread", "reminders"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx("tab capitalize pt-4 pb-[17px]", view === v && "tab-active")}>
                {v}{v === "unread" && counts.data?.unread ? ` (${counts.data.unread})` : ""}
              </button>
            ))}
          </div>
          <div className={cx("relative ml-auto self-center", threadId ? "w-[130px]" : "w-72 lg:w-80")}>
            <input ref={searchRef} className="input pr-9 shadow-sm" placeholder="Search" aria-label="Search replies" value={q} onChange={(e) => setQ(e.target.value)} />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 border border-ink-200 rounded px-1.5 bg-ink-50">/</kbd>
          </div>
          <div className={cx("flex gap-2 self-center", threadId ? "xl:hidden" : "lg:hidden")}>
            <FiltersButton ws={ws} value={filters} onChange={setFilters} />
            <select className="lg:hidden input h-8 w-auto text-xs" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">All labels</option>
              <option value="none">No label</option>
              {(labels.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? <Spinner /> : !items.length ? (
            activeFilterCount(filters) > 0
              ? <Empty icon={<Inbox size={20} />} title="No replies match these filters" text="Try removing a filter to see more conversations." action={<button className="btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>} />
              : <Empty icon={<Inbox size={20} />} title="No replies yet" text="Replies from every connected mailbox land here. Launch a sequence to start conversations." />
          ) : grouped.map((g) => (
            <div key={g.group}>
              <div className={cx("flex items-center gap-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400", threadId ? "px-4" : "px-6")}>
                <span>{g.group}</span><span className="h-px flex-1 bg-ink-100" />
              </div>
              {g.items.map((t) => (
                <ThreadRowItem key={t.id} t={t} label={t.labelId ? labelMap.get(t.labelId) : undefined} compact={!!threadId} active={threadId === t.id} onOpen={() => nav(`/${ws}/inbox/${t.id}`)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {threadId && (
        <div className="flex-1 min-w-0">
          <ThreadView key={threadId} id={threadId} labels={labels.data ?? []} onBack={() => nav(`/${ws}/inbox`)} />
        </div>
      )}

      <NewLabelModal open={newLabel} onClose={() => setNewLabel(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["labels", ws] })} />
    </div>
  );
}

// What each reply label looks like in the list: a small icon in the label's colour, with the name on hover.
const LABEL_ICONS: Record<string, LucideIcon> = {
  Positive: ThumbsUp, Negative: ThumbsDown, "Wrong contact": UserX, "Not at this time": Clock, "Meeting booked": CalendarCheck,
  "Meeting completed": CalendarCheck, Closed: CheckCircle2, Automatic: Bot, "Out of office": Plane, Unsubscribed: MailX,
};

// "3:42 PM" today, "Fri" within the last week, otherwise "Nov 14".
function shortWhen(d: string) {
  const date = new Date(d);
  const days = Math.floor((new Date(new Date().toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (days <= 0) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ThreadRowItem({ t, label, compact, active, onOpen }: { t: ThreadRow; label?: Label; compact: boolean; active: boolean; onOpen: () => void }) {
  const toast = useToast();
  const name = t.contact ? `${t.contact.firstName} ${t.contact.lastName}`.trim() || t.contact.email : "Unknown";
  const email = t.contact?.email;
  const Icon = label ? LABEL_ICONS[label.name] : undefined;
  const text = t.snippet || t.subject;
  const unread = t.unread;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(email ?? ""); toast("Email address copied"); } catch { toast("Could not copy", "error"); }
  };
  const labelMark = label && (
    <span title={label.name} aria-label={label.name} className="shrink-0 grid place-items-center w-6" style={{ color: label.color }}>
      {Icon ? <Icon size={17} /> : <span className="w-2.5 h-2.5 rounded-full" style={{ background: label.color }} />}
    </span>
  );
  const when = (
    <span className={cx("shrink-0 text-sm flex items-center gap-1.5", unread ? "text-ink-700 font-medium" : "text-ink-400")}>
      {t.reminderAt && <AlarmClock size={13} className="text-amber-600" aria-label="Reminder set" />}
      {shortWhen(t.lastMessageAt)}
    </span>
  );
  // Narrow list (a conversation is open): name and day on the first line, two lines of the reply, then the label with its icon.
  if (compact) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        className={cx("group flex items-start gap-2.5 pl-4 pr-5 py-3 cursor-pointer border-b border-ink-100 hover:bg-ink-50 focus:outline-none focus-visible:bg-ink-50", active && "bg-ink-50 shadow-[inset_3px_0_0_rgb(var(--brand-600))]")}
      >
        <span className="relative shrink-0 mt-0.5">
          <Avatar name={name} size={32} />
          <span className={cx("absolute -bottom-1 -right-1 grid place-items-center w-4 h-4 rounded-full bg-surface", unread ? "text-brand-600" : "text-ink-300")} aria-label={unread ? "Unread" : "Read"}>
            {unread ? <Mail size={11} /> : <MailOpen size={11} />}
          </span>
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="relative min-w-0">
              <span className={cx("block truncate text-sm", unread ? "font-semibold text-ink-900" : "font-medium text-ink-800")}>{name}</span>
              {email && (
                <span className="pointer-events-none group-hover:pointer-events-auto absolute left-0 bottom-full mb-1.5 z-30 hidden group-hover:block">
                  <span className="block rounded-lg bg-ink-900 text-white px-3 py-2 shadow-xl whitespace-nowrap">
                    <span className="block text-xs font-semibold">{name}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs"><Mail size={12} className="text-brand-300" />{email}
                      <button type="button" onClick={copy} className="ml-1 text-ink-300 hover:text-white" title="Copy email address" aria-label="Copy email address"><Copy size={12} /></button>
                    </span>
                  </span>
                </span>
              )}
            </span>
            <span className="ml-auto shrink-0 text-xs text-ink-400 flex items-center gap-1">
              {t.reminderAt && <AlarmClock size={12} className="text-amber-600" aria-label="Reminder set" />}
              {shortWhen(t.lastMessageAt)}
            </span>
          </span>
          <span className={cx("mt-0.5 text-sm leading-5 break-words", unread ? "text-ink-800" : "text-ink-600")} style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{text}</span>
          {label && (
            <span className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: label.color }}>
              {Icon ? <Icon size={16} /> : <span className="w-2.5 h-2.5 rounded-full" style={{ background: label.color }} />}
              {label.name}
            </span>
          )}
        </span>
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cx("group flex items-center gap-3 cursor-pointer border-b border-ink-100/70 hover:bg-ink-50 focus:outline-none focus-visible:bg-ink-50", compact ? "px-4 py-2.5" : "px-6 py-2.5", active && "bg-brand-50/60")}
    >
      <span className="relative shrink-0">
        <Avatar name={name} />
        <span className={cx("absolute -bottom-1 -right-1 grid place-items-center w-4 h-4 rounded-full bg-surface", unread ? "text-brand-600" : "text-ink-300")} aria-label={unread ? "Unread" : "Read"}>
          {unread ? <Mail size={12} /> : <MailOpen size={12} />}
        </span>
      </span>
      <span className={cx("relative shrink-0", compact ? "w-28" : "w-44")}>
        <span className={cx("block truncate text-[15px]", unread ? "font-semibold text-ink-900" : "text-ink-700")}>{name}</span>
        {email && (
          <span className="pointer-events-none group-hover:pointer-events-auto absolute left-0 bottom-full mb-2 z-30 hidden group-hover:block">
            <span className="block rounded-xl bg-ink-900 text-white px-4 py-3 shadow-xl whitespace-nowrap">
              <span className="block text-sm font-semibold">{name}</span>
              <span className="mt-1.5 flex items-center gap-2 text-sm"><Mail size={14} className="text-brand-300" />{email}
                <button type="button" onClick={copy} className="ml-1 text-ink-300 hover:text-white" title="Copy email address" aria-label="Copy email address"><Copy size={14} /></button>
              </span>
            </span>
          </span>
        )}
      </span>
      {compact ? (
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1">
            {labelMark}
            <span className="flex-1" />
            {when}
          </span>
          <span className={cx("block truncate text-xs", unread ? "text-ink-800 font-medium" : "text-ink-500")}>{text}</span>
        </span>
      ) : (
        <>
          <span className="w-6 shrink-0 grid place-items-center">{labelMark}</span>
          <span className={cx("flex-1 min-w-0 truncate text-[15px]", unread ? "text-ink-900 font-medium" : "text-ink-500")}>{text}</span>
          <span className="w-16 text-right">{when}</span>
        </>
      )}
    </div>
  );
}

// The label box at the top of a conversation: shows the current label and opens a list. Press L to open it.
function LabelPicker({ labels, value, onPick }: { labels: Label[]; value: string | null; onPick: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = labels.find((l) => l.id === value);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "l" || e.key === "L") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const item = (id: string | null, name: string, color?: string) => (
    <button key={id ?? "none"} className={cx("w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left hover:bg-ink-50", id === value && "bg-ink-50 font-medium")}
      onClick={() => { onPick(id); setOpen(false); }}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color ?? "transparent", border: color ? undefined : "1px solid rgb(var(--ink-300))" }} />
      <span className="flex-1 truncate">{name}</span>
      {id === value && <Check size={15} className="text-brand-600" />}
    </button>
  );
  return (
    <div className="relative min-w-0 shrink" ref={ref}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 w-48 max-w-full h-[34px] rounded-lg border border-ink-200 bg-surface pl-3 pr-2.5 text-sm text-ink-800 shadow-sm hover:border-ink-300">
        {current && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: current.color }} />}
        <span className="flex-1 text-left truncate">{current?.name ?? "No label"}</span>
        <kbd className="grid place-items-center w-5 h-5 rounded bg-ink-100 text-[11px] font-medium text-ink-500">L</kbd>
        <ChevronDown size={16} className={cx("text-ink-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-12 z-30 w-64 card p-1.5 max-h-80 overflow-y-auto">
          {item(null, "No label")}
          {labels.map((l) => item(l.id, l.name, l.color))}
        </div>
      )}
    </div>
  );
}

// Emails sent before the spacing was fixed were stored with extra blank lines and a gap above the opt-out line. When one is shown here it is
// tidied to the layout new emails are sent with: at most one blank line, and the small opt-out line right under the signature.
const tidySentHtml = (html: string) => html
  .replace(/(?:<br\s*\/?>\s*){3,}/gi, "<br><br>")
  // After a block (<div> or <p>) one <br> already makes a blank line, so two would show two.
  .replace(/(<\/(?:div|p)>)(?:<br\s*\/?>\s*){2}/gi, "$1<br>")
  .replace(/(?:<br\s*\/?>\s*){2}(<span style="font-size:12px[^"]*">)/gi, (_m, span: string) => `<br>${span.replace("font-size:12px", "font-size:10px;line-height:1.3")}`);

// First line of a message, for the folded view.
const replyOwnLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 140);

function ThreadView({ id, labels, onBack }: { id: string; labels: Label[]; onBack: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [composer, setComposer] = useState(false);
  const [reminder, setReminder] = useState(false);
  // A new reply in the open conversation appears by itself.
  const thread = useQuery({ queryKey: ["thread", ws, id], queryFn: () => api<ThreadDetail>(`/v1/workspaces/${ws}/threads/${id}`), refetchInterval: 15_000 });

  useEffect(() => {
    if (thread.data) {
      // Opening a conversation marks it read, so the unread numbers next to the labels and in the tabs go down straight away.
      qc.invalidateQueries({ queryKey: ["thread-counts", ws] });
      qc.invalidateQueries({ queryKey: ["threads", ws] });
      qc.invalidateQueries({ queryKey: ["labels", ws] });
    }
  }, [thread.data, qc, ws]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["thread", ws, id] });
    qc.invalidateQueries({ queryKey: ["threads", ws] });
    qc.invalidateQueries({ queryKey: ["labels", ws] });
    qc.invalidateQueries({ queryKey: ["thread-counts", ws] });
  };

  const patch = useMutation({
    mutationFn: (b: Record<string, unknown>) => api(`/v1/workspaces/${ws}/threads/${id}`, { method: "PATCH", body: b }),
    onSuccess: refresh,
  });
  const dnc = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/threads/${id}/dnc`, { body: { scope: "email" } }),
    onSuccess: () => toast("Added to do-not-contact; active sequences stopped"),
  });
  const del = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/threads/${id}`, { method: "DELETE" }),
    onSuccess: () => { refresh(); onBack(); },
  });

  if (thread.isLoading || !thread.data) return <Spinner />;
  const t = thread.data;
  const contactName = t.contact ? `${t.contact.firstName} ${t.contact.lastName}`.trim() || t.contact.email : "Unknown";
  // How many emails we sent in this conversation, who they went to, and how many replies came back.
  const sentMsgs = t.messages.filter((m) => m.direction === "out");
  const replyCount = t.messages.length - sentMsgs.length;
  const sentTo = [...new Set(sentMsgs.map((m) => m.toAddress))];
  const sentNumber = new Map(sentMsgs.map((m, k) => [m.id, k + 1]));

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-nowrap items-center gap-2 px-4 h-14 border-b border-ink-200">
        <button className="btn-ghost btn-sm md:hidden shrink-0" onClick={onBack} aria-label="Back to the list"><ChevronLeft size={16} /></button>
        <LabelPicker labels={labels} value={t.labelId} onPick={(id) => patch.mutate({ labelId: id })} />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button className="grid place-items-center w-9 h-9 rounded-md text-ink-700 hover:bg-ink-100" title="Set a reminder" aria-label="Set a reminder" onClick={() => setReminder(true)}><AlarmClockPlus size={20} /></button>
          <button className="grid place-items-center w-9 h-9 rounded-md text-ink-700 hover:bg-ink-100" title="Do not contact" aria-label="Do not contact" onClick={() => confirm(`Add ${t.contact?.email} to do-not-contact?`) && dnc.mutate()}><UserX size={20} /></button>
          <button className="grid place-items-center w-9 h-9 rounded-md text-ink-700 hover:bg-ink-100" title="Delete conversation" aria-label="Delete conversation" onClick={() => confirm("Delete this conversation?") && del.mutate()}><Trash2 size={20} /></button>
          <button className="grid place-items-center w-9 h-9 rounded-md text-ink-700 hover:bg-ink-100" title="Reply" aria-label="Reply" onClick={() => setComposer(true)}><Reply size={20} /></button>
          <button className="ml-3 px-2 h-9 whitespace-nowrap text-sm font-semibold text-ink-700 hover:text-ink-900" onClick={onBack}>Collapse thread</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="text-xs text-ink-500">Subject</div>
        <h2 className="text-base font-semibold text-ink-900 mt-0.5">{t.subject || "(no subject)"}</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-400 mt-1">
          {t.contact?.companyName && <span>{t.contact.companyName}</span>}
          {t.sequence && <span>Sequence: {t.sequence.name}</span>}
          <span>Mailbox: {t.mailbox?.email}</span>
          {t.reminderAt && <span className="text-amber-700">Reminder {fmtDate(t.reminderAt, true)}</span>}
        </div>
        <div className="mt-3 max-w-3xl flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2 text-xs text-ink-700" data-testid="thread-summary">
          <span><b className="text-ink-900">{sentMsgs.length}</b> email{sentMsgs.length === 1 ? "" : "s"} sent</span>
          <span>to <b className="text-ink-900">{sentTo.length ? sentTo.join(", ") : (t.contact?.email ?? "-")}</b></span>
          <span>from <b className="text-ink-900">{t.mailbox?.email}</b></span>
          <span><b className="text-ink-900">{replyCount}</b> repl{replyCount === 1 ? "y" : "ies"} received</span>
        </div>
        <div className="max-w-3xl">
          {/* Newest first: the reply you need to answer is on top, the rest of the thread is underneath. */}
          {[...t.messages].reverse().map((m, i, ordered) => {
            const day = dayGroup(m.sentAt);
            const newDay = i === 0 || dayGroup(ordered[i - 1]!.sentAt) !== day;
            const from = m.fromName || m.fromAddress;
            const toName = m.direction === "in" ? (t.mailbox?.email.split("@")[0] ?? m.toAddress) : (contactName || m.toAddress);
            return (
              <div key={m.id}>
                {i === 1 && (
                  <div className="mt-1 mb-2 text-xs font-semibold text-ink-500">Earlier in this thread</div>
                )}
                {newDay && (
                  <div className="flex items-center gap-3 my-3 text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    <span className="h-px flex-1 bg-ink-100" />{day}<span className="h-px flex-1 bg-ink-100" />
                  </div>
                )}
                <div className="flex gap-2.5 mb-4">
                  <span className="relative shrink-0 mt-0.5">
                    <Avatar name={from} size={32} />
                    <span className="absolute -bottom-1 -right-1 grid place-items-center w-3.5 h-3.5 rounded-full bg-surface text-brand-600"><Mail size={10} /></span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-medium text-ink-800 truncate">{from}</span>
                      {i === 0 && m.direction === "in" && <span className="chip bg-brand-50 text-brand-700 shrink-0">Latest reply</span>}
                      {m.direction === "out" && <span className="chip bg-ink-100 text-ink-600 shrink-0">Sent {sentNumber.get(m.id)} of {sentMsgs.length}</span>}
                      <ChevronRight size={12} className="text-ink-400 shrink-0" />
                      <Avatar name={toName} size={16} />
                      <span className="text-ink-600 truncate">{toName}</span>
                      <span className="ml-auto text-[11px] text-ink-400 shrink-0">{fmtDate(m.sentAt, true)}</span>
                    </div>
                    <div className="text-xs text-ink-500 truncate">{m.fromAddress}{m.direction === "out" && <> &rarr; {m.toAddress}</>}</div>
                    <div className={cx("mt-2.5 rounded-lg border overflow-hidden", m.direction === "in" ? "border-ink-200 bg-surface" : "border-brand-100 bg-surface")}>
                      {/* The message as it was written: fonts, spacing, links and the signature, not plain text. */}
                      {m.bodyHtml?.trim()
                        ? <SafeHtml html={m.direction === "out" ? tidySentHtml(m.bodyHtml) : m.bodyHtml} minHeight={40} />
                        : <div className="p-3 text-sm leading-6 text-ink-900 whitespace-pre-wrap break-words">{m.bodyText}</div>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {composer && (
        <ReplyComposer threadId={id} messages={t.messages} onClose={() => setComposer(false)} onReminder={() => setReminder(true)} onSent={() => { setComposer(false); refresh(); }} />
      )}
      <ReminderModal open={reminder} onClose={() => setReminder(false)} current={t.reminderAt} onSave={(d) => { patch.mutate({ reminderAt: d }); setReminder(false); }} />
    </div>
  );
}

function ReminderModal({ open, onClose, current, onSave }: { open: boolean; onClose: () => void; current: string | null; onSave: (d: string | null) => void }) {
  const [value, setValue] = useState("");
  const quick = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    onSave(d.toISOString());
  };
  return (
    <Modal open={open} onClose={onClose} title="Set a reminder" footer={<>
      {current && <button className="btn-ghost mr-auto" onClick={() => onSave(null)}>Clear reminder</button>}
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!value} onClick={() => onSave(new Date(value).toISOString())}>Save</button>
    </>}>
      <div className="flex flex-wrap gap-2 mb-4">
        <button className="btn-secondary btn-sm" onClick={() => quick(1)}>Tomorrow 9am</button>
        <button className="btn-secondary btn-sm" onClick={() => quick(3)}>In 3 days</button>
        <button className="btn-secondary btn-sm" onClick={() => quick(7)}>Next week</button>
      </div>
      <label className="label">Custom date and time</label>
      <input className="input" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  );
}

function NewLabelModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6B2737");
  const [countsAs, setCountsAs] = useState("neutral");
  const create = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/labels`, { body: { name, color, countsAs } }),
    onSuccess: () => { onCreated(); onClose(); setName(""); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add label" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!name.trim()} onClick={() => create.mutate()}>Create</button>
    </>}>
      <div className="space-y-4">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="flex gap-4">
          <div><label className="label">Colour</label><input type="color" className="h-9 w-16 rounded border border-ink-200" value={color} onChange={(e) => setColor(e.target.value)} /></div>
          <div className="flex-1">
            <label className="label">Counts in analytics as</label>
            <select className="input" value={countsAs} onChange={(e) => setCountsAs(e.target.value)}>
              <option value="neutral">Neutral</option><option value="positive">Positive</option><option value="meeting">Meeting</option>
              <option value="closed">Closed</option><option value="negative">Negative</option>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
