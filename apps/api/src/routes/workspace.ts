import { randomBytes } from "node:crypto";
import { apiKeys, db, dncEntries, labels, memberships, organizations, threads, users, WEBHOOK_EVENTS, webhooks, workspaces } from "@outreach/db";
import { addDnc, assertPublicHttpsUrl, removeDncEntries, sendTestEvent } from "@outreach/core";
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { API_KEY_PREFIX, hashApiKey, hashPassword, requireRole, requireUser, wsId } from "../auth";
import { body, HttpError, idParams, params, query } from "../http";

// Throws if `userId` is the only admin (or owner) left, because removing or demoting them would lock everyone out of settings.
async function assertAnotherAdmin(workspaceId: string, userId: string) {
  const admins = await db.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), inArray(memberships.role, ["owner", "admin"])));
  if (admins.length === 1 && admins[0]!.userId === userId) throw new HttpError(400, "last_admin", "Make someone else an admin first. A workspace needs at least one admin.");
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.patch("/v1/workspaces/:ws", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({ name: z.string().trim().min(1).max(100).optional(), timezone: z.string().optional(), autoLabel: z.boolean().optional() }));
    if (b.timezone) {
      try { new Intl.DateTimeFormat("en", { timeZone: b.timezone }); } catch { throw new HttpError(400, "invalid_timezone", "Unknown time zone"); }
    }
    const [ws] = await db.update(workspaces).set(b).where(eq(workspaces.id, wsId(req))).returning();
    return ws;
  });

  // "Add existing user": people already in your account's other workspaces (so they have signed in before) who are not in this one yet.
  app.get("/v1/workspaces/:ws/account-users", async (req) => {
    requireRole(req, "owner", "admin");
    const current = wsId(req);
    const orgId = req.workspace!.orgId;
    const rows = await db.execute<{ id: string; name: string; email: string }>(sql`
      select distinct u.id, u.name, u.email
      from memberships m
      join workspaces w on w.id = m.workspace_id
      join users u on u.id = m.user_id
      where w.org_id = ${orgId} and m.workspace_id <> ${current}
        and not exists (select 1 from memberships x where x.user_id = u.id and x.workspace_id = ${current})
      order by u.name
    `) as unknown as { id: string; name: string; email: string }[];
    return rows;
  });

  app.get("/v1/workspaces/:ws/members", async (req) => {
    return db.select({ id: users.id, name: users.name, email: users.email, role: memberships.role }).from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.workspaceId, wsId(req))).orderBy(asc(users.name));
  });

  app.post("/v1/workspaces/:ws/members", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member", "viewer", "primebox"]) }));
    const user = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (!user) throw new HttpError(404, "user_not_found", "No account uses that email yet. Ask them to sign up first.");
    await db.insert(memberships).values({ userId: user.id, workspaceId: wsId(req), role: b.role })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.workspaceId], set: { role: b.role } });
    return { ok: true };
  });

  // "Add new user": creates the account with a password the admin shares with them, then adds them here.
  app.post("/v1/workspaces/:ws/members/new", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200),
      role: z.enum(["admin", "member", "viewer", "primebox"]),
    }));
    const existing = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (existing) throw new HttpError(409, "user_exists", "This person already has an account. Use “Add existing users” instead.");
    const [user] = await db.insert(users).values({ name: b.name, email: b.email, passwordHash: await hashPassword(b.password) }).returning();
    await db.insert(memberships).values({ userId: user!.id, workspaceId: wsId(req), role: b.role });
    return { id: user!.id, name: user!.name, email: user!.email, role: b.role };
  });

  app.patch("/v1/workspaces/:ws/members/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    const b = body(req, z.object({ role: z.enum(["admin", "member", "viewer", "primebox"]) }));
    // Everyone is equal: any admin can change anyone's role. Only the last admin is protected, so the workspace is never left without one.
    if (b.role !== "admin") await assertAnotherAdmin(wsId(req), p.id);
    const [row] = await db.update(memberships).set({ role: b.role }).where(and(eq(memberships.workspaceId, wsId(req)), eq(memberships.userId, p.id))).returning();
    if (!row) throw new HttpError(404, "not_found", "That person is not in this workspace");
    return { ok: true };
  });

  app.get("/v1/workspaces/:ws/usage", async (req) => {
    const id = wsId(req);
    const [row] = await db.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from contacts where workspace_id = ${id}) as contacts,
        (select count(distinct contact_id)::int from sequence_contacts where workspace_id = ${id} and state in ('queued','active','sending','ooo')) as active_contacts,
        (select count(*)::int from events where workspace_id = ${id} and type = 'sent' and occurred_at >= date_trunc('month', now())) as emails_this_month,
        (select count(*)::int from events where workspace_id = ${id} and type = 'sent' and occurred_at >= now() - interval '1 day') as emails_24h,
        (select count(*)::int from mailboxes where workspace_id = ${id}) as mailboxes,
        (select count(*)::int from mailboxes where workspace_id = ${id} and status = 'active') as active_mailboxes,
        (select coalesce(sum(daily_limit), 0)::int from mailboxes where workspace_id = ${id} and status = 'active') as daily_capacity,
        (select count(*)::int from sequences where workspace_id = ${id}) as sequences,
        (select count(*)::int from sequences where workspace_id = ${id} and status = 'active') as active_sequences,
        (select count(*)::int from memberships where workspace_id = ${id}) as members
    `) as unknown as Record<string, number>[];
    return row;
  });

  app.get("/v1/workspaces/:ws/api-keys", async (req) => {
    requireRole(req, "owner", "admin");
    return db.select({
      id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt,
      createdBy: users.name,
    }).from(apiKeys).leftJoin(users, eq(users.id, apiKeys.createdBy))
      .where(and(eq(apiKeys.workspaceId, wsId(req)), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt));
  });

  app.post("/v1/workspaces/:ws/api-keys", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({ name: z.string().trim().min(1).max(80) }));
    const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    const [row] = await db.insert(apiKeys).values({
      workspaceId: wsId(req), name: b.name, prefix: key.slice(0, 10), keyHash: hashApiKey(key), createdBy: req.user?.id ?? null,
    }).returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt });
    // The full key is only ever returned here.
    return { ...row, key };
  });

  app.delete("/v1/workspaces/:ws/api-keys/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, p.id), eq(apiKeys.workspaceId, wsId(req))));
    return { ok: true };
  });

  app.delete("/v1/workspaces/:ws/members/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    await assertAnotherAdmin(wsId(req), p.id);
    await db.delete(memberships).where(and(eq(memberships.workspaceId, wsId(req)), eq(memberships.userId, p.id)));
    return { ok: true };
  });

  // Do-not-contact list
  app.get("/v1/workspaces/:ws/dnc", async (req) => {
    const q = query(req, z.object({ q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }));
    const where = and(eq(dncEntries.workspaceId, wsId(req)), q.q ? ilike(dncEntries.value, `%${q.q}%`) : undefined);
    const [rows, [count]] = await Promise.all([
      db.select().from(dncEntries).where(where).orderBy(desc(dncEntries.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      db.select({ n: sql<number>`count(*)::int` }).from(dncEntries).where(where),
    ]);
    return { items: rows, total: count?.n ?? 0 };
  });

  app.get("/v1/workspaces/:ws/dnc/settings", async (req) => {
    const ws = req.workspace!;
    const org = await db.query.organizations.findFirst({ where: eq(organizations.id, ws.orgId) });
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaces).where(eq(workspaces.orgId, ws.orgId));
    return { mergeDnc: org?.mergeDnc ?? false, workspaceCount: count?.n ?? 1 };
  });

  app.patch("/v1/workspaces/:ws/dnc/settings", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({ mergeDnc: z.boolean() }));
    await db.update(organizations).set({ mergeDnc: b.mergeDnc }).where(eq(organizations.id, req.workspace!.orgId));
    return b;
  });

  app.post("/v1/workspaces/:ws/dnc", async (req) => {
    const b = body(req, z.object({ values: z.string().min(1).max(200000) }));
    let added = 0;
    for (const raw of b.values.split(/[\s,;]+/).map((v) => v.trim().toLowerCase()).filter(Boolean)) {
      const type = raw.includes("@") ? "email" : "domain";
      if (type === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) continue;
      await addDnc(wsId(req), type, raw, "manual");
      added++;
    }
    return { added };
  });

  app.post("/v1/workspaces/:ws/dnc/delete", async (req) => {
    const b = body(req, z.object({ ids: z.array(z.string().uuid()).min(1) }));
    return { ok: true, ...(await removeDncEntries(wsId(req), b.ids)) };
  });

  app.get("/v1/workspaces/:ws/dnc/export", async (req, reply) => {
    const rows = await db.select().from(dncEntries).where(eq(dncEntries.workspaceId, wsId(req))).orderBy(asc(dncEntries.value));
    reply.header("content-type", "text/csv").header("content-disposition", 'attachment; filename="dnc.csv"');
    return ["type,value,source,created_at", ...rows.map((r) => `${r.type},${r.value},${r.source},${r.createdAt.toISOString()}`)].join("\n");
  });

  // Webhooks (also used for the Slack integration)
  app.get("/v1/workspaces/:ws/webhooks", async (req) => {
    requireRole(req, "owner", "admin");
    const rows = await db.select().from(webhooks).where(eq(webhooks.workspaceId, wsId(req))).orderBy(desc(webhooks.createdAt));
    return rows.map(({ secret, ...r }) => ({ ...r, secretPreview: `${secret.slice(0, 6)}…` }));
  });

  app.post("/v1/workspaces/:ws/webhooks", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({
      name: z.string().trim().min(1).max(80),
      url: z.string().trim().max(2000),
      kind: z.enum(["generic", "slack"]).default("generic"),
      events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
    }));
    try {
      await assertPublicHttpsUrl(b.url);
    } catch (e) {
      throw new HttpError(400, "invalid_url", (e as Error).message);
    }
    if (b.kind === "slack" && !/^https:\/\/hooks\.slack\.com\/services\//.test(b.url)) {
      throw new HttpError(400, "invalid_slack_url", "Paste a Slack incoming-webhook URL (it starts with https://hooks.slack.com/services/)");
    }
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const [row] = await db.insert(webhooks).values({ workspaceId: wsId(req), ...b, secret }).returning();
    // The signing secret is shown once so the receiver can verify X-Webhook-Signature.
    return { ...row, secret: b.kind === "generic" ? secret : undefined };
  });

  app.post("/v1/workspaces/:ws/webhooks/:id/test", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    const hook = await db.query.webhooks.findFirst({ where: and(eq(webhooks.id, p.id), eq(webhooks.workspaceId, wsId(req))) });
    if (!hook) throw new HttpError(404, "not_found", "Webhook not found");
    return sendTestEvent(hook);
  });

  app.delete("/v1/workspaces/:ws/webhooks/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    await db.delete(webhooks).where(and(eq(webhooks.id, p.id), eq(webhooks.workspaceId, wsId(req))));
    return { ok: true };
  });

  // Labels
  app.get("/v1/workspaces/:ws/labels", async (req) => {
    const id = wsId(req);
    const rows = await db.select({
      id: labels.id, name: labels.name, color: labels.color, system: labels.system, countsAs: labels.countsAs,
      // The label's id is written out in full: with a bare "id" the subquery would read the thread's own id and always count 0.
      count: sql<number>`(select count(*)::int from ${threads} t where t.label_id = "labels"."id" and t.has_inbound)`,
      unread: sql<number>`(select count(*)::int from ${threads} t where t.label_id = "labels"."id" and t.has_inbound and t.unread)`,
    }).from(labels).where(eq(labels.workspaceId, id)).orderBy(asc(labels.position), asc(labels.name));
    return rows;
  });

  app.post("/v1/workspaces/:ws/labels", async (req) => {
    const b = body(req, z.object({
      name: z.string().trim().min(1).max(40),
      color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#64748b"),
      countsAs: z.enum(["positive", "negative", "meeting", "closed", "neutral"]).default("neutral"),
    }));
    const [row] = await db.insert(labels).values({ workspaceId: wsId(req), ...b, position: 100 }).onConflictDoNothing().returning();
    if (!row) throw new HttpError(409, "label_exists", "A label with this name already exists");
    return row;
  });

  app.delete("/v1/workspaces/:ws/labels/:id", async (req) => {
    const p = params(req, idParams);
    await db.delete(labels).where(and(eq(labels.workspaceId, wsId(req)), eq(labels.id, p.id), eq(labels.system, false)));
    return { ok: true };
  });
}
