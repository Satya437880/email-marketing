import { seededRandom } from "@outreach/mail";
import { nextWindowStart, type SendSchedule } from "./schedule";

export type Provider = "google" | "microsoft" | "smtp";

export interface MailboxCandidate {
  id: string;
  provider: Provider;
  active: boolean;
  dailyLimit: number;
  sentToday: number;
  nextAvailableAt?: Date | null;
}

export interface PickMailboxInput {
  candidates: MailboxCandidate[];
  stickyMailboxId?: string | null;
  contactEsp?: string | null;
  espMatching: boolean;
  now: Date;
  seed: string;
}

export type PickResult =
  | { ok: true; mailbox: MailboxCandidate }
  | { ok: false; reason: "sticky_unavailable" | "sticky_at_capacity" | "no_capacity" | "no_mailboxes" | "throttled"; retryAt?: Date };

const hasCapacity = (m: MailboxCandidate) => m.sentToday < m.dailyLimit;
const isFree = (m: MailboxCandidate, now: Date) => !m.nextAvailableAt || m.nextAvailableAt.getTime() <= now.getTime();

export function pickMailbox(input: PickMailboxInput): PickResult {
  const { candidates, now } = input;
  if (!candidates.length) return { ok: false, reason: "no_mailboxes" };

  // Follow-ups stay on the mailbox that sent the first email so the thread stays intact.
  if (input.stickyMailboxId) {
    const sticky = candidates.find((m) => m.id === input.stickyMailboxId);
    if (!sticky || !sticky.active) return { ok: false, reason: "sticky_unavailable" };
    if (!hasCapacity(sticky)) return { ok: false, reason: "sticky_at_capacity" };
    if (!isFree(sticky, now)) return { ok: false, reason: "throttled", retryAt: sticky.nextAvailableAt ?? undefined };
    return { ok: true, mailbox: sticky };
  }

  const withRoom = candidates.filter((m) => m.active && hasCapacity(m));
  if (!withRoom.length) return { ok: false, reason: "no_capacity" };
  const free = withRoom.filter((m) => isFree(m, now));
  if (!free.length) {
    const soonest = Math.min(...withRoom.map((m) => m.nextAvailableAt?.getTime() ?? now.getTime()));
    return { ok: false, reason: "throttled", retryAt: new Date(soonest) };
  }

  let pool = free;
  if (input.espMatching && (input.contactEsp === "google" || input.contactEsp === "microsoft")) {
    const matched = free.filter((m) => m.provider === input.contactEsp);
    if (matched.length) pool = matched;
  }

  const rand = seededRandom(input.seed);
  const scored = pool.map((m) => ({ m, load: m.sentToday / m.dailyLimit, tie: rand() }));
  scored.sort((a, b) => a.load - b.load || a.tie - b.tie);
  return { ok: true, mailbox: scored[0]!.m };
}

export interface DueItem {
  id: string;
  sequencePriority: "high" | "regular";
  inSequencePriority: "new_first" | "followups_first";
  currentStep: number;
  nextRunAt: Date;
}

export function orderDue<T extends DueItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.sequencePriority !== b.sequencePriority) return a.sequencePriority === "high" ? -1 : 1;
    if (a.inSequencePriority === b.inSequencePriority && a.currentStep !== b.currentStep) {
      return a.inSequencePriority === "new_first" ? a.currentStep - b.currentStep : b.currentStep - a.currentStep;
    }
    return a.nextRunAt.getTime() - b.nextRunAt.getTime();
  });
}

export interface Variant {
  id: string;
  weight: number;
}

export function pickVariant<V extends Variant>(variants: V[], seed: string): V | undefined {
  const usable = variants.filter((v) => v.weight > 0);
  if (!usable.length) return variants[0];
  const total = usable.reduce((s, v) => s + v.weight, 0);
  let r = seededRandom(seed)() * total;
  for (const v of usable) {
    r -= v.weight;
    if (r < 0) return v;
  }
  return usable[usable.length - 1];
}

export function randomGapMs(minSeconds: number, maxSeconds: number, rand: () => number = Math.random): number {
  const lo = Math.max(0, Math.min(minSeconds, maxSeconds));
  const hi = Math.max(minSeconds, maxSeconds);
  return Math.round((lo + rand() * (hi - lo)) * 1000);
}

export type StepType = "delay" | "email";

export interface Step {
  id: string;
  type: StepType;
  delayDays: number;
  // Extra wait on top of delayDays, for waits shorter than a day. Missing means none.
  delayMinutes?: number;
}

// Given the index of the step just completed (-1 before the first send), find the next email step
// and when it is due. Delay steps between them add up.
export function nextEmailStep(steps: Step[], afterIndex: number, from: Date): { index: number; dueAt: Date } | null {
  let ms = 0;
  for (let i = afterIndex + 1; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type === "delay") ms += step.delayDays * 86400000 + (step.delayMinutes ?? 0) * 60000;
    else return { index: i, dueAt: new Date(from.getTime() + ms) };
  }
  return null;
}

export interface CompanyState {
  stopOnCompanyReply: boolean;
  companyHasReplied: boolean;
  sequentialWithinCompany: boolean;
  otherContactInFlight: boolean;
  companyLimit: number | null;
  companyContactedCount: number;
  isFirstTouch: boolean;
}

export type Decision =
  | { action: "send"; mailboxId: string }
  | { action: "reschedule"; at: Date; reason: string }
  | { action: "stop"; state: "opted_out" | "finished" | "error"; reason: string };

export interface EvaluateInput {
  now: Date;
  schedule: SendSchedule;
  inDnc: boolean;
  unsubscribed: boolean;
  company: CompanyState;
  mailbox: PickMailboxInput;
}

const HOUR = 3600000;

export function evaluate(input: EvaluateInput): Decision {
  const { now } = input;
  if (input.inDnc || input.unsubscribed) return { action: "stop", state: "opted_out", reason: "do_not_contact" };

  const c = input.company;
  if (c.stopOnCompanyReply && c.companyHasReplied) return { action: "stop", state: "finished", reason: "company_replied" };
  if (c.isFirstTouch && c.companyLimit !== null && c.companyContactedCount >= c.companyLimit) {
    return { action: "stop", state: "finished", reason: "company_limit" };
  }
  if (c.isFirstTouch && c.sequentialWithinCompany && c.otherContactInFlight) {
    return { action: "reschedule", at: new Date(now.getTime() + 24 * HOUR), reason: "company_sequential" };
  }

  const windowStart = nextWindowStart(now, input.schedule);
  if (!windowStart) return { action: "stop", state: "error", reason: "invalid_schedule" };
  if (windowStart.getTime() > now.getTime()) return { action: "reschedule", at: windowStart, reason: "outside_window" };

  const pick = pickMailbox(input.mailbox);
  if (pick.ok) return { action: "send", mailboxId: pick.mailbox.id };
  if (pick.reason === "throttled" && pick.retryAt) return { action: "reschedule", at: pick.retryAt, reason: "throttled" };
  // Out of daily capacity: try again in an hour; counters reset at the mailbox's local midnight.
  return { action: "reschedule", at: new Date(now.getTime() + HOUR), reason: pick.reason };
}
