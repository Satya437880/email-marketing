import type { LoginProfile } from "@outreach/core";
import { db, users } from "@outreach/db";
import { eq } from "drizzle-orm";
import { createWorkspace } from "./routes/auth";

export type LoginResolution = { ok: true; userId: string; created: boolean } | { ok: false; message: string };

// Decides which app user a Google/Microsoft sign-in belongs to.
//  1. The account was used before: log that user in.
//  2. An account with the same email exists: link it only when the provider verified the email (Google does,
//     Microsoft's email claim is not proof of ownership), and never replace an already-linked account.
//  3. Otherwise create a new user with a first workspace.
export async function resolveOAuthLogin(p: LoginProfile): Promise<LoginResolution> {
  const google = p.provider === "google";
  const subColumn = google ? users.googleSub : users.microsoftSub;
  const link = google ? { googleSub: p.sub } : { microsoftSub: p.sub };

  const bySub = await db.query.users.findFirst({ where: eq(subColumn, p.sub) });
  if (bySub) return { ok: true, userId: bySub.id, created: false };

  const byEmail = await db.query.users.findFirst({ where: eq(users.email, p.email) });
  if (byEmail) {
    const alreadyLinked = google ? byEmail.googleSub : byEmail.microsoftSub;
    if (!p.emailVerified || alreadyLinked) {
      return { ok: false, message: `An account for ${p.email} already exists. Please log in with your password.` };
    }
    await db.update(users).set(link).where(eq(users.id, byEmail.id));
    return { ok: true, userId: byEmail.id, created: false };
  }

  const [user] = await db.insert(users).values({ email: p.email, name: p.name, ...link }).returning();
  await createWorkspace(user!.id, `${p.name.split(/\s+/)[0] ?? "My"}'s workspace`);
  return { ok: true, userId: user!.id, created: true };
}
