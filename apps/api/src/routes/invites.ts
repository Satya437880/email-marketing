import { createHash, randomBytes } from "node:crypto";
import { connectionFor } from "@outreach/core";
import { db, mailboxes, memberships, users, workspaceInvites, workspaces } from "@outreach/db";
import { composeEmail, sendSmtp, sendSystemEmail, systemMailConfigured } from "@outreach/mail";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession, hashPassword, requireRole, requireUser, wsId } from "../auth";
import { body, HttpError, idParams, notFound, params } from "../http";

const INVITE_DAYS = 7;
const ROLES = ["admin", "member", "viewer", "primebox"] as const;
const ROLE_NAMES: Record<string, string> = { admin: "Admin", member: "Standard", viewer: "Viewer", primebox: "Primebox only", owner: "Owner" };

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const appUrl = () => (process.env.PUBLIC_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");

export async function inviteRoutes(app: FastifyInstance) {
  // Invite someone by email. They get a link; opening it adds them to the workspace, with no password to share.
  app.post("/v1/workspaces/:ws/invites", async (req) => {
    requireRole(req, "owner", "admin");
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ROLES) }));
    const workspaceId = wsId(req);
    const inviter = requireUser(req);
    const already = await db.select({ id: users.id }).from(users).innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(users.email, b.email), eq(memberships.workspaceId, workspaceId)));
    if (already.length) throw new HttpError(409, "already_member", "That person is already in this workspace.");

    // A newer invite replaces an older pending one for the same address.
    await db.delete(workspaceInvites).where(and(eq(workspaceInvites.workspaceId, workspaceId), eq(workspaceInvites.email, b.email), isNull(workspaceInvites.acceptedAt)));
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400000);
    const [row] = await db.insert(workspaceInvites).values({ workspaceId, email: b.email, role: b.role, tokenHash: hashToken(token), invitedBy: inviter.id, expiresAt }).returning();
    const link = `${appUrl()}/invite/${token}`;

    const ws = req.workspace!;
    const subject = `${inviter.name} invited you to ${ws.name}`;
    const text = `${inviter.name} invited you to join ${ws.name} as ${ROLE_NAMES[b.role]}.

Open this link to get started (it works for ${INVITE_DAYS} days):
${link}

If you were not expecting this, you can ignore this email.`;
    const html = `<p>${escapeHtml(inviter.name)} invited you to join <b>${escapeHtml(ws.name)}</b> as <b>${ROLE_NAMES[b.role]}</b>.</p><p><a href="${link}" style="display:inline-block;background:#6B2737;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Accept invitation</a></p><p style="color:#666;font-size:13px">The link works for ${INVITE_DAYS} days. If you were not expecting this, you can ignore this email.</p>`;
    let sentFrom: string | null = null;
    // 1) the product's own sending account (SYSTEM_SMTP_URL), 2) otherwise one of this workspace's connected mailboxes.
    if (systemMailConfigured()) {
      try {
        await sendSystemEmail({ to: b.email, subject, text, html });
        sentFrom = "system";
      } catch (e) {
        req.log.error(e, "invite email failed (system account)");
      }
    }
    if (!sentFrom) {
      const mailbox = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.workspaceId, workspaceId), eq(mailboxes.status, "active")) });
      if (mailbox) {
        try {
          const creds = await connectionFor(mailbox);
          const mail = composeEmail({ from: { name: mailbox.fromName || inviter.name, address: mailbox.email }, to: b.email, subject, bodyHtml: html, plainText: false });
          await sendSmtp(creds.server, creds.auth, mail);
          sentFrom = mailbox.email;
        } catch (e) {
          req.log.error(e, "invite email failed (workspace mailbox)");
        }
      }
    }
    if (!sentFrom) req.log.warn(`[invite] no email could be sent for ${b.email}. Link: ${link}`);
    const emailed = !!sentFrom;
    // The link is returned so the inviter can also copy and send it themselves (useful when email is not set up yet).
    return { id: row!.id, email: row!.email, role: row!.role, expiresAt: row!.expiresAt, emailed, sentFrom: sentFrom === "system" ? null : sentFrom, link };
  });

  app.get("/v1/workspaces/:ws/invites", async (req) => {
    requireRole(req, "owner", "admin");
    return db.select({ id: workspaceInvites.id, email: workspaceInvites.email, role: workspaceInvites.role, expiresAt: workspaceInvites.expiresAt, createdAt: workspaceInvites.createdAt })
      .from(workspaceInvites)
      .where(and(eq(workspaceInvites.workspaceId, wsId(req)), isNull(workspaceInvites.acceptedAt), gt(workspaceInvites.expiresAt, new Date())))
      .orderBy(desc(workspaceInvites.createdAt));
  });

  app.delete("/v1/workspaces/:ws/invites/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    await db.delete(workspaceInvites).where(and(eq(workspaceInvites.id, p.id), eq(workspaceInvites.workspaceId, wsId(req))));
    return { ok: true };
  });

  // What the invited person sees before accepting.
  app.get("/v1/invites/:token", async (req) => {
    const { token } = params(req, z.object({ token: z.string().min(10).max(100) }));
    const inv = await findOpenInvite(token);
    const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, inv.workspaceId));
    const inviter = inv.invitedBy ? (await db.select({ name: users.name }).from(users).where(eq(users.id, inv.invitedBy)))[0] : undefined;
    const existing = await db.query.users.findFirst({ where: eq(users.email, inv.email), columns: { id: true, name: true } });
    return { email: inv.email, role: inv.role, roleName: ROLE_NAMES[inv.role], workspaceName: ws?.name ?? "the workspace", inviterName: inviter?.name ?? null, hasAccount: !!existing };
  });

  // Accepting joins the workspace and signs the person in. The link went to their own inbox, which proves the address is theirs.
  app.post("/v1/invites/:token/accept", async (req, reply) => {
    const { token } = params(req, z.object({ token: z.string().min(10).max(100) }));
    const b = body(req, z.object({ name: z.string().trim().min(1).max(100).optional(), password: z.string().min(8).max(200).optional(), confirmPassword: z.string().max(200).optional() }));
    const inv = await findOpenInvite(token);
    let user = await db.query.users.findFirst({ where: eq(users.email, inv.email) });
    if (!user) {
      if (b.password !== b.confirmPassword) throw new HttpError(400, "password_mismatch", "The two passwords do not match.");
      if (!b.name || !b.password) throw new HttpError(400, "details_needed", "Enter your name and choose a password (8 characters or more).");
      [user] = await db.insert(users).values({ name: b.name, email: inv.email, passwordHash: await hashPassword(b.password) }).returning();
    }
    await db.insert(memberships).values({ userId: user!.id, workspaceId: inv.workspaceId, role: inv.role })
      .onConflictDoUpdate({ target: [memberships.userId, memberships.workspaceId], set: { role: inv.role } });
    await db.update(workspaceInvites).set({ acceptedAt: new Date() }).where(eq(workspaceInvites.id, inv.id));
    await createSession(reply, user!.id);
    const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, inv.workspaceId));
    return { ok: true, workspaceSlug: ws?.slug ?? null };
  });
}

async function findOpenInvite(token: string) {
  const [inv] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.tokenHash, hashToken(token)));
  if (!inv || inv.acceptedAt) throw new HttpError(404, "invite_invalid", "This invitation link is not valid any more. Ask for a new one.");
  if (inv.expiresAt.getTime() < Date.now()) throw new HttpError(410, "invite_expired", "This invitation has expired. Ask for a new one.");
  return inv;
}
