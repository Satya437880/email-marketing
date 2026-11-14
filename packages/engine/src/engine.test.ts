import { describe, expect, it } from "vitest";
import { evaluate, nextEmailStep, orderDue, pickMailbox, pickVariant, type EvaluateInput, type MailboxCandidate } from "./planner";
import { alignToWindow, isInWindow, localDayKey, localParts, nextWindowStart, recalculateDue, type SendSchedule } from "./schedule";

const toronto: SendSchedule = { timezone: "America/Toronto", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" };

describe("schedule", () => {
  it("checks the window in the schedule's time zone", () => {
    // Wed 4 Nov 2026 14:00 UTC = 09:00 Toronto (EST)
    expect(isInWindow(new Date("2026-11-04T14:00:00Z"), toronto)).toBe(true);
    // 12:00 UTC = 07:00 Toronto
    expect(isInWindow(new Date("2026-11-04T12:00:00Z"), toronto)).toBe(false);
    // Sat
    expect(isInWindow(new Date("2026-11-07T15:00:00Z"), toronto)).toBe(false);
  });

  it("finds the next window start, skipping weekends", () => {
    // Fri 6 Nov 2026 23:30 UTC = 18:30 Toronto -> Mon 9 Nov 08:00 Toronto = 13:00 UTC
    expect(nextWindowStart(new Date("2026-11-06T23:30:00Z"), toronto)?.toISOString()).toBe("2026-11-09T13:00:00.000Z");
  });

  it("returns null for an impossible schedule", () => {
    expect(nextWindowStart(new Date(), { ...toronto, days: [] })).toBeNull();
    expect(nextWindowStart(new Date(), { ...toronto, start: "18:00", end: "08:00" })).toBeNull();
  });

  it("supports different hours per day", () => {
    const s: SendSchedule = { ...toronto, hours: { "5": { start: "08:00", end: "12:00" } } };
    // Fri 6 Nov 2026 18:00 UTC = 13:00 Toronto: inside the default 8-18 but after Friday's 12:00 close
    expect(isInWindow(new Date("2026-11-06T18:00:00Z"), s)).toBe(false);
    expect(isInWindow(new Date("2026-11-06T18:00:00Z"), toronto)).toBe(true);
    // Thursday keeps the default hours
    expect(isInWindow(new Date("2026-11-05T21:00:00Z"), s)).toBe(true);
    // Fri 13:00 Toronto -> next window is Mon 08:00 Toronto
    expect(nextWindowStart(new Date("2026-11-06T18:00:00Z"), s)?.toISOString()).toBe("2026-11-09T13:00:00.000Z");
  });

  it("keys days by local date", () => {
    expect(localDayKey(new Date("2026-11-05T03:00:00Z"), "America/Toronto")).toBe("2026-11-04");
  });
});

const mb = (id: string, over: Partial<MailboxCandidate> = {}): MailboxCandidate => ({ id, provider: "google", active: true, dailyLimit: 100, sentToday: 0, ...over });
const now = new Date("2026-11-04T15:00:00Z");

describe("pickMailbox", () => {
  it("chooses the least-used mailbox with room", () => {
    const r = pickMailbox({ candidates: [mb("a", { sentToday: 50 }), mb("b", { sentToday: 10 }), mb("c", { sentToday: 100 })], espMatching: false, now, seed: "s" });
    expect(r).toMatchObject({ ok: true, mailbox: { id: "b" } });
  });

  it("prefers matching ESP but falls back", () => {
    const cands = [mb("g"), mb("m", { provider: "microsoft", sentToday: 30 })];
    expect(pickMailbox({ candidates: cands, contactEsp: "microsoft", espMatching: true, now, seed: "s" })).toMatchObject({ mailbox: { id: "m" } });
    expect(pickMailbox({ candidates: [mb("g")], contactEsp: "microsoft", espMatching: true, now, seed: "s" })).toMatchObject({ mailbox: { id: "g" } });
  });

  it("keeps follow-ups on the sticky mailbox", () => {
    const cands = [mb("a"), mb("b", { sentToday: 99 })];
    expect(pickMailbox({ candidates: cands, stickyMailboxId: "b", espMatching: false, now, seed: "s" })).toMatchObject({ mailbox: { id: "b" } });
    expect(pickMailbox({ candidates: [mb("a"), mb("b", { sentToday: 100 })], stickyMailboxId: "b", espMatching: false, now, seed: "s" })).toMatchObject({ ok: false, reason: "sticky_at_capacity" });
    expect(pickMailbox({ candidates: [mb("a"), mb("b", { active: false })], stickyMailboxId: "b", espMatching: false, now, seed: "s" })).toMatchObject({ ok: false, reason: "sticky_unavailable" });
  });

  it("reports throttling with the soonest retry", () => {
    const later = new Date(now.getTime() + 120000);
    const r = pickMailbox({ candidates: [mb("a", { nextAvailableAt: later })], espMatching: false, now, seed: "s" });
    expect(r).toEqual({ ok: false, reason: "throttled", retryAt: later });
  });

  it("never exceeds caps", () => {
    expect(pickMailbox({ candidates: [mb("a", { sentToday: 100 }), mb("b", { sentToday: 120 })], espMatching: false, now, seed: "s" })).toMatchObject({ ok: false, reason: "no_capacity" });
  });
});

describe("orderDue", () => {
  const item = (id: string, p: "high" | "regular", step: number, mins: number, isp: "new_first" | "followups_first" = "new_first") => ({
    id, sequencePriority: p, inSequencePriority: isp, currentStep: step, nextRunAt: new Date(now.getTime() + mins * 60000),
  });

  it("sends high priority first, then by in-sequence priority, then oldest due", () => {
    const ordered = orderDue([item("r0", "regular", 0, 0), item("h2", "high", 2, 0), item("h0", "high", 0, 5), item("h0b", "high", 0, 1)]);
    expect(ordered.map((i) => i.id)).toEqual(["h0b", "h0", "h2", "r0"]);
    const fu = orderDue([item("a", "regular", 0, 0, "followups_first"), item("b", "regular", 3, 9, "followups_first")]);
    expect(fu.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("variants and steps", () => {
  it("splits by weight deterministically", () => {
    const v = [{ id: "A", weight: 1 }, { id: "B", weight: 1 }, { id: "C", weight: 0 }];
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const id = pickVariant(v, `c${i}`)!.id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.C).toBeUndefined();
    expect(counts.A! / 2000).toBeGreaterThan(0.43);
    expect(pickVariant(v, "same")).toBe(pickVariant(v, "same"));
  });

  it("sums delays to the next email step", () => {
    const steps = [
      { id: "d0", type: "delay" as const, delayDays: 0 },
      { id: "e1", type: "email" as const, delayDays: 0 },
      { id: "d1", type: "delay" as const, delayDays: 2 },
      { id: "d2", type: "delay" as const, delayDays: 1 },
      { id: "e2", type: "email" as const, delayDays: 0 },
    ];
    expect(nextEmailStep(steps, -1, now)).toEqual({ index: 1, dueAt: now });
    expect(nextEmailStep(steps, 1, now)).toEqual({ index: 4, dueAt: new Date(now.getTime() + 3 * 86400000) });
    expect(nextEmailStep(steps, 4, now)).toBeNull();
  });

  it("starts the first email after a wait given in minutes, and adds minutes to days", () => {
    const tenMinutes = [{ id: "d0", type: "delay" as const, delayDays: 0, delayMinutes: 10 }, { id: "e1", type: "email" as const, delayDays: 0 }];
    expect(nextEmailStep(tenMinutes, -1, now)).toEqual({ index: 1, dueAt: new Date(now.getTime() + 10 * 60000) });
    const mixed = [{ id: "d0", type: "delay" as const, delayDays: 1, delayMinutes: 90 }, { id: "e1", type: "email" as const, delayDays: 0 }];
    expect(nextEmailStep(mixed, -1, now)).toEqual({ index: 1, dueAt: new Date(now.getTime() + 86400000 + 90 * 60000) });
  });
});

describe("evaluate", () => {
  const base = (): EvaluateInput => ({
    now,
    schedule: toronto,
    inDnc: false,
    unsubscribed: false,
    company: { stopOnCompanyReply: true, companyHasReplied: false, sequentialWithinCompany: false, otherContactInFlight: false, companyLimit: null, companyContactedCount: 0, isFirstTouch: true },
    mailbox: { candidates: [mb("a")], espMatching: false, now, seed: "s" },
  });

  it("sends when everything allows", () => {
    expect(evaluate(base())).toEqual({ action: "send", mailboxId: "a" });
  });

  it("stops on DNC and company reply, enforces company limit", () => {
    expect(evaluate({ ...base(), inDnc: true })).toMatchObject({ action: "stop", state: "opted_out" });
    expect(evaluate({ ...base(), company: { ...base().company, companyHasReplied: true } })).toMatchObject({ action: "stop", reason: "company_replied" });
    expect(evaluate({ ...base(), company: { ...base().company, companyLimit: 2, companyContactedCount: 2 } })).toMatchObject({ action: "stop", reason: "company_limit" });
  });

  it("reschedules outside the window to the next window start", () => {
    const sat = new Date("2026-11-07T15:00:00Z");
    expect(evaluate({ ...base(), now: sat, mailbox: { ...base().mailbox, now: sat } })).toEqual({ action: "reschedule", at: new Date("2026-11-09T13:00:00Z"), reason: "outside_window" });
  });

  it("reschedules when mailboxes are full", () => {
    expect(evaluate({ ...base(), mailbox: { ...base().mailbox, candidates: [mb("a", { sentToday: 100 })] } })).toMatchObject({ action: "reschedule", reason: "no_capacity" });
  });
});

// The Schedule tab decides when emails go out: timezone, days (Sunday = 0) and hours are all read in the sequence's own zone.
describe("sequence schedule timing", () => {
  const ist: SendSchedule = { timezone: "Asia/Calcutta", days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "18:00" };
  const at = (iso: string) => new Date(iso);
  const local = (d: Date, tz = "Asia/Calcutta") => {
    const { weekday, minutes } = localParts(d, tz);
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  };
  // Step 1 is "immediate"; step 2 waits 5 minutes after step 1 was actually sent.
  const plan = (now: Date) => {
    const step1 = alignToWindow(now, ist);
    const step2 = alignToWindow(new Date(step1.getTime() + 5 * 60000), ist);
    return { step1, step2 };
  };

  it("a) Saturday 10:05 IST: step 1 sends now, step 2 follows at 10:10", () => {
    const now = at("2026-11-14T04:35:00Z"); // Sat 14 Nov 10:05 IST
    expect(local(now)).toBe("Sat 10:05");
    const { step1, step2 } = plan(now);
    expect(step1.getTime()).toBe(now.getTime());
    expect(local(step2)).toBe("Sat 10:10");
  });

  it("b) Saturday 17:58 IST: step 1 sends now, step 2 (18:03) moves to Monday 08:00", () => {
    const now = at("2026-11-14T12:28:00Z"); // Sat 17:58 IST
    expect(local(now)).toBe("Sat 17:58");
    const { step1, step2 } = plan(now);
    expect(step1.getTime()).toBe(now.getTime());
    expect(step2.toISOString()).toBe("2026-11-16T02:30:00.000Z"); // Mon 16 Nov 08:00 IST
    expect(local(step2)).toBe("Mon 08:00");
  });

  it("c) Saturday 19:00 IST: step 1 goes Monday 08:00 (Sunday is off)", () => {
    const now = at("2026-11-14T13:30:00Z"); // Sat 19:00 IST
    expect(local(now)).toBe("Sat 19:00");
    expect(plan(now).step1.toISOString()).toBe("2026-11-16T02:30:00.000Z");
  });

  it("d) Sunday 11:00 IST: step 1 goes Monday 08:00", () => {
    const now = at("2026-11-15T05:30:00Z"); // Sun 11:00 IST
    expect(local(now)).toBe("Sun 11:00");
    expect(plan(now).step1.toISOString()).toBe("2026-11-16T02:30:00.000Z");
  });

  it("e) Monday 06:00 IST: step 1 goes Monday 08:00", () => {
    const now = at("2026-11-16T00:30:00Z"); // Mon 06:00 IST
    expect(local(now)).toBe("Mon 06:00");
    expect(plan(now).step1.toISOString()).toBe("2026-11-16T02:30:00.000Z");
  });

  it("uses the sequence timezone, not UTC: the same instant is closed in one zone and open in another", () => {
    const utcSchedule: SendSchedule = { ...ist, timezone: "UTC", days: [1, 2, 3, 4, 5] };
    const now = at("2026-11-14T04:35:00Z"); // Saturday in both zones
    expect(alignToWindow(now, utcSchedule).toISOString()).toBe("2026-11-16T08:00:00.000Z"); // the old bug: Monday 08:00 UTC
    expect(alignToWindow(now, ist).getTime()).toBe(now.getTime());
  });

  it("f) changing the timezone to Toronto places waiting emails again in the new window", () => {
    const toronto2: SendSchedule = { timezone: "America/Toronto", days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "18:00" };
    const now = at("2026-11-14T04:35:00Z"); // Fri 23:35 in Toronto: closed until Saturday 08:00
    const placed = recalculateDue([
      { dueAt: at("2026-11-14T04:35:00Z") }, // was step 1, immediate
      { dueAt: at("2026-11-14T04:40:00Z") }, // was step 2, +5 minutes
      { dueAt: at("2026-11-16T16:00:00Z") }, // already inside Monday's window
      { dueAt: at("2026-11-14T15:00:00Z") }, // out-of-office return on a Saturday (open in this schedule)
    ], toronto2, now);
    expect(placed[0]!.toISOString()).toBe("2026-11-14T13:00:00.000Z"); // Sat 08:00 Toronto
    expect(placed[1]!.toISOString()).toBe("2026-11-14T13:00:00.000Z");
    expect(placed[2]!.toISOString()).toBe("2026-11-16T16:00:00.000Z");
    expect(placed[3]!.toISOString()).toBe("2026-11-14T15:00:00.000Z"); // Sat 10:00 Toronto, inside the window
  });

  it("out-of-office restart uses the sequence's own schedule: Mon to Sat, back Saturday 10 AM IST goes out Saturday", () => {
    const back = at("2026-11-14T04:30:00Z"); // Sat 14 Nov 10:00 IST
    expect(local(back)).toBe("Sat 10:00");
    const resume = alignToWindow(back, ist);
    expect(resume.getTime()).toBe(back.getTime());
    expect(local(resume)).toBe("Sat 10:00");
  });

  it("out-of-office restart on a day the sequence has switched off waits for the next active day", () => {
    const back = at("2026-11-15T05:30:00Z"); // Sun 15 Nov 11:00 IST, Sunday is off
    expect(alignToWindow(back, ist).toISOString()).toBe("2026-11-16T02:30:00.000Z"); // Mon 08:00 IST
  });

  it("a due time at or after a day's closing hour moves on, and per-day hours are honoured", () => {
    const s: SendSchedule = { ...ist, hours: { "6": { start: "09:00", end: "12:00" } } };
    expect(local(alignToWindow(at("2026-11-14T07:00:00Z"), s))).toBe("Mon 08:00"); // Sat 12:30 IST, after Saturday's 12:00 close
    expect(local(alignToWindow(at("2026-11-13T18:00:00Z"), s))).toBe("Sat 09:00"); // Fri 23:30 IST -> Saturday opens 09:00
  });
});
