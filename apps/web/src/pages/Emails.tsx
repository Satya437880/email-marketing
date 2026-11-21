import { emailDateRange, EmailFilterSidebar, EmailFiltersButton, emailFiltersToParam, NO_EMAIL_FILTERS, type EmailFilterState } from "./EmailFilters";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Mail, Pencil, Search, Send, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, fmtInZone, PagerBar, Spinner, useDebounced, useToast } from "../ui";

interface EmailItem {
  id: string;
  kind: "scheduled" | "sent";
  status: "scheduled" | "paused" | "sent";
  at: string | null;
  timezone: string | null;
  contactId: string | null;
  email: string;
  name: string;
  sequenceId: string | null;
  sequenceName: string | null;
  step: number | null;
  steps: number | null;
  subject: string;
  snippet: string;
  canSendNow: boolean;
}
interface EmailList { items: EmailItem[]; total: number; scheduled: number }

const STATUS_STYLE: Record<EmailItem["status"], string> = {
  scheduled: "bg-sky-50 text-sky-700",
  paused: "bg-amber-50 text-amber-700",
  sent: "bg-emerald-50 text-emerald-700",
};
const STATUS_LABEL: Record<EmailItem["status"], string> = { scheduled: "Scheduled", paused: "Paused", sent: "Sent" };

function SendTime({ m }: { m: EmailItem }) {
  // Scheduled emails always show in their sequence's time zone, whatever zone this computer is set to.
  return <div>{m.kind === "scheduled" && m.timezone ? fmtInZone(m.at, m.timezone) : fmtDate(m.at, true)}</div>;
}

