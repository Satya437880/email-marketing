import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useWs } from "../App";
import { cx, PageHeader, pct, Spinner, Stat } from "../ui";

interface AnalyticsData {
  totals: { sent: number; contacted: number; opened: number; clicked: number; replied: number; bounced: number; opted_out: number };
  funnel: { added: number; positive: number; meetings: number; closed: number };
  daily: { day: string; sent: number; replied: number; opened: number; bounced: number }[];
  senders: { id: string; email: string; from_name: string; sent: number; contacted: number; opened: number; replied: number; bounced: number; opted_out: number }[];
  variants: { position: number; step_name: string; label: string; subject: string; sent: number; opened: number }[];
}

const RANGES = [{ k: "7", label: "Week" }, { k: "30", label: "Month" }, { k: "90", label: "Quarter" }, { k: "3650", label: "All time" }];

export function AnalyticsPage() {
  return (
    <div>
      <PageHeader icon={<BarChart3 size={18} />} title="Analytics" />
      <div className="p-4 md:p-8"><AnalyticsView /></div>
    </div>
  );
}

export function useAnalytics(ws: string, from: string, to: string | undefined, sequenceId?: string) {
  const qs = `from=${from}${to ? `&to=${to}` : ""}${sequenceId ? `&sequenceId=${sequenceId}` : ""}`;
  return { qs, query: useQuery({ queryKey: ["analytics", ws, qs], queryFn: () => api<AnalyticsData>(`/v1/workspaces/${ws}/analytics?${qs}`) }) };
}

// With `range` the parent controls the dates (sequence overview); otherwise the view shows its own range buttons.
export function AnalyticsView({ sequenceId, range: fixed }: { sequenceId?: string; range?: { from: string; to: string } }) {
  const ws = useWs();
  const [range, setRange] = useState("30");
  const [series, setSeries] = useState({ sent: true, replied: true, opened: false });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const from = fixed?.from ?? new Date(dayStart.getTime() - Number(range) * 86400000).toISOString();
  const { qs, query: data } = useAnalytics(ws, from, fixed?.to, sequenceId);

  if (data.isLoading || !data.data) return <Spinner />;
  const { totals: t, funnel: f, daily, senders } = data.data;
  const rate = (n: number, d: number) => (d ? pct(n / d) : "0.0%");
  const funnelRows = [
    { label: "Added", value: f.added },
    { label: "Contacted", value: t.contacted },
    { label: "Replied", value: t.replied },
    { label: "Positive", value: f.positive },
  ];
  const max = Math.max(1, ...funnelRows.map((r) => r.value));

  return (
    <div className="space-y-6">
      <div className={cx("flex flex-wrap items-center gap-2", fixed && "hidden")}>
        {RANGES.map((r) => (
          <button key={r.k} className={cx("btn-sm btn", range === r.k ? "bg-ink-900 text-ink-50" : "bg-surface border border-ink-200 text-ink-600")} onClick={() => setRange(r.k)}>{r.label}</button>
        ))}
        <a className="btn-secondary btn-sm ml-auto" href={`/v1/workspaces/${ws}/reports/messages.csv?${qs}`}><Download size={14} /> Export messages CSV</a>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-ink-900 mb-3">Sales funnel</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Stat label="Contacted" value={t.contacted.toLocaleString()} sub={`of ${f.added.toLocaleString()} added`} />
          <Stat label="Reply rate" value={rate(t.replied, t.contacted)} sub={`${t.replied} replies`} />
          <Stat label="Positive rate" value={rate(f.positive, t.contacted)} sub={`${f.positive} positive`} />
          <Stat label="Meetings" value={f.meetings} />
          <Stat label="Closed" value={f.closed} />
        </div>
        <div className="card p-5 mt-3 space-y-2.5">
          {funnelRows.map((r) => (
            <div key={r.label} className="flex items-center gap-3">
              <span className="w-20 text-xs text-ink-500">{r.label}</span>
              <div className="flex-1 h-6 bg-ink-50 rounded"><div className="h-full rounded bg-brand-500/80" style={{ width: `${(r.value / max) * 100}%` }} /></div>
              <span className="w-24 text-right text-xs text-ink-600">{r.value.toLocaleString()} · {rate(r.value, f.added)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-900 mb-3">Email</h2>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Stat label="Emails sent" value={t.sent.toLocaleString()} />
          <Stat label="Open rate" value={rate(t.opened, t.sent)} sub="only if tracking is on" />
          <Stat label="Reply rate" value={rate(t.replied, t.contacted)} />
          <Stat label="Positive" value={f.positive} />
          <Stat label="Bounced" value={t.bounced} sub={rate(t.bounced, t.contacted)} />
          <Stat label="Opted out" value={t.opted_out} sub={rate(t.opted_out, t.contacted)} />
        </div>
        <div className="card p-5 mt-3">
          <div className="flex gap-4 mb-3 text-xs">
            {(Object.keys(series) as (keyof typeof series)[]).map((k) => (
              <label key={k} className="flex items-center gap-1.5 capitalize"><input type="checkbox" checked={series[k]} onChange={(e) => setSeries({ ...series, [k]: e.target.checked })} />{k}</label>
            ))}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ left: -20, right: 8 }}>
                <CartesianGrid stroke="#eef0f4" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "#6b7385" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6b7385" }} />
                <Tooltip />
                {series.sent && <Line type="monotone" dataKey="sent" stroke="rgb(var(--brand-500))" strokeWidth={2} dot={false} />}
                {series.replied && <Line type="monotone" dataKey="replied" stroke="#7c3aed" strokeWidth={2} dot={false} />}
                {series.opened && <Line type="monotone" dataKey="opened" stroke="#f59e0b" strokeWidth={2} dot={false} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-900 mb-3">Senders</h2>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Mailbox</th><th className="th text-right">Contacted</th><th className="th text-right">Sent</th><th className="th text-right">Opened</th><th className="th text-right">Replied</th><th className="th text-right">Bounced</th><th className="th text-right">Opt-outs</th></tr></thead>
            <tbody>
              {senders.map((s) => (
                <tr key={s.id}>
                  <td className="td"><div className="font-medium text-ink-800">{s.from_name}</div><div className="text-xs text-ink-500">{s.email}</div></td>
                  <td className="td text-right">{s.contacted}</td><td className="td text-right">{s.sent}</td><td className="td text-right">{s.opened}</td>
                  <td className="td text-right">{s.replied} <span className="text-ink-400 text-xs">{rate(s.replied, s.contacted)}</span></td>
                  <td className="td text-right">{s.bounced}</td><td className="td text-right">{s.opted_out}</td>
                </tr>
              ))}
              {!senders.length && <tr><td className="td text-center text-ink-400" colSpan={7}>No mailboxes connected yet</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {sequenceId && !!data.data.variants.length && (
        <section>
          <h2 className="text-sm font-semibold text-ink-900 mb-3">A/B variants</h2>
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Step</th><th className="th">Variant</th><th className="th">Subject</th><th className="th text-right">Sent</th><th className="th text-right">Opened</th></tr></thead>
              <tbody>{data.data.variants.map((v, i) => (
                <tr key={i}><td className="td">{v.position + 1}. {v.step_name}</td><td className="td">{v.label}</td><td className="td truncate max-w-xs">{v.subject || "Re: (thread)"}</td><td className="td text-right">{v.sent}</td><td className="td text-right">{v.opened}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
