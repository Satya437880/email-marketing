export interface SendSchedule {
  // IANA zone chosen on the Schedule tab. Days and hours are always read in this zone.
  timezone: string;
  // Weekday numbers with Sunday = 0 ... Saturday = 6 (the same numbering the Schedule tab saves).
  days: number[];
  start: string;
  end: string;
  // Optional per-weekday hours (keys "0"–"6"); days without an entry use start/end.
  hours?: Record<string, { start: string; end: string }>;
}

export const DEFAULT_SCHEDULE: SendSchedule = { timezone: "UTC", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  return f;
}

export function localParts(date: Date, tz: string): { weekday: number; minutes: number } {
  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type === "weekday") weekday = WEEKDAYS[p.value] ?? 0;
    else if (p.type === "hour") hour = Number(p.value);
    else if (p.type === "minute") minute = Number(p.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function dayHours(s: SendSchedule, weekday: number) {
  return s.hours?.[String(weekday)] ?? { start: s.start, end: s.end };
}

export function isInWindow(date: Date, s: SendSchedule): boolean {
  const { weekday, minutes } = localParts(date, s.timezone);
  if (!s.days.includes(weekday)) return false;
  const h = dayHours(s, weekday);
  return minutes >= toMinutes(h.start) && minutes < toMinutes(h.end);
}

const STEP_MS = 5 * 60 * 1000;

// Earliest instant at or after `from` that falls inside the window. Walks in 5-minute steps so DST shifts are handled by Intl.
export function nextWindowStart(from: Date, s: SendSchedule): Date | null {
  if (!s.days.some((d) => { const h = dayHours(s, d); return toMinutes(h.end) > toMinutes(h.start); })) return null;
  if (isInWindow(from, s)) return from;
  let t = Math.ceil(from.getTime() / STEP_MS) * STEP_MS;
  const limit = from.getTime() + 8 * 86400000;
  for (; t <= limit; t += STEP_MS) {
    if (isInWindow(new Date(t), s)) return new Date(t);
  }
  return null;
}

// The send time for something that becomes due at `due`: now/then if inside the window, otherwise the start of the next open window.
export function alignToWindow(due: Date, s: SendSchedule): Date {
  return nextWindowStart(due, s) ?? due;
}

// When the schedule changes, every email still waiting is placed again: from the moment it first became due (never earlier than now)
// to the start of the next open window of the new schedule.
export function recalculateDue(items: { dueAt: Date }[], s: SendSchedule, now: Date): Date[] {
  return items.map((i) => alignToWindow(new Date(Math.max(i.dueAt.getTime(), now.getTime())), s));
}

// Daily counters reset at local midnight of the mailbox's time zone.
export function localDayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
