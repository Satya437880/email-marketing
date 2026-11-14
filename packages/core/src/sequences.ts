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
  const rows = await db.select({ id: sequenceContacts.id, state: sequenceContacts.state, dueAt: sequenceContacts.dueAt, nextRunAt: sequenceContacts.nextRunAt }).from(sequenceContacts)
    .where(and(eq(sequenceContacts.sequenceId, sequenceId), inArray(sequenceContacts.state, ["active", "ooo"]), sql`${sequenceContacts.nextRunAt} is not null`, sql`${sequenceContacts.nextStep} is not null`));
  const placed = recalculateDue(rows.map((r) => ({ dueAt: r.dueAt ?? r.nextRunAt! })), schedule, now);
  let changed = 0;
  for (const [i, r] of rows.entries()) {
    const at = placed[i]!;
    if (r.nextRunAt && r.nextRunAt.getTime() === at.getTime()) continue;
    await db.update(sequenceContacts).set({ nextRunAt: at, lastError: null }).where(and(eq(sequenceContacts.id, r.id), inArray(sequenceContacts.state, ["active", "ooo"])));
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

export async function setSequenceStatus(workspaceId: string, sequenceId: string, status: "active" | "paused"): Promise<void> {
  await db.update(sequences).set({ status })
    .where(and(eq(sequences.id, sequenceId), eq(sequences.workspaceId, workspaceId), inArray(sequences.status, status === "active" ? ["paused"] : ["active"])));
}
