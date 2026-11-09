import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Ban, Bookmark, ChevronLeft, HelpCircle, Inbox, MailOpen, Plus, Reply, Search, Tag, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type Label, type Paged, type SenderProfile, type ThreadDetail, type ThreadRow } from "../api";
import { useMe, useWs } from "../App";
import { Avatar, cx, Empty, fmtDate, Modal, Spinner, Toggle, useToast } from "../ui";
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
  const labels = useQuery({ queryKey: ["labels", ws], queryFn: () => api<Label[]>(`/v1/workspaces/${ws}/labels`) });
  const counts = useQuery({ queryKey: ["thread-counts", ws], queryFn: () => api<{ all: number; unread: number; none: number; reminders: number }>(`/v1/workspaces/${ws}/threads/counts`) });
  const profiles = useQuery({ queryKey: ["sender-profiles", ws], queryFn: () => api<SenderProfile[]>(`/v1/workspaces/${ws}/sender-profiles`) });
  const filterQs = filtersToQuery(filters, profiles.data ?? []);
  const list = useQuery({
    queryKey: ["threads", ws, label, view, search, filterQs],
    queryFn: () => api<Paged<ThreadRow>>(`/v1/workspaces/${ws}/threads?view=${view}${label ? `&label=${label}` : ""}${search ? `&q=${encodeURIComponent(search)}` : ""}${filterQs ? `&${filterQs}` : ""}`),
    refetchInterval: 30_000,
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
      if (e.key === "j" || e.key === "k") {
        const idx = items.findIndex((t) => t.id === threadId);
        const next = items[e.key === "j" ? idx + 1 : Math.max(0, idx - 1)];
        if (next) nav(`/${ws}/inbox/${next.id}`);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [items, threadId, nav, ws]);

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

  const folder = (key: string, name: string, count?: number, color?: string, icon?: React.ReactNode) => (
    <button
      key={key}
      onClick={() => { setLabel(key); nav(`/${ws}/inbox`); }}
      className={cx("w-full flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm", label === key ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-600 hover:bg-ink-100")}
    >
      {icon ?? (color ? <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} /> : <Inbox size={16} />)}
      <span className="flex-1 text-left truncate">{name}</span>
      {!!count && (icon
        ? <span className="min-w-[22px] h-[22px] px-1.5 grid place-items-center rounded-md border border-brand-200 bg-brand-50 text-xs font-medium text-brand-700">{count}</span>
        : <span className="text-xs text-ink-400">{count}</span>)}
    </button>
  );

  return (
    <div className="flex h-full bg-surface">
      <div className={cx("w-[248px] shrink-0 border-r border-ink-200 flex-col", threadId ? "hidden xl:flex" : "hidden lg:flex")}>
        <div className="flex items-center gap-2 px-4 py-4 border-b border-ink-100">
          <h2 className="text-base font-semibold text-ink-900">Primebox</h2>
          <span className="text-ink-400 cursor-help" title="Every reply from every connected mailbox lands here. Label replies, reply in place, set reminders, or block a contact. Shortcuts: / to search, J and K to move between conversations.">
            <HelpCircle size={16} />
          </span>
          <div className="ml-auto"><FiltersButton ws={ws} value={filters} onChange={setFilters} /></div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
        {folder("", "All", counts.data?.all, undefined, <Inbox size={16} className="text-brand-600" />)}
        {folder("none", "No label", counts.data?.none, undefined, <Bookmark size={16} className="text-brand-600" />)}
        <div className="flex items-center justify-between px-2.5 mt-5 mb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-400">Labels</span>
          <label className="flex items-center gap-1.5 text-xs text-ink-500" title="Label out-of-office, automatic and unsubscribe replies automatically">
            Auto
            <Toggle checked={autoLabel} onChange={(v) => toggleAuto.mutate(v)} />
          </label>
        </div>
        {(labels.data ?? []).map((l) => folder(l.id, l.name, l.count, l.color))}
        <button className="w-full flex items-center gap-2 rounded-lg px-2.5 h-8 text-sm text-ink-500 hover:bg-ink-100 mt-1" onClick={() => setNewLabel(true)}>
          <Plus size={15} /> Add label
        </button>
        </div>
      </div>

      <div className={cx("w-full md:w-[380px] shrink-0 border-r border-ink-200 flex flex-col", threadId && "hidden md:flex")}>
        <div className="p-3 border-b border-ink-100 space-y-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input ref={searchRef} className="input pl-9 pr-8" placeholder="Search replies" value={q} onChange={(e) => setQ(e.target.value)} />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-400 border border-ink-200 rounded px-1">/</kbd>
          </div>
          <div className="flex gap-1">
            {(["all", "unread", "reminders"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx("btn-sm btn capitalize", view === v ? "bg-ink-900 text-ink-50" : "text-ink-600 hover:bg-ink-100")}>
                {v}{v === "unread" && counts.data?.unread ? ` (${counts.data.unread})` : ""}
              </button>
            ))}
            <div className={cx("ml-auto", threadId ? "xl:hidden" : "lg:hidden")}><FiltersButton ws={ws} value={filters} onChange={setFilters} /></div>
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
              <div className="sticky top-0 z-10 bg-ink-50/95 backdrop-blur px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{g.group}</div>
              {g.items.map((t) => {
                const name = t.contact ? `${t.contact.firstName} ${t.contact.lastName}`.trim() || t.contact.email : "Unknown";
                const l = t.labelId ? labelMap.get(t.labelId) : undefined;
                return (
                  <button
                    key={t.id}
                    onClick={() => nav(`/${ws}/inbox/${t.id}`)}
                    className={cx("w-full text-left flex gap-3 px-4 py-3 border-b border-ink-100 hover:bg-ink-50", threadId === t.id && "bg-brand-50/60")}
                  >
                    <Avatar name={name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cx("truncate text-sm", t.unread ? "font-semibold text-ink-900" : "text-ink-700")}>{name}</span>
                        {t.unread && <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />}
                        <span className="ml-auto text-xs text-ink-400 shrink-0">{fmtDate(t.lastMessageAt)}</span>
                      </div>
                      <div className="text-xs text-ink-500 truncate">{t.contact?.companyName || t.subject}</div>
                      <div className="text-xs text-ink-400 truncate mt-0.5">{t.snippet}</div>
                      <div className="flex gap-1 mt-1.5">
                        {l && <span className="chip" style={{ background: `${l.color}1a`, color: l.color }}>{l.name}</span>}
                        {t.reminderAt && <span className="chip bg-amber-50 text-amber-700"><AlarmClock size={11} />{fmtDate(t.reminderAt)}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className={cx("flex-1 min-w-0", !threadId && "hidden md:block")}>
        {threadId ? (
          <ThreadView key={threadId} id={threadId} labels={labels.data ?? []} onBack={() => nav(`/${ws}/inbox`)} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-ink-400">
            <div className="text-center">
              <MailOpen className="mx-auto mb-2" />
              Select a conversation · <kbd className="border border-ink-200 rounded px-1">J</kbd> / <kbd className="border border-ink-200 rounded px-1">K</kbd> to move
            </div>
          </div>
        )}
      </div>

      <NewLabelModal open={newLabel} onClose={() => setNewLabel(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["labels", ws] })} />
    </div>
  );
}

function ThreadView({ id, labels, onBack }: { id: string; labels: Label[]; onBack: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [composer, setComposer] = useState(false);
  const [body, setBody] = useState("");
  const [history, setHistory] = useState(true);
  const [reminder, setReminder] = useState(false);
  const thread = useQuery({ queryKey: ["thread", ws, id], queryFn: () => api<ThreadDetail>(`/v1/workspaces/${ws}/threads/${id}`) });

  useEffect(() => {
    if (thread.data) {
      qc.invalidateQueries({ queryKey: ["thread-counts", ws] });
      qc.invalidateQueries({ queryKey: ["threads", ws] });
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
  const send = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/threads/${id}/reply`, {
      body: { bodyHtml: body.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`).join(""), includeHistory: history },
    }),
    onSuccess: () => { setBody(""); setComposer(false); toast("Reply sent"); refresh(); },
    onError: (e: Error) => toast(e.message, "error"),
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-ink-200">
        <button className="btn-ghost btn-sm md:hidden" onClick={onBack}><ChevronLeft size={16} /></button>
        <div className="flex items-center gap-1.5">
          <Tag size={14} className="text-ink-400" />
          <select className="input h-8 w-auto text-sm" value={t.labelId ?? ""} onChange={(e) => patch.mutate({ labelId: e.target.value || null })}>
            <option value="">No label</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn-ghost btn-sm" title="Mark unread" onClick={() => patch.mutate({ unread: true })}><MailOpen size={16} /></button>
          <button className="btn-ghost btn-sm" title="Reminder" onClick={() => setReminder(true)}><AlarmClock size={16} /></button>
          <button className="btn-ghost btn-sm" title="Do not contact" onClick={() => confirm(`Add ${t.contact?.email} to do-not-contact?`) && dnc.mutate()}><Ban size={16} /></button>
          <button className="btn-ghost btn-sm" title="Delete" onClick={() => confirm("Delete this conversation?") && del.mutate()}><Trash2 size={16} /></button>
          <button className="btn-primary btn-sm" onClick={() => setComposer(true)}><Reply size={15} /> Reply</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6">
        <h2 className="text-lg font-semibold text-ink-900">{t.subject || "(no subject)"}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 mt-1 mb-6">
          <span>{contactName} · {t.contact?.email}</span>
          {t.contact?.companyName && <span>{t.contact.companyName}</span>}
          {t.sequence && <span>Sequence: {t.sequence.name}</span>}
          <span>Mailbox: {t.mailbox?.email}</span>
          {t.reminderAt && <span className="text-amber-700">Reminder {fmtDate(t.reminderAt, true)}</span>}
        </div>
        <div className="space-y-4 max-w-3xl">
          {t.messages.map((m) => (
            <div key={m.id} className={cx("rounded-xl border p-4", m.direction === "in" ? "bg-surface border-ink-200" : "bg-brand-50/40 border-brand-100 ml-0 md:ml-10")}>
              <div className="flex items-center gap-2 mb-3">
                <Avatar name={m.fromName || m.fromAddress} size={28} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink-800 truncate">{m.fromName || m.fromAddress}</div>
                  <div className="text-xs text-ink-400 truncate">{m.fromAddress} → {m.toAddress}</div>
                </div>
                <span className="ml-auto text-xs text-ink-400 shrink-0">{fmtDate(m.sentAt, true)}</span>
              </div>
              <div className="prose-mail text-sm text-ink-700 whitespace-pre-wrap break-words">{m.bodyText}</div>
            </div>
          ))}
        </div>
      </div>
      {composer && (
        <div className="border-t border-ink-200 p-4 bg-ink-50/60">
          <div className="card p-3">
            <div className="text-xs text-ink-500 mb-2">To: {t.contact?.email} · via {t.mailbox?.email}</div>
            <textarea className="textarea min-h-[140px] border-0 focus:ring-0 px-0" autoFocus placeholder="Write your reply…" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-ink-100">
              <label className="flex items-center gap-2 text-xs text-ink-600"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> Include thread history</label>
              <span className="text-xs text-ink-400">{body.trim() ? body.trim().split(/\s+/).length : 0} words</span>
              <div className="ml-auto flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => setComposer(false)}>Cancel</button>
                <button className="btn-primary btn-sm" disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Send"}</button>
              </div>
            </div>
          </div>
        </div>
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
