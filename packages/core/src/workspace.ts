import { contacts, db, labels, organizations, SYSTEM_LABELS, dncEntries, sequenceContacts, sequences, workspaces } from "@outreach/db";
import { alignToWindow } from "@outreach/engine";
import { and, eq, inArray, or, sql } from "drizzle-orm";

export async function seedWorkspace(workspaceId: string): Promise<void> {
  await db
    .insert(labels)
    .values(SYSTEM_LABELS.map((l, i) => ({ workspaceId, name: l.name, color: l.color, countsAs: l.countsAs, system: true, position: i })))
    .onConflictDoNothing();
}

export async function labelId(workspaceId: string, name: string): Promise<string | null> {
  const [row] = await db.select({ id: labels.id }).from(labels).where(and(eq(labels.workspaceId, workspaceId), eq(labels.name, name)));
  return row?.id ?? null;
}

export function emailDomain(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

// Workspaces whose DNC entries apply here: just this one, or every workspace of the account when merging is on.
async function dncScope(workspaceId: string): Promise<string[]> {
  const [row] = await db.select({ orgId: workspaces.orgId, merge: organizations.mergeDnc }).from(workspaces)
    .innerJoin(organizations, eq(organizations.id, workspaces.orgId)).where(eq(workspaces.id, workspaceId));
  if (!row?.merge) return [workspaceId];
  const all = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.orgId, row.orgId));
  return all.map((w) => w.id);
}

export async function dncMatches(workspaceId: string, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const lower = emails.map((e) => e.toLowerCase());
  const domains = [...new Set(lower.map(emailDomain))];
  const scope = await dncScope(workspaceId);
  const rows = await db
    .select({ type: dncEntries.type, value: dncEntries.value })
    .from(dncEntries)
    .where(and(
      inArray(dncEntries.workspaceId, scope),
      or(
        and(eq(dncEntries.type, "email"), inArray(dncEntries.value, lower)),
        and(eq(dncEntries.type, "domain"), inArray(dncEntries.value, domains)),
      ),
    ));
  const blockedEmails = new Set(rows.filter((r) => r.type === "email").map((r) => r.value));
  const blockedDomains = new Set(rows.filter((r) => r.type === "domain").map((r) => r.value));
  return new Set(lower.filter((e) => blockedEmails.has(e) || blockedDomains.has(emailDomain(e))));
}

export async function addDnc(workspaceId: string, type: "email" | "domain", value: string, source: string): Promise<void> {
  await db.insert(dncEntries).values({ workspaceId, type, value: value.trim().toLowerCase(), source }).onConflictDoNothing();
}

// Removes entries (emails or whole domains) from the do-not-contact list. Contacts no longer covered by any entry stop being
// "unsubscribed", and wherever they were stopped as opted out they are put back, including in sequences that have since completed.
export async function removeDncEntries(workspaceId: string, ids: string[], now = new Date()): Promise<{ removed: number; restored: number }> {
  const entries = await db.select().from(dncEntries).where(and(eq(dncEntries.workspaceId, workspaceId), inArray(dncEntries.id, ids)));
  if (!entries.length) return { removed: 0, restored: 0 };
  await db.delete(dncEntries).where(and(eq(dncEntries.workspaceId, workspaceId), inArray(dncEntries.id, entries.map((e) => e.id))));
  const emails = entries.filter((e) => e.type === "email").map((e) => e.value.toLowerCase());
  const domains = entries.filter((e) => e.type === "domain").map((e) => e.value.toLowerCase());

  const covered = await db.select({ id: contacts.id, email: contacts.email }).from(contacts).where(and(
    eq(contacts.workspaceId, workspaceId),
    or(
      emails.length ? inArray(sql`lower(${contacts.email})`, emails) : undefined,
      domains.length ? inArray(sql`split_part(lower(${contacts.email}), '@', 2)`, domains) : undefined,
    ),
  ));
  // Someone still listed another way (their own address, or their domain) stays blocked.
  const stillBlocked = await dncMatches(workspaceId, covered.map((c) => c.email));
  const freed = covered.filter((c) => !stillBlocked.has(c.email.toLowerCase())).map((c) => c.id);
  if (!freed.length) return { removed: entries.length, restored: 0 };
  await db.update(contacts).set({ unsubscribedAt: null }).where(inArray(contacts.id, freed));

  const stopped = await db.select({ id: sequenceContacts.id, currentStep: sequenceContacts.currentStep, nextStep: sequenceContacts.nextStep, settings: sequences.settings })
    .from(sequenceContacts)
    .innerJoin(sequences, eq(sequences.id, sequenceContacts.sequenceId))
    .where(and(inArray(sequenceContacts.contactId, freed), eq(sequenceContacts.state, "opted_out")));
  for (const r of stopped) {
    // Waiting for a step: carry on from it. Never emailed: queue for the first email. Otherwise: finished, so only unsent emails follow.
    const change = r.nextStep !== null
      ? { state: "active" as const, nextRunAt: alignToWindow(now, r.settings.schedule), dueAt: now }
      : { state: r.currentStep < 0 ? ("queued" as const) : ("finished" as const), nextRunAt: null, dueAt: null };
    // The running-sequence check (syncLiveSequences) schedules these and makes a completed sequence active again.
    await db.update(sequenceContacts).set({ ...change, lastError: null }).where(eq(sequenceContacts.id, r.id));
  }
  return { removed: entries.length, restored: stopped.length };
}
