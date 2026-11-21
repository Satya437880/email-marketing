import { db, sequenceContacts, sequences, sequenceSteps } from "@outreach/db";
import { alignToWindow, nextEmailStep, nextUnsentEmailStep, recalculateDue, type SendSchedule } from "@outreach/engine";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

async function firstEmailIndex(sequenceId: string) {
  const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.position));
  return { steps, first: nextEmailStep(steps.map((s) => ({ id: s.id, type: s.type, delayDays: s.delayDays, delayMinutes: s.delayMinutes })), -1, new Date()) };
}

export async function addContactsToSequence(workspaceId: string, sequenceId: string, contactIds: string[]): Promise<number> {
  if (!contactIds.length) return 0;
  const seq = await db.query.sequences.findFirst({ where: and(eq(sequences.id, sequenceId), eq(sequences.workspaceId, workspaceId)) });
  if (!seq) throw new Error("Sequence not found");
  const live = seq.status === "active" || seq.status === "completed";
  const { first } = live ? await firstEmailIndex(sequenceId) : { first: null };
  let added = 0;
  for (let i = 0; i < contactIds.length; i += 1000) {
    const chunk = contactIds.slice(i, i + 1000);
    const rows = await db.insert(sequenceContacts).values(chunk.map((contactId) => ({
      workspaceId,
      sequenceId,
      contactId,
      state: live && first ? ("active" as const) : ("queued" as const),
      nextStep: live && first ? first.index : null,
      nextRunAt: live && first ? alignToWindow(first.dueAt, seq.settings.schedule) : null,
      dueAt: live && first ? first.dueAt : null,
    }))).onConflictDoNothing().returning({ id: sequenceContacts.id });
    added += rows.length;
  }
  if (added && seq.status === "completed") await db.update(sequences).set({ status: "active" }).where(eq(sequences.id, sequenceId));
  // Emails added to the sequence since its contacts finished are sent to them too.
  if (live) await continueFinishedContacts(sequenceId);
  return added;
}

// After the Schedule tab changes, every email of this sequence that is still waiting is placed again in the new timezone, days and hours.
export async function rescheduleWaitingEmails(sequenceId: string, schedule: SendSchedule, now = new Date()): Promise<number> {
  const rows = await db.select({ id: sequenceContacts.id, state: sequenceContacts.state, dueAt: sequenceContacts.dueAt, nextRunAt: sequenceContacts.nextRunAt, lastError: sequenceContacts.lastError }).from(sequenceContacts)
    .where(and(eq(sequenceContacts.sequenceId, sequenceId), inArray(sequenceContacts.state, ["active", "ooo"]), sql`${sequenceContacts.nextRunAt} is not null`, sql`${sequenceContacts.nextStep} is not null`));
  const placed = recalculateDue(rows.map((r) => ({
    // Rows from before due_at existed: one that was pushed back for being outside the window was already due, so it is due now.
    dueAt: r.dueAt ?? (r.lastError === "outside_window" ? now : r.nextRunAt!),
  })), schedule, now);
  let changed = 0;
  for (const [i, r] of rows.entries()) {
    const at = placed[i]!;
    if (r.nextRunAt && r.nextRunAt.getTime() === at.getTime()) continue;
    await db.update(sequenceContacts).set({ nextRunAt: at, dueAt: r.dueAt ?? at, lastError: null }).where(and(eq(sequenceContacts.id, r.id), inArray(sequenceContacts.state, ["active", "ooo"])));
    changed++;
  }
  return changed;
}

