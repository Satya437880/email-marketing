import { useQuery } from "@tanstack/react-query";
import { Ban, CalendarDays, Check, ChevronDown, ChevronRight, Mail, MessageSquare, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, type Mailbox, type SequenceRow, type Tag } from "../api";
import { cx, PortalMenu } from "../ui";

type Mode = "include" | "exclude";
interface ListF { mode: Mode; values: string[] }
type ListCat = "sequence" | "tag" | "mailbox" | "dnc" | "response";
type Cat = ListCat | "status" | "date";
export type EmailStatus = "all" | "scheduled" | "sent";
export interface DateF { preset: "" | "today" | "week" | "custom"; from: string; to: string }

// The Filters panel on the Emails page.
export type EmailFilterState = Record<ListCat, ListF> & { date: DateF };

const empty = (): ListF => ({ mode: "include", values: [] });
export const NO_EMAIL_FILTERS: EmailFilterState = { sequence: empty(), tag: empty(), mailbox: empty(), dnc: empty(), response: empty(), date: { preset: "", from: "", to: "" } };

const CATS: { key: ListCat; label: string }[] = [
  { key: "sequence", label: "Sequence" }, { key: "tag", label: "Tag" }, { key: "mailbox", label: "Mailbox" }, { key: "dnc", label: "DNC" }, { key: "response", label: "Responses" },
];
const STATUS_OPTIONS: { id: EmailStatus; label: string }[] = [{ id: "all", label: "All emails" }, { id: "scheduled", label: "Scheduled" }, { id: "sent", label: "Sent" }];
const DATE_OPTIONS: { id: DateF["preset"]; label: string }[] = [{ id: "", label: "Any time" }, { id: "today", label: "Today" }, { id: "week", label: "This week" }, { id: "custom", label: "Pick days (calendar)" }];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const parseDay = (v: string) => { const [y, m, d] = v.split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const dateActive = (d: DateF) => d.preset === "today" || d.preset === "week" || (d.preset === "custom" && (!!parseDay(d.from) || !!parseDay(d.to)));

// The date range as exact moments (in this computer's time zone), for the server.
export function emailDateRange(d: DateF): { from?: string; to?: string } {
  const now = new Date();
  if (d.preset === "today") return { from: dayStart(now).toISOString(), to: dayEnd(now).toISOString() };
  if (d.preset === "week") {
    const monday = dayStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)));
    return { from: monday.toISOString(), to: dayEnd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)).toISOString() };
  }
  if (d.preset === "custom") {
    const a = parseDay(d.from), b = parseDay(d.to);
    return { ...(a ? { from: dayStart(a).toISOString() } : {}), ...(b ? { to: dayEnd(b).toISOString() } : {}) };
  }
  return {};
}
const DNC_OPTIONS = [{ id: "on", label: "On the Do not contact list" }, { id: "off", label: "Not on the Do not contact list" }];
const RESPONSE_OPTIONS = [
  { id: "replied", label: "Replied" }, { id: "no_reply", label: "No reply yet" }, { id: "bounced", label: "Bounced" },
  { id: "unsubscribed", label: "Unsubscribed" }, { id: "ooo", label: "Out of office" },
];

export const activeEmailFilters = (f: EmailFilterState) => CATS.filter((c) => f[c.key].values.length > 0).length + (dateActive(f.date) ? 1 : 0);

// What is sent to the server (only the filters that are set).
export function emailFiltersToParam(f: EmailFilterState): string | undefined {
  const o = Object.fromEntries(CATS.filter((c) => f[c.key].values.length).map((c) => [c.key, f[c.key]]));
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}

