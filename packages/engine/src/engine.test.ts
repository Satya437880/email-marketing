import { describe, expect, it } from "vitest";
import { evaluate, nextEmailStep, orderDue, pickMailbox, pickVariant, type EvaluateInput, type MailboxCandidate } from "./planner";
import { isInWindow, localDayKey, nextWindowStart, type SendSchedule } from "./schedule";

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