// After the steps change (a new wait, a moved or removed step), emails still waiting are timed again from when the contact last got an
// email (or from launch / when they were added), using the new waits, then placed in the next open window of the schedule.
export async function retimeWaitingEmails(sequenceId: string, now = new Date()): Promise<number> {
  const seq = await db.query.sequences.findFirst({ where: eq(sequences.id, sequenceId) });
  if (!seq || seq.status !== "active") return 0;
  const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.position));
  const rows = await db.execute<{ id: string; current_step: number; next_step: number; next_run_at: Date; base: Date }>(sql`
    select sc.id, sc.current_step, sc.next_step, sc.next_run_at,
           coalesce((select max(m.sent_at) from messages m where m.sequence_id = sc.sequence_id and m.contact_id = sc.contact_id and m.direction = 'out'),
                    greatest(coalesce(sq.launched_at, sc.created_at), sc.created_at)) as base
    from sequence_contacts sc join sequences sq on sq.id = sc.sequence_id
    where sc.sequence_id = ${sequenceId} and sc.state = 'active' and sc.next_step is not null and sc.next_run_at is not null
  `) as unknown as { id: string; current_step: number; next_step: number; next_run_at: Date; base: Date }[];
  let changed = 0;
  for (const r of rows) {
    const target = steps[r.next_step];
    if (!target || target.type !== "email") continue;
    let ms = 0;
    for (let i = r.current_step + 1; i < r.next_step; i++) {
      const st = steps[i]!;
      if (st.type === "delay") ms += st.delayDays * 86400000 + (st.delayMinutes ?? 0) * 60000;
    }
    const dueAt = new Date(new Date(r.base).getTime() + ms);
    const at = alignToWindow(new Date(Math.max(dueAt.getTime(), now.getTime())), seq.settings.schedule);
    if (new Date(r.next_run_at).getTime() === at.getTime()) continue;
    await db.update(sequenceContacts).set({ nextRunAt: at, dueAt, lastError: null }).where(and(eq(sequenceContacts.id, r.id), eq(sequenceContacts.state, "active")));
    changed++;
  }
  return changed;
}

// New emails were added to a running (or finished) sequence: contacts who had already finished it carry on with the new emails,
// timed from their last email using the waits before the new steps, and placed in the next open sending window.
// Contacts who replied, bounced, opted out or were stopped on purpose (a company reply, a cancelled email) stay stopped, and an email a
// contact already received is never sent again.
export async function continueFinishedContacts(sequenceId: string, now = new Date()): Promise<number> {
  const seq = await db.query.sequences.findFirst({ where: eq(sequences.id, sequenceId) });
  if (!seq || (seq.status !== "active" && seq.status !== "completed")) return 0;
  const steps = (await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequenceId)).orderBy(asc(sequenceSteps.position)))
    .map((s) => ({ id: s.id, type: s.type, delayDays: s.delayDays, delayMinutes: s.delayMinutes }));
  if (!steps.some((s) => s.type === "email")) return 0;
  const rows = await db.execute<{ id: string; current_step: number; base: Date; sent: string[] | null }>(sql`
    select sc.id, sc.current_step,
           coalesce((select max(m.sent_at) from messages m where m.sequence_id = sc.sequence_id and m.contact_id = sc.contact_id and m.direction = 'out'), sc.created_at) as base,
           (select array_agg(distinct m.step_id::text) from messages m where m.sequence_id = sc.sequence_id and m.contact_id = sc.contact_id and m.direction = 'out' and m.step_id is not null) as sent
    from sequence_contacts sc
    where sc.sequence_id = ${sequenceId} and sc.state = 'finished' and sc.last_error is null
  `) as unknown as { id: string; current_step: number; base: Date; sent: string[] | null }[];
  let resumed = 0;
  for (const r of rows) {
    // A contact who never received any email from this sequence starts at its first email, not partway through.
    const next = nextUnsentEmailStep(steps, (r.sent ?? []).length ? r.current_step : -1, new Set(r.sent ?? []), new Date(r.base));
    if (!next) continue;
    const at = alignToWindow(new Date(Math.max(next.dueAt.getTime(), now.getTime())), seq.settings.schedule);
    const done = await db.update(sequenceContacts).set({ state: "active", nextStep: next.index, dueAt: next.dueAt, nextRunAt: at, lastError: null })
      .where(and(eq(sequenceContacts.id, r.id), eq(sequenceContacts.state, "finished"), isNull(sequenceContacts.lastError))).returning({ id: sequenceContacts.id });
    resumed += done.length;
  }
  if (resumed && seq.status === "completed") await db.update(sequences).set({ status: "active" }).where(eq(sequences.id, sequenceId));
  return resumed;
}

