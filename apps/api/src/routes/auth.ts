import { seedWorkspace } from "@outreach/core";
import { db, memberships, organizations, users, workspaces } from "@outreach/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from "../auth";
import { body, HttpError } from "../http";

export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "workspace";
  return `${base}-${randomBytes(3).toString("hex")}`;
}

export async function createWorkspace(userId: string, name: string, orgId?: string) {
  return db.transaction(async (tx) => {
    const org = orgId ?? (await tx.insert(organizations).values({ name }).returning())[0]!.id;
    const [ws] = await tx.insert(workspaces).values({ orgId: org, name, slug: slugify(name) }).returning();
    await tx.insert(memberships).values({ userId, workspaceId: ws!.id, role: "owner" });
    return ws!;
  }).then(async (ws) => {
    await seedWorkspace(ws.id);
    return ws;
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/signup", async (req, reply) => {
    const b = body(req, z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200),
      company: z.string().trim().min(1).max(100).optional(),
    }));
    const exists = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (exists) throw new HttpError(409, "email_taken", "An account with this email already exists");
    const [user] = await db.insert(users).values({ name: b.name, email: b.email, passwordHash: await hashPassword(b.password) }).returning();
    const ws = await createWorkspace(user!.id, b.company ?? `${b.name.split(" ")[0]}'s workspace`);
    await createSession(reply, user!.id);
    return { user: { id: user!.id, name: user!.name, email: user!.email }, workspace: ws };
  });

  app.post("/v1/auth/login", async (req, reply) => {
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }));
    const user = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, b.password))) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    }
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await createSession(reply, user.id);
    return { ok: true };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  app.get("/v1/me", async (req) => {
    const user = requireUser(req);
    const rows = await db.select({ ws: workspaces, role: memberships.role }).from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId)).where(eq(memberships.userId, user.id));
    return {
      user: { id: user.id, name: user.name, email: user.email },
      workspaces: rows.map((r) => ({ id: r.ws.id, slug: r.ws.slug, name: r.ws.name, timezone: r.ws.timezone, autoLabel: r.ws.autoLabel, role: r.role })),
    };
  });

  app.post("/v1/workspaces", async (req) => {
    const user = requireUser(req);
    const b = body(req, z.object({ name: z.string().trim().min(1).max(100) }));
    return createWorkspace(user.id, b.name);
  });
}
