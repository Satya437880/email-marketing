import { db, sequenceContacts, sequences, sequenceSteps } from "@outreach/db";
import { alignToWindow, nextEmailStep, recalculateDue, type SendSchedule } from "@outreach/engine";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

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

export class LaunchError extends Error {}

export async function launchSequence(workspaceId: string, sequenceId: string): Promise<void> {
  const seq = await db.query.sequences.findFirst({ where: and(eq(sequences.id, sequenceId), eq(sequences.workspaceId, workspaceId)) });
  if (!seq) throw new LaunchError("Sequence not found");
  const { first } = await firstEmailIndex(sequenceId);
  if (!first) throw new LaunchError("Add at least one email step before launching");
  const [{ senders } = { senders: 0 }] = await db.execute<{ senders: number }>(sql`
    select count(*)::int as senders from sequence_senders ss
    join sender_profile_mailboxes spm on spm.sender_profile_id = ss.sender_profile_id
    where ss.sequence_id = ${sequenceId}
  `) as unknown as { senders: number }[];
  if (!senders) throw new LaunchError("Attach a rotation or mailboxes to this sequence before launching");
  const emptyVariant = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from sequence_steps st
    where st.sequence_id = ${sequenceId} and st.type = 'email'
      and not exists (select 1 from step_variants v where v.step_id = st.id and length(trim(v.body_html)) > 0)
  `) as unknown as { n: number }[];
  if ((emptyVariant[0]?.n ?? 0) > 0) throw new LaunchError("Every email step needs a variant with a body");

  await db.transaction(async (tx) => {
    await tx.update(sequences).set({ status: "active", launchedAt: seq.launchedAt ?? new Date() }).where(eq(sequences.id, sequenceId));
    // The first email's "start after" wait counts from launch.
    await tx.update(sequenceContacts).set({ state: "active", nextStep: first.index, nextRunAt: alignToWindow(first.dueAt, seq.settings.schedule), dueAt: first.dueAt })
      .where(and(eq(sequenceContacts.sequenceId, sequenceId), eq(sequenceContacts.state, "queued")));
  });
}