export function EmailsPage() {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "scheduled" | "sent">("all");
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<EmailFilterState>(NO_EMAIL_FILTERS);
  const filterParam = emailFiltersToParam(filters);
  const range = emailDateRange(filters.date);

  // Nothing is listed until "Apply Filters" has been clicked (the narrow-screen Filters menu applies as you pick).
  const [applied, setApplied] = useState(false);
  // The filter sidebar can be hidden to give the table the whole width (remembered in this browser).
  const [showFilters, setShowFilters] = useState(() => { try { return localStorage.getItem("emails-filters") !== "hidden"; } catch { return true; } });
  const flipFilters = () => setShowFilters((v) => { try { localStorage.setItem("emails-filters", v ? "hidden" : "shown"); } catch { /* not saved */ } return !v; });
  const [pageSize, setPageSize] = useState(() => { try { return [10, 25, 50, 100].includes(Number(localStorage.getItem("emails-page-size"))) ? Number(localStorage.getItem("emails-page-size")) : 50; } catch { return 50; } });
  const list = useQuery({
    enabled: applied,
    queryKey: ["emails", ws, tab, search, page, pageSize, filterParam, range.from, range.to],
    queryFn: () => api<EmailList>(`/v1/workspaces/${ws}/emails?status=${tab}&page=${page}&pageSize=${pageSize}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}${filterParam ? `&filters=${encodeURIComponent(filterParam)}` : ""}${range.from ? `&from=${encodeURIComponent(range.from)}` : ""}${range.to ? `&to=${encodeURIComponent(range.to)}` : ""}`),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const sendNow = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/emails/${id}/send-now`, { method: "POST", body: {} }),
    onSuccess: () => { toast("Moved to the front of the queue. It goes out on the next send run."); void qc.invalidateQueries({ queryKey: ["emails", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (m: EmailItem) => api(`/v1/workspaces/${ws}/emails/${m.kind}/${m.id}`, { method: "DELETE" }),
    onSuccess: () => { toast("Email deleted"); void qc.invalidateQueries({ queryKey: ["emails", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const askDelete = (m: EmailItem) => {
    const msg = m.kind === "scheduled"
      ? `Delete this scheduled email to ${m.email}? It will not be sent, and this contact gets no more emails from the sequence.`
      : `Delete this sent email to ${m.email} from your history? The recipient keeps the copy they already received.`;
    if (confirm(msg)) remove.mutate(m);
  };

  // Rows ticked for a bulk action, kept as "kind:id" so a scheduled and a sent email never clash.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const keyOf = (m: EmailItem) => `${m.kind}:${m.id}`;
  const bulk = useMutation({
    mutationFn: (v: { action: "delete" | "send-now"; items: { kind: string; id: string }[] }) =>
      api<{ done: number; skipped: number }>(`/v1/workspaces/${ws}/emails/bulk`, { body: v }),
    onSuccess: (r, v) => {
      toast(`${v.action === "delete" ? "Deleted" : "Moved to the front of the queue:"} ${r.done}${r.skipped ? ` (${r.skipped} skipped)` : ""}`);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ["emails", ws] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const pick = (t: typeof tab) => { setTab(t); setPage(1); setPicked(new Set()); };
  const items = list.data?.items ?? [];
  const allOnPage = items.length > 0 && items.every((m) => picked.has(keyOf(m)));
  const toggleAll = () => setPicked(allOnPage ? new Set() : new Set(items.map(keyOf)));
  const toggle = (m: EmailItem) => setPicked((p) => { const n = new Set(p); if (n.has(keyOf(m))) n.delete(keyOf(m)); else n.add(keyOf(m)); return n; });
  const chosen = items.filter((m) => picked.has(keyOf(m)));
  const reset = () => { setFilters(NO_EMAIL_FILTERS); setTab("all"); setPage(1); setPicked(new Set()); setApplied(false); };
  // What is currently being filtered, as chips with an x, so nobody has to open a menu to see or undo it.
  const DATE_LABEL = { today: "Today", week: "This week", custom: "Selected days" } as const;
  const active: { key: string; label: string; clear: () => void }[] = [
    ...(tab !== "all" ? [{ key: "status", label: tab === "sent" ? "Sent" : "Scheduled", clear: () => { setTab("all"); setPage(1); } }] : []),
    ...(filters.date.preset ? [{ key: "date", label: DATE_LABEL[filters.date.preset], clear: () => { setFilters({ ...filters, date: { ...filters.date, preset: "" } }); setPage(1); } }] : []),
    ...(["sequence", "tag", "mailbox", "dnc", "response"] as const).filter((k) => filters[k].values.length).map((k) => ({
      key: k,
      label: `${{ sequence: "Sequence", tag: "Tag", mailbox: "Mailbox", dnc: "DNC", response: "Responses" }[k]}: ${filters[k].values.length} ${filters[k].mode === "exclude" ? "hidden" : "selected"}`,
      clear: () => { setFilters({ ...filters, [k]: { ...filters[k], values: [] } }); setPage(1); },
    })),
  ];
  const chosenItems = chosen.map((m) => ({ kind: m.kind, id: m.id }));
  const sendable = chosen.filter((m) => m.kind === "scheduled" && m.canSendNow);

  return (
    <div>

      <div className="flex">
      {showFilters && <EmailFilterSidebar ws={ws} scheduledCount={list.data?.scheduled} value={filters} status={tab} applied={applied} onClear={reset} onApply={(f, st) => { setFilters(f); setTab(st); setPage(1); setPicked(new Set()); setApplied(true); }} />}
      <div className="flex-1 min-w-0 px-4 md:px-8 pt-12 pb-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="relative w-full max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search emails" aria-label="Search emails" value={typed} onChange={(e) => { setTyped(e.target.value); setPage(1); }} />
          </div>
          <button className="hidden lg:inline-flex btn-secondary" onClick={flipFilters} aria-pressed={showFilters} title={showFilters ? "Hide the filter list to give the table more room" : "Show the filter list"}><SlidersHorizontal size={15} /> {showFilters ? "Hide filters" : "Show filters"}{!showFilters && active.length > 0 && <span className="chip bg-brand-600 text-white">{active.length}</span>}</button>
          <span className="lg:hidden"><EmailFiltersButton ws={ws} value={filters} status={tab} onStatus={(t) => { setTab(t); setPage(1); setPicked(new Set()); setApplied(true); }} onChange={(f) => { setFilters(f); setPage(1); setPicked(new Set()); setApplied(true); }} /></span>
          <span className="ml-auto text-sm text-ink-500" aria-live="polite">{applied && list.data ? `${list.data.total.toLocaleString()} email${list.data.total === 1 ? "" : "s"}` : ""}{list.isFetching && !list.isLoading ? " · updating…" : ""}</span>
          <Link to={`/${ws}/emails/compose`} className="btn-primary"><Pencil size={16} /> Compose</Link>
        </div>

        {active.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {active.map((a) => (
              <span key={a.key} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 text-brand-800 text-sm pl-3 pr-1.5 h-7">
                {a.label}
                <button className="grid place-items-center w-5 h-5 rounded-full hover:bg-brand-100" aria-label={`Remove filter ${a.label}`} onClick={a.clear}><X size={13} /></button>
              </span>
            ))}
            <button className="text-sm font-medium text-brand-700 hover:underline" onClick={reset}>Clear all</button>
          </div>
        )}

        {chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mb-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5">
            <span className="text-sm font-medium">{chosen.length} selected</span>
            {sendable.length > 0 && (
              <button className="btn-secondary btn-sm" disabled={bulk.isPending}
                onClick={() => { if (confirm(`Send ${sendable.length} email${sendable.length === 1 ? "" : "s"} now?`)) bulk.mutate({ action: "send-now", items: sendable.map((m) => ({ kind: m.kind, id: m.id })) }); }}>
                <Send size={14} /> Send now ({sendable.length})
              </button>
            )}
            <button className="btn-secondary btn-sm text-red-600 hover:bg-red-50 hover:border-red-200" disabled={bulk.isPending}
              onClick={() => { if (confirm(`Delete ${chosen.length} email${chosen.length === 1 ? "" : "s"}? Scheduled ones will not be sent (and those contacts get no more emails from their sequence). Sent ones are only removed from your history.`)) bulk.mutate({ action: "delete", items: chosenItems }); }}>
              <Trash2 size={14} /> Delete ({chosen.length})
            </button>
            <button className="btn-ghost btn-sm ml-auto" onClick={() => setPicked(new Set())}>Clear selection</button>
          </div>
        )}

        <div className={cx("card overflow-x-auto transition-opacity", list.isFetching && !list.isLoading && "opacity-70")} aria-busy={list.isFetching}>
          {!applied ? (
            <Empty icon={<SlidersHorizontal size={20} />} title="Choose your filters" text="Pick what you want to see in the filters on the left, then click Apply Filters. To see every email, click Apply Filters without choosing anything." action={!showFilters ? <button className="btn-primary" onClick={flipFilters}><SlidersHorizontal size={15} /> Show filters</button> : undefined} />
          ) : list.isLoading ? <div className="py-16 grid place-items-center"><Spinner /></div> : !items.length ? (
            active.length || search.trim()
              ? <Empty icon={<Search size={20} />} title="No emails match" text="Nothing fits the filters and search you have on. Try removing one, or clear them all." action={<button className="btn-secondary" onClick={() => { reset(); setTyped(""); }}>Clear filters and search</button>} />
              : <Empty icon={<Mail size={20} />} title={tab === "scheduled" ? "Nothing scheduled" : tab === "sent" ? "No emails sent yet" : "No emails yet"}
                text="Emails appear here once a sequence has contacts. Scheduled ones show when they will go out, and you can send them early." />
          ) : (
            <table className="w-full table-fixed min-w-[720px]">
              <thead>
                <tr><th scope="col" className="th w-12"><input type="checkbox" aria-label="Select all emails on this page" ref={(el) => { if (el) el.indeterminate = !allOnPage && items.some((m) => picked.has(keyOf(m))); }} checked={allOnPage} onChange={toggleAll} /></th><th className="th">Recipient</th><th className="th w-28">Status</th><th className="th w-44">Date</th><th className="th">Sequence</th><th className="th">Message</th><th className="th w-40 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={`${m.kind}-${m.id}`} className={cx("hover:bg-ink-50/60", picked.has(keyOf(m)) && "bg-brand-50/60")}>
                    <td className="td w-12"><input type="checkbox" aria-label={`Select email to ${m.email}`} checked={picked.has(keyOf(m))} onChange={() => toggle(m)} /></td>
                    <td className="td">
                      <div className="font-medium text-ink-900 truncate" title={m.name || m.email}>{m.name || m.email}</div>
                      {m.name && <div className="text-xs text-ink-500 truncate" title={m.email}>{m.email}</div>}
                    </td>
                    <td className="td"><span className={cx("chip", STATUS_STYLE[m.status])}>{STATUS_LABEL[m.status]}</span></td>
                    <td className="td whitespace-nowrap">
                      <SendTime m={m} />
                      <div className="text-xs text-ink-500">{m.kind === "scheduled" ? "Goes out" : "Sent"}</div>
                    </td>
                    <td className="td">
                      {m.sequenceId ? <Link className="block truncate underline decoration-ink-300 hover:decoration-ink-700" title={m.sequenceName ?? undefined} to={`/${ws}/sequences/${m.sequenceId}`}>{m.step && m.steps ? `Step ${m.step} of ${m.steps}` : "Sequence"} · {m.sequenceName}</Link> : <span className="text-ink-400">Manual</span>}
                    </td>
                    <td className="td">
                      <div className="font-medium text-ink-900 truncate" title={m.subject || undefined}>{m.subject || "(no subject)"}</div>
                      <div className="text-xs text-ink-500 truncate" title={m.snippet}>{m.snippet}</div>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                      {m.kind === "scheduled" && (
                        <button className="btn-secondary btn-sm" disabled={!m.canSendNow || sendNow.isPending} title={m.canSendNow ? "Send this email as soon as possible" : "Resume the sequence to send"}
                          onClick={() => { if (confirm(`Send this email to ${m.email} now?`)) sendNow.mutate(m.id); }}>
                          <Send size={14} /> Send now
                        </button>
                      )}
                      <button className="btn-secondary btn-sm px-2 text-red-600 hover:bg-red-50 hover:border-red-200" aria-label={`Delete email to ${m.email}`} title="Delete this email" disabled={remove.isPending} onClick={() => askDelete(m)}>
                        <Trash2 size={14} />
                      </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!list.data?.total && <PagerBar page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} sizes={[10, 25, 50, 100]} onPageSize={(n) => { setPageSize(n); setPage(1); try { localStorage.setItem("emails-page-size", String(n)); } catch { /* not saved */ } }} />}
        </div>
        {tab !== "sent" && <p className="mt-3 text-xs text-ink-500 flex items-center gap-1.5"><Clock size={13} /> "Send now" moves an email to the front of the queue. It still follows your sending window and mailbox daily limits.</p>}
      </div>
      </div>
    </div>
  );
}