// The standing check that keeps every running sequence up to date by itself, so nobody has to say "I added contacts" or "I added an email":
//  1. contacts waiting in a running sequence are scheduled;
//  2. contacts who finished earlier carry on with emails added since;
//  3. a sequence marked completed that has work to do is active again.
// It runs on every planner tick, when the sequence screens are loaded, and when a sequence is switched on. It is cheap when nothing changed.
let lastSync = 0;
export async function syncLiveSequences(opts: { now?: Date; force?: boolean } = {}): Promise<{ scheduled: number; resumed: number; reactivated: number }> {
  const now = opts.now ?? new Date();
  if (!opts.force && Date.now() - lastSync < 10_000) return { scheduled: 0, resumed: 0, reactivated: 0 };
  lastSync = Date.now();
  let scheduled = 0;
  let resumed = 0;

  const waiting = await db.execute<{ id: string }>(sql`
    select distinct sc.sequence_id as id from sequence_contacts sc join sequences s on s.id = sc.sequence_id
    where sc.state = 'queued' and s.status in ('active', 'completed')
  `) as unknown as { id: string }[];
  for (const w of waiting) {
    const seq = await db.query.sequences.findFirst({ where: eq(sequences.id, w.id) });
    const { first } = await firstEmailIndex(w.id);
    if (!seq || !first) continue;
    const done = await db.update(sequenceContacts).set({ state: "active", nextStep: first.index, nextRunAt: alignToWindow(first.dueAt, seq.settings.schedule), dueAt: first.dueAt })
      .where(and(eq(sequenceContacts.sequenceId, w.id), eq(sequenceContacts.state, "queued"))).returning({ id: sequenceContacts.id });
    scheduled += done.length;
  }

  const candidates = await db.execute<{ id: string }>(sql`
    select distinct s.id from sequences s
    join sequence_contacts sc on sc.sequence_id = s.id and sc.state = 'finished' and sc.last_error is null
    where s.status in ('active', 'completed')
      and exists (select 1 from sequence_steps st where st.sequence_id = s.id and st.type = 'email' and st.position > sc.current_step)
  `) as unknown as { id: string }[];
  for (const c of candidates) resumed += await continueFinishedContacts(c.id, now);

  const re = await db.execute<{ id: string }>(sql`
    update sequences set status = 'active'
    where status = 'completed' and exists (select 1 from sequence_contacts sc where sc.sequence_id = sequences.id and sc.state in ('queued', 'active', 'sending', 'ooo'))
    returning id
  `) as unknown as { id: string }[];
  return { scheduled, resumed, reactivated: re.length };
}

export class LaunchError extends Error {}

export async function launchSequence(workspaceId: string, sequenceId: string): Promise<void> {
  const seq = await db.query.sequences.findFirst({ where: and(eq(sequences.id, sequenceId), eq(sequences.workspaceId, workspaceId)) });
  if (!seq) throw new LaunchError("Sequence not found");
  // Everything that is missing is reported together, so one pop-up says what to add.
  const { first } = await firstEmailIndex(sequenceId);
  const [{ senders } = { senders: 0 }] = await db.execute<{ senders: number }>(sql`
    select count(*)::int as senders from sequence_senders ss
    join sender_profile_mailboxes spm on spm.sender_profile_id = ss.sender_profile_id
    where ss.sequence_id = ${sequenceId}
  `) as unknown as { senders: number }[];
  const [{ people } = { people: 0 }] = await db.execute<{ people: number }>(sql`
    select count(*)::int as people from sequence_contacts where sequence_id = ${sequenceId}
  `) as unknown as { people: number }[];
  const emptyVariant = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from sequence_steps st
    where st.sequence_id = ${sequenceId} and st.type = 'email'
      and not exists (select 1 from step_variants v where v.step_id = st.id and length(trim(v.body_html)) > 0)
  `) as unknown as { n: number }[];
  const missing: string[] = [];
  if (!first) missing.push("Email drafts not found: add at least one email step");
  else if ((emptyVariant[0]?.n ?? 0) > 0) missing.push("Email drafts are empty: every email step needs a draft with some text");
  if (!people) missing.push("Contacts not found: add contacts to this sequence");
  if (!senders) missing.push("Mailbox not found: attach a mailbox or rotation to this sequence");
  if (missing.length) throw new LaunchError(`Can't activate this sequence yet. ${missing.join(". ")}.`);
  if (!first) throw new LaunchError("Email drafts not found");

  await db.transaction(async (tx) => {
    await tx.update(sequences).set({ status: "active", launchedAt: seq.launchedAt ?? new Date() }).where(eq(sequences.id, sequenceId));
    // The first email's "start after" wait counts from launch.
    await tx.update(sequenceContacts).set({ state: "active", nextStep: first.index, nextRunAt: alignToWindow(first.dueAt, seq.settings.schedule), dueAt: first.dueAt })
      .where(and(eq(sequenceContacts.sequenceId, sequenceId), eq(sequenceContacts.state, "queued")));
  });
}

