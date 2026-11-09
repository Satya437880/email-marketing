import { db, labels, organizations, SYSTEM_LABELS, dncEntries, workspaces } from "@outreach/db";
import { and, eq, inArray, or } from "drizzle-orm";

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
