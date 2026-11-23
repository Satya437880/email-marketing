import { seedWorkspace } from "@outreach/core";
import { db, memberships, organizations, pendingSignups, sessions, users, workspaces } from "@outreach/db";
import { sendSystemEmail, systemMailConfigured } from "@outreach/mail";
import { and, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sendPlatformEmail } from "../accountMail";
import { clearAuthCache, createSession, destroySession, hashPassword, requireUser, SESSION_COOKIE, verifyPassword } from "../auth";
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
  const CODE_TTL_MS = 10 * 60 * 1000;
  const RESEND_GAP_MS = 30 * 1000;
  const MAX_ATTEMPTS = 5;
  const hashCode = (email: string, code: string) => createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}:${email}:${code}`).digest("hex");

  // Emails a fresh 6-digit code for a pending sign-up.
  async function sendCode(email: string, name: string) {
    if (!systemMailConfigured() && process.env.NODE_ENV === "production") {
      throw new HttpError(503, "email_not_configured", "Sign-up email is not set up yet. Ask the admin to set SYSTEM_SMTP_URL.");
    }
    const code = String(randomInt(100000, 1000000));
    const now = new Date();
    await db.update(pendingSignups).set({ codeHash: hashCode(email, code), attempts: 0, expiresAt: new Date(now.getTime() + CODE_TTL_MS), lastSentAt: now }).where(eq(pendingSignups.email, email));
    const first = name.split(" ")[0]?.replace(/[<>&]/g, "") ?? "";
    const result = await sendPlatformEmail({
      to: email,
      subject: `${code} is your verification code`,
      text: `Hi ${first},

Your verification code is ${code}. It expires in 10 minutes.