export function EmailFiltersButton({ ws, value, onChange, status, onStatus }: { ws: string; value: EmailFilterState; onChange: (f: EmailFilterState) => void; status: EmailStatus; onStatus: (s: EmailStatus) => void }) {
  const [cat, setCat] = useState<Cat>("status");
  const [search, setSearch] = useState("");
  const sequences = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`) });
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  useEffect(() => setSearch(""), [cat]);

  const count = activeEmailFilters(value) + (status !== "all" ? 1 : 0);
  const isList = cat !== "status" && cat !== "date";
  const options: { id: string; label: string; note?: string }[] =
    cat === "sequence" ? (sequences.data ?? []).map((s) => ({ id: s.id, label: s.name }))
      : cat === "tag" ? (tags.data ?? []).map((t) => ({ id: t.id, label: t.name, note: `${t.contacts}` }))
        : cat === "mailbox" ? (mailboxes.data ?? []).map((m) => ({ id: m.id, label: m.email }))
          : cat === "dnc" ? DNC_OPTIONS : RESPONSE_OPTIONS;
  const shown = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const lc = (isList ? cat : "sequence") as ListCat;
  const cur = value[lc];
  const toggle = (id: string) => onChange({ ...value, [lc]: { ...cur, values: cur.values.includes(id) ? cur.values.filter((x) => x !== id) : [...cur.values, id] } });
  const radio = (on: boolean, label: string, pick: () => void) => (
    <button key={label} className="w-full flex items-center gap-3 rounded-lg px-3 h-10 text-[15px] text-ink-800 text-left hover:bg-ink-50" onClick={pick}>
      <span className={cx("grid place-items-center w-5 h-5 rounded-full border shrink-0", on ? "border-brand-600" : "border-ink-300")}>{on && <span className="w-2.5 h-2.5 rounded-full bg-brand-600" />}</span>
      <span className="flex-1">{label}</span>
    </button>
  );
  const sideNote = (key: Cat) => (key === "status" ? (status !== "all" ? 1 : 0) : key === "date" ? (dateActive(value.date) ? 1 : 0) : value[key].values.length);
  const loading = (cat === "sequence" && sequences.isLoading) || (cat === "tag" && tags.isLoading) || (cat === "mailbox" && mailboxes.isLoading);

  return (
    <PortalMenu align="left" width={640} trigger={
      <button className={cx("btn-secondary", count > 0 && "border-brand-500 text-brand-700")}>
        <SlidersHorizontal size={15} /> Filters{count > 0 && <span className="chip bg-brand-600 text-white">{count}</span>}
      </button>
    }>
      {() => (
        <div className="-m-1.5">
          <div className="flex">
            <div className="w-56 shrink-0 bg-ink-50/70 border-r border-ink-100">
              <div className="px-4 py-3 text-sm font-semibold text-ink-500">Filters</div>
              <div className="p-2.5 space-y-0.5">
                {([{ key: "status", label: "Status" }, { key: "date", label: "Date" }, ...CATS] as { key: Cat; label: string }[]).map((c) => (
                  <button key={c.key} className={cx("w-full flex items-center gap-2 rounded-lg px-3 h-10 text-[15px] text-left", cat === c.key ? "bg-ink-100 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-100/70")} onClick={() => setCat(c.key)}>
                    <span className="flex-1">{c.label}</span>
                    {sideNote(c.key) > 0 && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md bg-brand-600 text-xs font-medium text-white">{sideNote(c.key)}</span>}
                    <ChevronRight size={16} className="text-ink-500" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              {isList ? (
                <div className="flex gap-5 px-4 pt-3 border-b border-ink-100">
                  {(["include", "exclude"] as Mode[]).map((m) => (
                    <button key={m} className={cx("pb-2.5 -mb-px border-b-2 text-sm font-semibold capitalize", cur.mode === m ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")} onClick={() => onChange({ ...value, [lc]: { ...cur, mode: m } })}>{m}</button>
                  ))}
                </div>
              ) : (
                <div className="px-4 pt-3 border-b border-ink-100"><span className="inline-block pb-2.5 -mb-px border-b-2 border-brand-600 text-sm font-semibold text-brand-700">{cat === "status" ? "Show" : "When"}</span></div>
              )}
              <div className="p-3 min-h-[250px]">
                {cat === "status" ? (
                  <div className="space-y-0.5">{STATUS_OPTIONS.map((o) => radio(status === o.id, o.label, () => onStatus(o.id)))}</div>
                ) : cat === "date" ? (
                  <div>
                    <div className="space-y-0.5">{DATE_OPTIONS.map((o) => radio(value.date.preset === o.id, o.label, () => onChange({ ...value, date: { ...value.date, preset: o.id } })))}</div>
                    {value.date.preset === "custom" && (
                      <div className="mt-3 grid grid-cols-2 gap-3 px-1">
                        <div><label className="label">From</label><input type="date" className="input h-10" value={value.date.from} max={value.date.to || undefined} onChange={(e) => onChange({ ...value, date: { ...value.date, from: e.target.value } })} /></div>
                        <div><label className="label">To</label><input type="date" className="input h-10" value={value.date.to} min={value.date.from || undefined} onChange={(e) => onChange({ ...value, date: { ...value.date, to: e.target.value } })} /></div>
                        <p className="col-span-2 text-xs text-ink-500">Scheduled emails use the day they are due to go out, and sent emails the day they were sent.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {cat !== "dnc" && cat !== "response" && (
                      <div className="relative">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
                        <input className="input h-11 pl-10 rounded-xl" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                      </div>
                    )}
                    <div className="mt-2 max-h-60 overflow-y-auto">
                      {!shown.length ? <div className="px-3 py-3 text-sm text-ink-400">{loading ? "Loading…" : options.length ? "Nothing found" : `No ${cat === "mailbox" ? "mailboxes" : `${cat}s`} yet`}</div> : shown.map((o) => {
                        const on = cur.values.includes(o.id);
                        return (
                          <button key={o.id} className="w-full flex items-center gap-3 rounded-lg px-3 h-10 text-[15px] text-ink-800 text-left hover:bg-ink-50" onClick={() => toggle(o.id)}>
                            <span className={cx("grid place-items-center w-5 h-5 rounded-md border shrink-0", on ? "bg-brand-600 border-brand-600 text-white" : "border-ink-300")}>{on && <Check size={13} strokeWidth={3} />}</span>
                            <span className="flex-1 truncate">{o.label}</span>
                            {o.note && <span className="text-xs text-ink-400">{o.note}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-ink-100 bg-surface">
            <button className="btn-secondary btn-sm" disabled={count === 0} onClick={() => { onChange(NO_EMAIL_FILTERS); onStatus("all"); setSearch(""); }}><RotateCcw size={14} /> Reset filters</button>
            <span className="text-xs text-ink-500">{count ? `${count} filter${count === 1 ? "" : "s"} on` : "No filters on"}</span>
          </div>
        </div>
      )}
    </PortalMenu>
  );
}

// The filters, always visible on the left of the Emails page. Tick what you want, see it listed under "Selected Filters", then Apply.
export function EmailFilterSidebar({ ws, value, status, onApply, onClear, applied, scheduledCount }: { ws: string; value: EmailFilterState; status: EmailStatus; onApply: (f: EmailFilterState, status: EmailStatus) => void; onClear: () => void; applied: boolean; scheduledCount?: number }) {
  const sequences = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`) });
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  // What is ticked here is a draft until "Apply Filters" is clicked. It follows the applied filters when they change from elsewhere.
  const [draft, setDraft] = useState<EmailFilterState>(value);
  const [dStatus, setDStatus] = useState<EmailStatus>(status);
  const appliedKey = JSON.stringify([value, status]);
  useEffect(() => { setDraft(value); setDStatus(status); }, [appliedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify([draft, dStatus]) !== appliedKey;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The five main groups are dropdowns too (Email Status starts open).
  const [grp, setGrp] = useState<Record<string, boolean>>({ status: true });

  const toggleList = (cat: ListCat, id: string) => setDraft((d) => {
    const cur = d[cat];
    return { ...d, [cat]: { ...cur, values: cur.values.includes(id) ? cur.values.filter((x) => x !== id) : [...cur.values, id] } };
  });
  const setDate = (preset: DateF["preset"]) => setDraft((d) => ({ ...d, date: { ...d.date, preset: d.date.preset === preset ? "" : preset } }));

  const nameOf = (cat: ListCat, id: string): string =>
    cat === "sequence" ? sequences.data?.find((x) => x.id === id)?.name ?? "Sequence"
      : cat === "tag" ? tags.data?.find((x) => x.id === id)?.name ?? "Tag"
        : cat === "mailbox" ? mailboxes.data?.find((x) => x.id === id)?.email ?? "Mailbox"
          : cat === "dnc" ? DNC_OPTIONS.find((x) => x.id === id)?.label ?? id : RESPONSE_OPTIONS.find((x) => x.id === id)?.label ?? id;
  const dateLabel = draft.date.preset === "today" ? "Today" : draft.date.preset === "week" ? "This Week"
    : draft.date.preset === "custom" ? ["Custom dates", [draft.date.from, draft.date.to].filter(Boolean).join(" to ")].filter(Boolean).join(": ") : "";
  const selected: string[] = [
    ...(dStatus !== "all" ? [dStatus === "sent" ? "Sent" : "Scheduled"] : []),
    ...(dateLabel ? [dateLabel] : []),
    ...(["response", "dnc", "sequence", "tag", "mailbox"] as ListCat[]).flatMap((c) => draft[c].values.map((id) => nameOf(c, id))),
  ];

  const row = (kind: "radio" | "check", on: boolean, label: string, pick: () => void, opts: { note?: ReactNode; indent?: boolean } = {}) => (
    <button key={label} onClick={pick} role={kind === "radio" ? "radio" : "checkbox"} aria-checked={on} className={cx("w-full flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm text-left", opts.indent && "pl-7", on ? "bg-ink-100 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-50")}>
      {kind === "radio"
        ? <span className={cx("grid place-items-center w-4 h-4 rounded-full border shrink-0", on ? "border-brand-600" : "border-ink-300")}>{on && <span className="w-2 h-2 rounded-full bg-brand-600" />}</span>
        : <span className={cx("grid place-items-center w-4 h-4 rounded border shrink-0", on ? "bg-brand-600 border-brand-600 text-white" : "border-ink-300")}>{on && <Check size={11} strokeWidth={3} />}</span>}
      <span className="flex-1 truncate">{label}</span>
      {opts.note !== undefined && <span className="text-xs tabular-nums text-ink-500">{opts.note}</span>}
    </button>
  );
  const dropdown = (key: string, icon: ReactNode, title: string, badge: number, body: ReactNode) => (
    <div key={key} className="border-b border-ink-100 py-1.5">
      <button className="w-full flex items-center gap-2 rounded-lg px-1.5 h-10 text-sm font-semibold text-ink-900 hover:bg-ink-50" aria-expanded={!!grp[key]} onClick={() => setGrp((g) => ({ ...g, [key]: !g[key] }))}>
        {icon}
        <span className="flex-1 text-left">{title}</span>
        {badge > 0 && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md bg-brand-600 text-xs font-medium text-white">{badge}</span>}
        <ChevronDown size={16} className={cx("text-ink-500 transition-transform", grp[key] && "rotate-180")} />
      </button>
      {grp[key] && <div className="pb-1.5 pt-0.5 pl-5 ml-2.5 border-l border-ink-100">{body}</div>}
    </div>
  );
  const sub = (key: string, label: string, cat: ListCat, options: { id: string; label: string; note?: string }[], empty: string) => (
    <div key={key}>
      <button className="w-full flex items-center gap-2 rounded-lg px-2.5 h-9 text-sm text-ink-800 hover:bg-ink-50" aria-expanded={!!open[key]} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
        {open[key] ? <ChevronDown size={15} className="text-ink-500" /> : <ChevronRight size={15} className="text-ink-500" />}
        <span className="flex-1 text-left">{label}</span>
        {draft[cat].values.length > 0 && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md bg-brand-600 text-xs font-medium text-white">{draft[cat].values.length}</span>}
      </button>
      {open[key] && (
        <div className="max-h-52 overflow-y-auto">
          {options.length ? options.map((o) => row("check", draft[cat].values.includes(o.id), o.label, () => toggleList(cat, o.id), { indent: true, note: o.note })) : <div className="pl-8 py-1.5 text-sm text-ink-400">{empty}</div>}
        </div>
      )}
    </div>
  );

  return (
    <aside className="hidden lg:flex flex-col min-h-0 w-64 shrink-0 border-r border-ink-200 bg-surface" aria-label="Email filters">
      <div className="min-h-0 overflow-y-auto px-3.5 pt-6 pb-3">
        {dropdown("status", <Mail size={16} className="text-ink-500" />, "Email Status", dStatus !== "all" ? 1 : 0, <>
          {row("radio", dStatus === "all", "All Emails", () => setDStatus("all"))}
          {row("radio", dStatus === "scheduled", "Scheduled", () => setDStatus("scheduled"), { note: scheduledCount ?? 0 })}
          {row("radio", dStatus === "sent", "Sent", () => setDStatus("sent"))}
        </>)}

        {dropdown("date", <CalendarDays size={16} className="text-ink-500" />, "Date Filter", draft.date.preset ? 1 : 0, <>
          {row("radio", draft.date.preset === "today", "Today", () => setDate("today"))}
          {row("radio", draft.date.preset === "week", "This Week", () => setDate("week"))}
          {row("radio", draft.date.preset === "custom", "Custom Date Range", () => setDate("custom"))}
          {draft.date.preset === "custom" && (
            <div className="grid gap-2 px-2.5 py-2">
              <div><label className="label">From</label><input type="date" className="input h-9" value={draft.date.from} max={draft.date.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, date: { ...d.date, from: e.target.value } }))} /></div>
              <div><label className="label">To</label><input type="date" className="input h-9" value={draft.date.to} min={draft.date.from || undefined} onChange={(e) => setDraft((d) => ({ ...d, date: { ...d.date, to: e.target.value } }))} /></div>
            </div>
          )}
        </>)}

        {dropdown("response", <MessageSquare size={16} className="text-ink-500" />, "Response Status", draft.response.values.length, <>
          {RESPONSE_OPTIONS.map((o) => row("check", draft.response.values.includes(o.id), o.label, () => toggleList("response", o.id)))}
        </>)}

        {dropdown("contact", <Ban size={16} className="text-ink-500" />, "Contact Status", draft.dnc.values.length, <>
          {DNC_OPTIONS.map((o) => row("check", draft.dnc.values.includes(o.id), o.label.replace("Do not contact", "Do Not Contact"), () => toggleList("dnc", o.id)))}
        </>)}

        {dropdown("advanced", <SlidersHorizontal size={16} className="text-ink-500" />, "Advanced Filters", draft.sequence.values.length + draft.tag.values.length + draft.mailbox.values.length, <>
          {sub("sequence", "Sequence", "sequence", (sequences.data ?? []).map((q) => ({ id: q.id, label: q.name })), "No sequences yet")}
          {sub("tag", "Tag", "tag", (tags.data ?? []).map((t) => ({ id: t.id, label: t.name, note: `${t.contacts}` })), "No tags yet")}
          {sub("mailbox", "Mailbox", "mailbox", (mailboxes.data ?? []).map((m) => ({ id: m.id, label: m.email })), "No mailboxes yet")}
        </>)}
      </div>

      <div className="border-t border-ink-200 p-3.5 space-y-3 bg-surface">
        <div>
          <div className="text-sm font-semibold text-ink-900 mb-1.5">Selected Filters</div>
          {selected.length ? (
            <ul className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {selected.map((l, i) => <li key={`${l}-${i}`} title={l} className="inline-flex items-center gap-1 max-w-full rounded-full bg-brand-50 text-brand-800 border border-brand-200 text-xs pl-1.5 pr-2.5 h-6"><Check size={12} strokeWidth={3} className="shrink-0" /><span className="truncate">{l}</span></li>)}
            </ul>
          ) : <p className="text-sm text-ink-400">None yet</p>}
        </div>
        {applied && changed && <p className="text-xs text-amber-700" role="status">You have changes that are not applied yet.</p>}
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primary" disabled={applied && !changed} onClick={() => onApply(draft, dStatus)}>Apply Filters</button>
          <button className="btn-secondary" disabled={!selected.length && !applied} onClick={() => { setDraft(NO_EMAIL_FILTERS); setDStatus("all"); onClear(); }}>Clear Filters</button>
        </div>
      </div>
    </aside>
  );
}
