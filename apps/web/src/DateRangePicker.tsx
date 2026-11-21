import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { cx, PortalMenu } from "./ui";

// A calendar for picking a range of days: browse month by month (or jump with the month and year boxes), click the first day, then the last.
// Dates are plain "YYYY-MM-DD" text in this computer's time zone, the same form a date box uses.

const pad = (n: number) => String(n).padStart(2, "0");
export const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDay = (v: string): Date | null => { const [y, m, d] = v.split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const PRESETS: { label: string; range: () => [Date, Date] }[] = [
  { label: "Today", range: () => { const t = new Date(); return [t, t]; } },
  { label: "Yesterday", range: () => { const y = addDays(new Date(), -1); return [y, y]; } },
  { label: "Last 7 days", range: () => [addDays(new Date(), -6), new Date()] },
  { label: "Last 30 days", range: () => [addDays(new Date(), -29), new Date()] },
  { label: "This month", range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), n]; } },
  { label: "Last month", range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 0)]; } },
];

function MonthGrid({ year, month, from, to, hover, onPick, onHover }: { year: number; month: number; from: string; to: string; hover: string; onPick: (d: string) => void; onHover: (d: string) => void }) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(year, month + 1, 0).getDate();
  const today = toDay(new Date());
  // While only the first day is chosen, the days up to the one under the mouse are shown as the range to be.
  const end = to || (from && hover && hover >= from ? hover : "");
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toDay(new Date(year, month, i + 1)))];
  return (
    <div className="w-[17.5rem]">
      <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-500 mb-1">{WEEKDAYS.map((w) => <div key={w} className="h-7 grid place-items-center">{w}</div>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="h-9" />;
          const isStart = d === from, isEnd = d === end;
          const inside = !!from && !!end && d > from && d < end;
          return (
            <div key={d} className={cx("h-9 grid place-items-center", (inside || (isStart && end && end !== from)) && "bg-brand-50", isStart && end && end !== from && "rounded-l-full", isEnd && from && end !== from && "rounded-r-full bg-brand-50")}>
              <button type="button" onClick={() => onPick(d)} onMouseEnter={() => onHover(d)} aria-label={d} aria-pressed={isStart || isEnd}
                className={cx("w-9 h-9 rounded-full text-sm tabular-nums", isStart || isEnd ? "bg-brand-600 text-white font-semibold" : inside ? "text-brand-800 hover:bg-brand-100" : "text-ink-800 hover:bg-ink-100", d === today && !(isStart || isEnd) && "ring-1 ring-brand-300")}>
                {Number(d.slice(8))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Calendar({ from, to, onChange, onReset, close }: { from: string; to: string; onChange: (from: string, to: string) => void; onReset?: () => void; close: () => void }) {
  const start = fromDay(from) ?? new Date();
  const [view, setView] = useState({ y: start.getFullYear(), m: start.getMonth() });
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [hover, setHover] = useState("");
  useEffect(() => { setA(from); setB(to); }, [from, to]);
  const shift = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const second = new Date(view.y, view.m + 1, 1);
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 12 }, (_, i) => thisYear - 8 + i);

  const pick = (d: string) => {
    if (!a || (a && b)) { setA(d); setB(""); return; }   // first day (or start over)
    const [x, y] = d < a ? [d, a] : [a, d];               // second day: order them
    setA(x); setB(y);
    onChange(x, y);
    close();
  };
  const preset = (r: [Date, Date]) => { onChange(toDay(r[0]), toDay(r[1])); setA(toDay(r[0])); setB(toDay(r[1])); close(); };
  const nav = "grid place-items-center w-8 h-8 rounded-lg border border-ink-200 text-ink-700 hover:bg-ink-50";
  const sel = "h-8 rounded-lg border border-ink-200 bg-surface px-2 text-sm font-medium text-ink-800";

  return (
    <div className="-m-1.5 flex" onMouseLeave={() => setHover("")}>
      <div className="w-40 shrink-0 border-r border-ink-100 p-2.5 space-y-0.5 bg-ink-50/60">
        {PRESETS.map((p) => <button key={p.label} type="button" className="w-full text-left rounded-lg px-2.5 h-9 text-sm text-ink-700 hover:bg-ink-100" onClick={() => preset(p.range())}>{p.label}</button>)}
      </div>
      <div className="p-3.5">
        <div className="flex items-center gap-2 mb-3">
          <button type="button" className={nav} aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <select className={sel} aria-label="Month" value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>{MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          <select className={sel} aria-label="Year" value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>{[...new Set([...years, view.y])].sort().map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button type="button" className={cx(nav, "ml-auto")} aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        </div>
        <div className="flex gap-6">
          <div><div className="text-sm font-semibold text-ink-800 text-center mb-1.5">{MONTHS[view.m]} {view.y}</div><MonthGrid year={view.y} month={view.m} from={a} to={b} hover={hover} onPick={pick} onHover={setHover} /></div>
          <div className="hidden sm:block"><div className="text-sm font-semibold text-ink-800 text-center mb-1.5">{MONTHS[second.getMonth()]} {second.getFullYear()}</div><MonthGrid year={second.getFullYear()} month={second.getMonth()} from={a} to={b} hover={hover} onPick={pick} onHover={setHover} /></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">{!a ? "Click the first day." : !b ? "Now click the last day." : "Click a day to start a new range."}</p>
          {onReset && <button type="button" className="btn-secondary btn-sm" disabled={!from && !to && !a} onClick={() => { setA(""); setB(""); onReset(); close(); }}><RotateCcw size={13} /> Reset</button>}
        </div>
      </div>
    </div>
  );
}

const show = (v: string) => { const d = fromDay(v); return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : ""; };

export function DateRangePicker({ from, to, onChange, onReset }: { from: string; to: string; onChange: (from: string, to: string) => void; onReset?: () => void }) {
  const label = from && to ? (from === to ? show(from) : `${show(from)} – ${show(to)}`) : from ? `${show(from)} – …` : "Choose dates";
  return (
    <PortalMenu align="left" width={760} trigger={<button type="button" className="btn-secondary"><CalendarDays size={15} /> {label}</button>}>
      {(close) => <Calendar from={from} to={to} onChange={onChange} onReset={onReset} close={close} />}
    </PortalMenu>
  );
}