If you did not try to create an account, ignore this email.`,
      html: `<p>Hi ${first},</p><p>Your verification code is</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not try to create an account, ignore this email.</p>`,
    });
    if (result === "failed") {
      app.log.error(`sign-up code email to ${email} failed`);
      throw new HttpError(502, "email_send_failed", "We could not send the verification email. Check the address and try again.");
    }
    // Nothing to send from at all (no sending account and no connected mailbox yet): local development prints the code in the API log.
    if (result === "none") app.log.warn(`[dev] sign-up code for ${email}: ${code}`);
  }

  // Step 1: validate the details and email a code. No account exists yet.
  app.post("/v1/auth/signup", async (req) => {
    const b = body(req, z.object({
      name: z.string().trim().min(1).max(100),
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200),
      confirmPassword: z.string().max(200),
      company: z.string().trim().min(1).max(100).optional(),
    }).refine((v) => v.password === v.confirmPassword, { message: "The two passwords do not match", path: ["confirmPassword"] }));
    const exists = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (exists) throw new HttpError(409, "email_taken", "An account with this email already exists");
    const prior = await db.query.pendingSignups.findFirst({ where: eq(pendingSignups.email, b.email) });
    if (prior && Date.now() - prior.lastSentAt.getTime() < RESEND_GAP_MS) throw new HttpError(429, "too_soon", "A code was just sent. Wait a few seconds before trying again.");
    const passwordHash = await hashPassword(b.password);
    await db.insert(pendingSignups).values({ email: b.email, name: b.name, company: b.company ?? null, passwordHash, codeHash: "", expiresAt: new Date() })
      .onConflictDoUpdate({ target: pendingSignups.email, set: { name: b.name, company: b.company ?? null, passwordHash } });
    await sendCode(b.email, b.name);
    return { verify: true, email: b.email };
  });

  app.post("/v1/auth/signup/resend", async (req) => {
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email() }));
    const row = await db.query.pendingSignups.findFirst({ where: eq(pendingSignups.email, b.email) });
    if (!row) throw new HttpError(404, "no_signup", "Start sign-up again");
    if (Date.now() - row.lastSentAt.getTime() < RESEND_GAP_MS) throw new HttpError(429, "too_soon", "A code was just sent. Wait a few seconds before asking for another.");
    await sendCode(b.email, row.name);
    return { ok: true };
  });

  // Step 2: the code proves the address is real; only now is the account created.
  app.post("/v1/auth/signup/verify", async (req, reply) => {
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email(), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }));
    const row = await db.query.pendingSignups.findFirst({ where: eq(pendingSignups.email, b.email) });
    if (!row || !row.codeHash) throw new HttpError(400, "no_signup", "Start sign-up again");
    if (row.expiresAt.getTime() < Date.now()) throw new HttpError(400, "code_expired", "This code has expired. Request a new one.");
    if (row.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "too_many_attempts", "Too many wrong codes. Request a new one.");
    const given = Buffer.from(hashCode(b.email, b.code));
    const real = Buffer.from(row.codeHash);
    if (given.length !== real.length || !timingSafeEqual(given, real)) {
      await db.update(pendingSignups).set({ attempts: row.attempts + 1 }).where(eq(pendingSignups.email, b.email));
      throw new HttpError(400, "wrong_code", "That code is not right");
    }
    const taken = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (taken) throw new HttpError(409, "email_taken", "An account with this email already exists");
    const [user] = await db.insert(users).values({ name: row.name, email: row.email, passwordHash: row.passwordHash }).returning();
    await db.delete(pendingSignups).where(eq(pendingSignups.email, b.email));
    const ws = await createWorkspace(user!.id, row.company ?? `${row.name.split(" ")[0]}'s workspace`);
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

  // ---- Forgotten password -------------------------------------------------------------------------------------------------------
  // The reset link carries its own proof: the user, an expiry time and a signature made with SESSION_SECRET and the end of the current
  // password hash. Once the password changes the hash changes, so a used link stops working. No extra table is needed.
  const RESET_TTL_MS = 60 * 60 * 1000;
  // An account that signs in with Google or Microsoft has no password yet; the same link lets its owner set one.
  const resetSig = (userId: string, exp: number, passwordHash: string | null) =>
    createHmac("sha256", process.env.SESSION_SECRET ?? "").update(`reset:${userId}:${exp}:${passwordHash ? passwordHash.slice(-24) : "no-password"}`).digest("base64url");
  const badLink = () => new HttpError(400, "invalid_reset_link", "This reset link is not valid or has expired. Request a new one.");

  // Always answers "ok", so nobody can use it to find out which emails have accounts.
  app.post("/v1/auth/forgot", async (req) => {
    const b = body(req, z.object({ email: z.string().trim().toLowerCase().email() }));
    const user = await db.query.users.findFirst({ where: eq(users.email, b.email) });
    if (user) {
      const exp = Date.now() + RESET_TTL_MS;
      const token = Buffer.from(`${user.id}.${exp}.${resetSig(user.id, exp, user.passwordHash)}`).toString("base64url");
      const base = (process.env.PUBLIC_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
      const link = `${base}/reset-password?token=${token}`;
      const first = user.name.split(" ")[0] || "there";
      const setting = !user.passwordHash;
      const intro = setting
        ? "You asked to set a password for your account (you have been signing in with Google or Microsoft). You can keep using that too."
        : "We got a request to reset your password.";
      const result = await sendPlatformEmail({
        to: user.email,
        subject: setting ? "Set a password for your account" : "Reset your password",
        text: `Hi ${first},\n\n${intro} Open this link to choose a new password (it works for 1 hour and only once):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email. Nothing changes unless you use the link.`,
        html: `<p>Hi ${first},</p><p>${intro} Click the button to choose a new password. The link works for 1 hour and only once.</p><p><a href="${link}" style="display:inline-block;background:#6b2737;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Choose a new password</a></p><p>Or copy this address into your browser:<br>${link}</p><p>If you didn't ask for this, you can ignore this email. Nothing changes unless you use the link.</p>`,
      });
      if (result !== "sent") app.log.warn(`password reset email to ${user.email} was not sent (${result})`);
      // Only when running locally and nothing could send the email: print the link so it can still be tested.
      if (result === "none" && process.env.NODE_ENV !== "production") app.log.warn(`[dev] password reset link for ${user.email}: ${link}`);
    }
    return { ok: true };
  });

  app.post("/v1/auth/reset", async (req) => {
    const b = body(req, z.object({
      token: z.string().min(20).max(600),
      password: z.string().min(8).max(200),
      confirmPassword: z.string().max(200),
    }).refine((v) => v.password === v.confirmPassword, { message: "The two passwords do not match", path: ["confirmPassword"] }));
    const [id, expText, sig] = Buffer.from(b.token, "base64url").toString("utf8").split(".");
    const exp = Number(expText);
    if (!id || !sig || !Number.isFinite(exp) || exp < Date.now()) throw badLink();
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw badLink();
    const real = Buffer.from(resetSig(user.id, exp, user.passwordHash));
    const given = Buffer.from(sig);
    if (given.length !== real.length || !timingSafeEqual(given, real)) throw badLink();
    await db.update(users).set({ passwordHash: await hashPassword(b.password) }).where(eq(users.id, user.id));
    // Everyone signed in with the old password is signed out.
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    clearAuthCache();
    return { ok: true };
  });

  // ---- Change password (signed in) ----------------------------------------------------------------------------------------------
  app.post("/v1/auth/change-password", async (req) => {
    const user = requireUser(req);
    const b = body(req, z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(8).max(200),
      confirmPassword: z.string().max(200),
    }).refine((v) => v.newPassword === v.confirmPassword, { message: "The two new passwords do not match", path: ["confirmPassword"] }));
    if (!user.passwordHash) throw new HttpError(400, "no_password", "This account signs in with Google or Microsoft and has no password yet. Log out and use \"Forgot password?\" on the login page to set one.");
    if (!(await verifyPassword(user.passwordHash, b.currentPassword))) throw new HttpError(400, "wrong_password", "Your current password is not right");
    if (b.newPassword === b.currentPassword) throw new HttpError(400, "same_password", "Choose a password you have not used just now");
    await db.update(users).set({ passwordHash: await hashPassword(b.newPassword) }).where(eq(users.id, user.id));
    // Other devices are signed out; this one stays signed in.
    const current = req.cookies[SESSION_COOKIE];
    await db.delete(sessions).where(current ? and(eq(sessions.userId, user.id), ne(sessions.id, current)) : eq(sessions.userId, user.id));
    clearAuthCache();
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
