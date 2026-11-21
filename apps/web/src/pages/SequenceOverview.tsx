import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CalendarDays, FileText, GitBranch, HelpCircle, PencilLine, Plus, Reply, Send, Share2, ThumbsUp, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SequenceDetail } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, Modal, Spinner, StatusPill, useToast } from "../ui";
import { AnalyticsView, useAnalytics } from "./Analytics";
import { ReportsModal } from "../ReportsModal";
import { ContactsTab } from "./SequenceBuilder";

type Tab = "analytics" | "contacts";

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, close]);
  return ref;
}

function StatCard({ icon, label, help, value, sub }: { icon: ReactNode; label: string; help: string; value: string; sub?: string }) {
  return (
    <div className="card p-5 min-w-0">
      <div className="flex items-center gap-3 mb-5">
        <span className="grid place-items-center w-12 h-12 rounded-full bg-brand-50 text-brand-600">{icon}</span>
        <span className="font-semibold">{label}</span>
        <span title={help} className="text-ink-400 cursor-help"><HelpCircle size={16} /></span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold">{value}</span>
        {sub !== undefined && <span className="text-xl text-ink-500"><span className="text-ink-300 mr-2">|</span>{sub}</span>}
      </div>
    </div>
  );
}

export function SequenceOverview({ sequence }: { sequence: SequenceDetail }) {
  const ws = useWs();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("analytics");
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(today.getTime() - 30 * 86400000)));
  const [to, setTo] = useState(isoDay(today));
  const [rangeOpen, setRangeOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const rangeRef = useClickOutside(rangeOpen, () => setRangeOpen(false));

  const range = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() };
  const { query: stats } = useAnalytics(ws, range.from, range.to, sequence.id);
  const t = stats.data?.totals;
  const f = stats.data?.funnel;
  const rate = (n = 0, d = 0) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "0%");

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Link copied — teammates in this workspace can open it");
    } catch {
      toast("Couldn't copy. Copy the address from your browser bar instead.", "error");
    }
  };
  const preset = (days: number) => { setFrom(isoDay(new Date(Date.now() - days * 86400000))); setTo(isoDay(new Date())); setRangeOpen(false); };

  return (
    <div className="min-h-full">
      <div className="bg-surface border-b border-ink-200 px-4 md:px-8 pt-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Link to={`/${ws}/sequences`} className="btn-ghost btn-sm" aria-label="Back to sequences"><ArrowLeft size={16} /></Link>
          <h1 className="text-lg font-semibold flex-1 min-w-0 truncate">Sequence - {sequence.name}</h1>
          <StatusPill status={sequence.status} />
          <button className="btn-secondary h-10 px-4" onClick={() => setReportOpen(true)}><FileText size={17} /> Reporting</button>
          {reportOpen && <ReportsModal ws={ws} sequenceId={sequence.id} from={range.from} to={range.to} onClose={() => setReportOpen(false)} />}
          <button className="btn-secondary h-10 px-4" onClick={() => nav(`/${ws}/sequences/${sequence.id}/edit`)}><PencilLine size={17} /> Edit sequence</button>
        </div>
        <div className="flex gap-6 overflow-x-auto">
          <button className={cx("tab flex items-center gap-1.5", tab === "analytics" && "tab-active")} onClick={() => setTab("analytics")}>
            Analytics <span title="Results for this sequence in the selected dates." className="text-ink-400 cursor-help"><HelpCircle size={14} /></span>
          </button>
          <button className={cx("tab", tab === "contacts" && "tab-active")} onClick={() => setTab("contacts")}>Contacts</button>
        </div>
      </div>

      <div className="p-4 md:p-8">
        {tab === "analytics" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold flex-1">Sequence analytics</h2>
              <button className="btn-secondary h-10 px-4" onClick={share}><Share2 size={17} /> Share</button>
              <div className="relative" ref={rangeRef}>
                <button className="btn-secondary h-10 px-4" onClick={() => setRangeOpen((o) => !o)}><CalendarDays size={17} /> {fmtDay(from)} - {fmtDay(to)}</button>
                {rangeOpen && (
                  <div className="absolute right-0 top-12 z-30 w-72 card p-4 space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[["7 days", 7], ["30 days", 30], ["90 days", 90], ["1 year", 365]].map(([l, d]) => (
                        <button key={l} className="btn-sm btn bg-ink-100" onClick={() => preset(d as number)}>{l}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="label">From</label><input type="date" className="input h-9" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
                      <div><label className="label">To</label><input type="date" className="input h-9" value={to} min={from} max={isoDay(new Date())} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {stats.isLoading ? <Spinner /> : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard icon={<Send size={22} />} label="Contacted" help="Contacts who received at least one email in these dates." value={(t?.contacted ?? 0).toLocaleString()} />
                <StatCard icon={<Reply size={22} />} label="Reply rate" help="Contacts who replied, out of those contacted. Auto-replies and out-of-office don't count." value={rate(t?.replied, t?.contacted)} sub={String(t?.replied ?? 0)} />
                <StatCard icon={<ThumbsUp size={22} />} label="Positive rate" help="Replies labelled Positive in Primebox, out of those contacted." value={rate(f?.positive, t?.contacted)} sub={String(f?.positive ?? 0)} />
                <StatCard icon={<TriangleAlert size={22} />} label="Bounce rate" help="Contacts whose email bounced or was stopped by bounce shield. Keep this under 3%." value={rate(t?.bounced, t?.contacted)} sub={String(t?.bounced ?? 0)} />
              </div>
            )}

            <AnalyticsView sequenceId={sequence.id} range={range} />
          </div>
        )}
        {tab === "contacts" && <ContactsTab sequenceId={sequence.id} onChange={() => undefined} />}
      </div>
    </div>
  );
}
