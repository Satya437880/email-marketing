import {
  authorizationUrl, connectionFor, describeOAuthFailure, envOAuthCreds, exchangeCode, sealCredentials, signState, verifyState,
  type OAuthProvider, type StoredCredentials,
} from "@outreach/core";
import { db, decryptJson, domains, mailboxes, mailboxDailyStats, senderProfileMailboxes, senderProfiles, sequenceSenders } from "@outreach/db";
import { promises as dns } from "node:dns";
import { localDayKey } from "@outreach/engine";
import { checkDomainDns, PROVIDER_SERVERS, testConnection, type ServerConfig } from "@outreach/mail";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { parse as parseCsv } from "csv-parse/sync";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, wsId } from "../auth";
import { body, HttpError, idParams, notFound, params } from "../http";

const serverSchema = z.object({ host: z.string().trim().min(1), port: z.coerce.number().int().min(1).max(65535), secure: z.boolean() });

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fromName: z.string().trim().min(1).max(100),
  provider: z.enum(["google", "microsoft", "smtp"]),
  username: z.string().trim().optional(),
  password: z.string().min(1),
  smtp: serverSchema.optional(),
  imap: serverSchema.optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500).default(50),
  timezone: z.string().optional(),
});

const updateSchema = z.object({
  fromName: z.string().trim().min(1).max(100).optional(),
  dailyLimit: z.coerce.number().int().min(1).max(500).optional(),
  minGapSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  maxGapSeconds: z.coerce.number().int().min(30).max(7200).optional(),
  timezone: z.string().optional(),
  signatureHtml: z.string().max(20000).optional(),
  status: z.enum(["active", "paused"]).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  trackingDomain: z.string().trim().toLowerCase().regex(/^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, "Enter a domain like track.yourdomain.com").nullable().optional(),
});

export function trackingCnameTarget(): string {
  if (process.env.TRACKING_CNAME_TARGET) return process.env.TRACKING_CNAME_TARGET;
  try { return new URL(process.env.TRACKING_BASE_URL ?? "http://localhost:4000").hostname; } catch { return "localhost"; }
}

type MailboxRow = typeof mailboxes.$inferSelect;

export function publicMailbox(m: MailboxRow, stats: { today: number; yesterday: number }) {
  const { credentials: _secret, imapLastUid: _u, imapUidValidity: _v, ...rest } = m;
  return { ...rest, sentToday: stats.today, sentYesterday: stats.yesterday };
}

export async function mailboxStats(list: MailboxRow[], now = new Date()) {
  const out = new Map<string, { today: number; yesterday: number }>();
  if (!list.length) return out;
  const rows = await db.select().from(mailboxDailyStats).where(and(
    inArray(mailboxDailyStats.mailboxId, list.map((m) => m.id)),
    sql`${mailboxDailyStats.day} >= current_date - 2`,
  ));
  for (const m of list) {
    const today = localDayKey(now, m.timezone);
    const yesterday = localDayKey(new Date(now.getTime() - 86400000), m.timezone);
    out.set(m.id, {
      today: rows.find((r) => r.mailboxId === m.id && r.day === today)?.sent ?? 0,
      yesterday: rows.find((r) => r.mailboxId === m.id && r.day === yesterday)?.sent ?? 0,
    });
  }
  return out;
}

function credentialsFrom(b: z.infer<typeof createSchema>): { auth: { type: "password"; user: string; pass: string }; server: ServerConfig } {
  const server = b.provider === "smtp"
    ? (() => {
      if (!b.smtp || !b.imap) throw new HttpError(400, "server_required", "SMTP and IMAP server details are required");
      return { smtp: b.smtp, imap: b.imap };
    })()
    : PROVIDER_SERVERS[b.provider];
  // Pasted app passwords often carry spaces (Google shows them in groups of four) and addresses stray capitals; neither belongs in the login.
  const pass = b.provider === "google" ? b.password.replace(/\s+/g, "") : b.password;
  return { auth: { type: "password", user: (b.username || b.email).trim(), pass }, server };
}

async function ensureDomain(workspaceId: string, email: string) {
  const name = email.split("@")[1]!;
  const [row] = await db.insert(domains).values({ workspaceId, name }).onConflictDoUpdate({ target: [domains.workspaceId, domains.name], set: { name } }).returning();
  return row!;
}

const oauthProvider = z.enum(["google", "microsoft"]);
const providerName = (p: OAuthProvider) => (p === "google" ? "Google" : "Microsoft");
const ENV_NAMES: Record<OAuthProvider, string> = {
  google: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
  microsoft: "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET",
};

export async function mailboxRoutes(app: FastifyInstance) {
  // One click: a plain browser navigation that sends the user straight to Google's or Microsoft's login page.
  // Problems come back to the Mailboxes page as a message instead of a blank error screen.
  app.get("/v1/workspaces/:ws/mailboxes/oauth/:provider/start", async (req, reply) => {
    const wsSlug = req.workspace!.slug;
    const fail = (m: string) => reply.redirect(`/${wsSlug}/senders?${new URLSearchParams({ oauth_error: m })}`, 302);
    if (!["owner", "admin", "member"].includes(req.role ?? "")) return fail("You don't have permission to connect mailboxes.");
    const parsed = oauthProvider.safeParse((req.params as { provider: string }).provider);
    if (!parsed.success) return fail("Unknown email provider.");
    const provider = parsed.data;

    const creds = envOAuthCreds(provider);
    if (!creds) {
      req.log.error(`${providerName(provider)} connection was requested but the server has no credentials. Set ${ENV_NAMES[provider]} in .env and restart the API.`);
      return fail(`${providerName(provider)} connection isn't available right now. Please contact support.`);
    }
    const q = req.query as { timezone?: string; hint?: string };
    const hint = q.hint && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.hint) ? q.hint : undefined;
    const state = signState({ purpose: "mailbox", ws: wsSlug, userId: req.user!.id, provider, timezone: req.workspace?.timezone || "UTC" });
    return reply.redirect(authorizationUrl(provider, state, creds, hint), 302);
  });

  // The provider redirects the browser here. Always answer with a redirect back into the app so the outcome is visible.
  app.get("/v1/oauth/:provider/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const back = (ws: string | null, params: Record<string, string>) =>
      reply.redirect(`${ws ? `/${ws}/senders` : "/"}?${new URLSearchParams(params)}`, 302);
    const state = q.state ? verifyState(q.state) : null;
    if (!state || state.purpose !== "mailbox") return back(null, { oauth_error: "This connection link expired. Please try again." });

    const parsed = oauthProvider.safeParse((req.params as { provider: string }).provider);
    if (!parsed.success || parsed.data !== state.provider) return back(state.ws, { oauth_error: "This connection link expired. Please try again." });
    const provider = parsed.data;
    const name = providerName(provider);

    if (q.error) {
      req.log.warn({ error: q.error, description: q.error_description }, "provider returned an error");
      return back(state.ws, { oauth_error: q.error === "access_denied" ? "You cancelled the connection. No changes were made." : `${name} couldn't complete the sign-in (${q.error}). Please try again.` });
    }
    if (!req.user || req.user.id !== state.userId) return back(state.ws, { oauth_error: "Please log in to the app as the same user and try again." });
    const workspace = await db.query.workspaces.findFirst({ where: (w, { eq: e }) => e(w.slug, state.ws) });
    if (!workspace || !q.code) return back(state.ws, { oauth_error: `${name} didn't return a sign-in code. Please try again.` });

    try {
      const creds = envOAuthCreds(provider);
      if (!creds) {
        req.log.error(`${name} callback arrived but the server has no credentials. Set ${ENV_NAMES[provider]} in .env.`);
        return back(state.ws, { oauth_error: `${name} connection isn't available right now. Please contact support.` });
      }
      const tokens = await exchangeCode(provider, q.code, creds);
      const server = PROVIDER_SERVERS[provider];
      const test = await testConnection(server, { type: "oauth2", user: tokens.email, accessToken: tokens.accessToken });
      if (!test.smtp.ok || !test.imap.ok) {
        req.log.warn({ email: tokens.email, smtp: test.smtp.error, imap: test.imap.error }, "mailbox refused the connection after sign-in");
        const hint = provider === "google"
          ? "If this is a Google Workspace account, ask your administrator to turn on IMAP and allow this app."
          : "Ask your Microsoft 365 administrator to enable Authenticated SMTP for this mailbox.";
        // The server's own reason for each part, so the real cause is visible (these are error texts, never tokens).
        const detail = [test.smtp.ok ? null : `Sending (SMTP): ${test.smtp.error}`, test.imap.ok ? null : `Reading replies (IMAP): ${test.imap.error}`].filter(Boolean).join(" ");
        return back(state.ws, { oauth_error: `You signed in as ${tokens.email}, but ${name} didn't allow mail access. ${hint} ${detail}`.slice(0, 900) });
      }
      // Tokens are stored encrypted; the refresh token keeps the connection alive without asking the user again.
      const credentials = sealCredentials({
        server,
        auth: { type: "oauth", user: tokens.email, refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt },
      });
      const domain = await ensureDomain(workspace.id, tokens.email);
      // Reconnecting an existing mailbox refreshes its credentials and clears any error.
      await db.insert(mailboxes).values({
        workspaceId: workspace.id, domainId: domain.id, email: tokens.email, fromName: tokens.name, provider,
        credentials, dailyLimit: 30, timezone: state.timezone,
      }).onConflictDoUpdate({
        target: [mailboxes.workspaceId, mailboxes.email],
        set: { credentials, provider, status: "active", statusError: null },
      });
      return back(state.ws, { connected: tokens.email });
    } catch (e) {
      const { message, ownerProblem } = describeOAuthFailure(provider, (e as Error).message);
      if (ownerProblem) req.log.error(e, `${name} OAuth app is misconfigured (check the client ID, secret and redirect URI)`);
      else req.log.warn(e);
      return back(state.ws, { oauth_error: message });
    }
  });

  app.get("/v1/workspaces/:ws/mailboxes", async (req) => {
    const list = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, wsId(req))).orderBy(asc(mailboxes.email));
    const stats = await mailboxStats(list);
    const domainRows = await db.select().from(domains).where(eq(domains.workspaceId, wsId(req)));
    return list.map((m) => ({ ...publicMailbox(m, stats.get(m.id)!), domain: domainRows.find((d) => d.id === m.domainId) ?? null }));
  });

  app.post("/v1/workspaces/:ws/mailboxes/test", async (req) => {
    const b = body(req, createSchema);
    const c = credentialsFrom(b);
    return testConnection(c.server, c.auth);
  });

  app.post("/v1/workspaces/:ws/mailboxes", async (req) => {
    requireRole(req, "owner", "admin", "member");
    const b = body(req, createSchema);
    const c = credentialsFrom(b);
    const test = await testConnection(c.server, c.auth);
    if (!test.smtp.ok || !test.imap.ok) {
      throw new HttpError(400, "connection_failed", "Could not connect to this mailbox", test);
    }
    const domain = await ensureDomain(wsId(req), b.email);
    const [row] = await db.insert(mailboxes).values({
      workspaceId: wsId(req), domainId: domain.id, email: b.email, fromName: b.fromName, provider: b.provider,
      credentials: sealCredentials(c), dailyLimit: b.dailyLimit, timezone: req.workspace?.timezone ?? "UTC",
    }).onConflictDoNothing().returning();
    if (!row) throw new HttpError(409, "mailbox_exists", "This mailbox is already connected");
    return publicMailbox(row, { today: 0, yesterday: 0 });
  });

  // Bulk IMAP/SMTP connect: every row is tested; working rows are saved, failures are reported back.
  app.post("/v1/workspaces/:ws/mailboxes/bulk", async (req) => {
    requireRole(req, "owner", "admin", "member");
    const b = body(req, z.object({ csv: z.string().min(1).max(2_000_000), timezone: z.string().optional() }));
    const workspaceId = wsId(req);
    const records = parseCsv(b.csv, { columns: (h: string[]) => h.map((x) => x.trim().toLowerCase().replace(/[\s-]+/g, "_")), skip_empty_lines: true, bom: true, relax_column_count: true, trim: true }) as Record<string, string>[];
    if (!records.length) throw new HttpError(400, "empty_csv", "The CSV has no rows");
    if (records.length > 200) throw new HttpError(400, "too_many_rows", "Upload at most 200 mailboxes at a time");
    const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v === "" ? dflt : /^(true|yes|1|ssl|tls)$/i.test(v));

    const results: { row: number; email: string; ok: boolean; error?: string }[] = [];
    const queue = records.map((r, i) => ({ r, row: i + 2 }));
    await Promise.all(Array.from({ length: 5 }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const { r, row } = item;
        const parsed = createSchema.safeParse({
          email: r.email, fromName: r.from_name || r.name || (r.email ?? "").split("@")[0], provider: "smtp",
          username: r.username || undefined, password: r.password,
          smtp: { host: r.smtp_host, port: r.smtp_port || 465, secure: bool(r.smtp_secure, (r.smtp_port || "465") === "465") },
          imap: { host: r.imap_host, port: r.imap_port || 993, secure: bool(r.imap_secure, true) },
          dailyLimit: r.daily_limit || 30, timezone: r.timezone || b.timezone || req.workspace?.timezone || "UTC",
        });
        if (!parsed.success) {
          const f = parsed.error.flatten().fieldErrors;
          results.push({ row, email: r.email ?? "", ok: false, error: `Missing or invalid: ${Object.keys(f).join(", ")}` });
          continue;
        }
        const c = credentialsFrom(parsed.data);
        const test = await testConnection(c.server, c.auth);
        if (!test.smtp.ok || !test.imap.ok) {
          results.push({ row, email: parsed.data.email, ok: false, error: [test.smtp.error && `SMTP: ${test.smtp.error}`, test.imap.error && `IMAP: ${test.imap.error}`].filter(Boolean).join(" | ") });
          continue;
        }
        const domain = await ensureDomain(workspaceId, parsed.data.email);
        const [saved] = await db.insert(mailboxes).values({
          workspaceId, domainId: domain.id, email: parsed.data.email, fromName: parsed.data.fromName, provider: "smtp",
          credentials: sealCredentials(c), dailyLimit: parsed.data.dailyLimit, timezone: parsed.data.timezone ?? req.workspace?.timezone ?? "UTC",
        }).onConflictDoNothing().returning({ id: mailboxes.id });
        results.push(saved ? { row, email: parsed.data.email, ok: true } : { row, email: parsed.data.email, ok: false, error: "Already connected" });
      }
    }));
    results.sort((a, z2) => a.row - z2.row);
    return { connected: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  });

  app.patch("/v1/workspaces/:ws/mailboxes/:id", async (req) => {
    const p = params(req, idParams);
    const b = body(req, updateSchema);
    const current = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))) });
    if (!current) notFound("Mailbox");
    // A changed tracking domain must be verified again before links use it.
    const domainChanged = b.trackingDomain !== undefined && b.trackingDomain !== current.trackingDomain;
    const [row] = await db.update(mailboxes).set({ ...b, ...(domainChanged ? { trackingDomainVerified: false } : {}) })
      .where(eq(mailboxes.id, current.id)).returning();
    return publicMailbox(row!, (await mailboxStats([row!])).get(row!.id)!);
  });

  app.get("/v1/workspaces/:ws/tracking-target", async () => ({ type: "CNAME", value: trackingCnameTarget() }));

  app.post("/v1/workspaces/:ws/mailboxes/:id/tracking-domain/check", async (req) => {
    const p = params(req, idParams);
    const m = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))) });
    if (!m) notFound("Mailbox");
    if (!m.trackingDomain) throw new HttpError(400, "no_domain", "Enter a tracking domain first");
    const target = trackingCnameTarget().toLowerCase();
    const found = await dns.resolveCname(m.trackingDomain).catch(() => [] as string[]);
    const verified = found.some((c) => c.toLowerCase().replace(/\.$/, "") === target);
    await db.update(mailboxes).set({ trackingDomainVerified: verified }).where(eq(mailboxes.id, m.id));
    return { verified, found, expected: target };
  });

  // Provider settings never include the password; leaving it blank keeps the saved one.
  app.get("/v1/workspaces/:ws/mailboxes/:id/provider", async (req) => {
    const p = params(req, idParams);
    const m = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))) });
    if (!m) notFound("Mailbox");
    const c = decryptJson<StoredCredentials>(m.credentials);
    const server = c.server ?? PROVIDER_SERVERS[m.provider as "google" | "microsoft"];
    return { authType: c.auth.type, username: c.auth.user, smtp: server.smtp, imap: server.imap };
  });

  app.patch("/v1/workspaces/:ws/mailboxes/:id/provider", async (req) => {
    requireRole(req, "owner", "admin", "member");
    const p = params(req, idParams);
    const b = body(req, z.object({ username: z.string().trim().min(1).max(320), password: z.string().max(500).optional(), smtp: serverSchema, imap: serverSchema }));
    const m = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))) });
    if (!m) notFound("Mailbox");
    const c = decryptJson<StoredCredentials>(m.credentials);
    if (c.auth.type !== "password") throw new HttpError(400, "oauth_mailbox", "This mailbox uses Google/Microsoft sign-in. Reconnect it instead of editing server settings.");
    const next = { auth: { type: "password" as const, user: b.username, pass: b.password || c.auth.pass }, server: { smtp: b.smtp, imap: b.imap } };
    const test = await testConnection(next.server, next.auth);
    if (!test.smtp.ok || !test.imap.ok) throw new HttpError(400, "connection_failed", "Couldn't connect with these settings. Nothing was changed.", test);
    await db.update(mailboxes).set({ credentials: sealCredentials(next), status: m.status === "paused" ? "paused" : "active", statusError: null }).where(eq(mailboxes.id, m.id));
    return { ok: true, connection: test };
  });

  app.post("/v1/workspaces/:ws/mailboxes/:id/check", async (req) => {
    const p = params(req, idParams);
    const m = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))) });
    if (!m) notFound("Mailbox");
    const c = await connectionFor(m);
    const test = await testConnection(c.server, c.auth);
    const ok = test.smtp.ok && test.imap.ok;
    const err = [test.smtp.error && `SMTP: ${test.smtp.error}`, test.imap.error && `IMAP: ${test.imap.error}`].filter(Boolean).join(" | ") || null;
    await db.update(mailboxes).set(ok ? { status: m.status === "paused" ? "paused" : "active", statusError: null } : { status: "error", statusError: err }).where(eq(mailboxes.id, m.id));
    if (m.domainId) {
      const domain = await db.query.domains.findFirst({ where: eq(domains.id, m.domainId) });
      if (domain) {
        const dns = await checkDomainDns(domain.name);
        await db.update(domains).set({ spfOk: dns.spf, dkimOk: dns.dkim, dmarcOk: dns.dmarc, mxOk: dns.mx, checkedAt: new Date() }).where(eq(domains.id, domain.id));
        return { connection: test, dns };
      }
    }
    return { connection: test, dns: null };
  });

  app.delete("/v1/workspaces/:ws/mailboxes/:id", async (req) => {
    requireRole(req, "owner", "admin");
    const p = params(req, idParams);
    await db.delete(mailboxes).where(and(eq(mailboxes.id, p.id), eq(mailboxes.workspaceId, wsId(req))));
    return { ok: true };
  });

  // Rotations (called sender profiles in the code)
  app.get("/v1/workspaces/:ws/sender-profiles", async (req) => {
    const profiles = await db.select().from(senderProfiles)
      .where(and(eq(senderProfiles.workspaceId, wsId(req)), isNull(senderProfiles.ownerSequenceId))).orderBy(asc(senderProfiles.name));
    const links = profiles.length
      ? await db.select({ profileId: senderProfileMailboxes.senderProfileId, mailbox: mailboxes }).from(senderProfileMailboxes)
        .innerJoin(mailboxes, eq(mailboxes.id, senderProfileMailboxes.mailboxId))
        .where(inArray(senderProfileMailboxes.senderProfileId, profiles.map((p) => p.id)))
      : [];
    const stats = await mailboxStats([...new Map(links.map((l) => [l.mailbox.id, l.mailbox])).values()]);
    return profiles.map((p) => {
      const mbs = links.filter((l) => l.profileId === p.id).map((l) => l.mailbox);
      return {
        ...p,
        mailboxes: mbs.map((m) => ({ id: m.id, email: m.email, status: m.status })),
        dailyCap: mbs.reduce((s, m) => s + m.dailyLimit, 0),
        sentToday: mbs.reduce((s, m) => s + (stats.get(m.id)?.today ?? 0), 0),
      };
    });
  });

  const profileSchema = z.object({
    name: z.string().trim().min(1).max(100),
    signatureHtml: z.string().max(20000).default(""),
    mailboxIds: z.array(z.string().uuid()).default([]),
  });

  async function setProfileMailboxes(workspaceId: string, profileId: string, mailboxIds: string[]) {
    const owned = mailboxIds.length
      ? await db.select({ id: mailboxes.id }).from(mailboxes).where(and(eq(mailboxes.workspaceId, workspaceId), inArray(mailboxes.id, mailboxIds)))
      : [];
    await db.delete(senderProfileMailboxes).where(eq(senderProfileMailboxes.senderProfileId, profileId));
    if (owned.length) await db.insert(senderProfileMailboxes).values(owned.map((m) => ({ senderProfileId: profileId, mailboxId: m.id })));
  }

  app.post("/v1/workspaces/:ws/sender-profiles", async (req) => {
    const b = body(req, profileSchema);
    const [row] = await db.insert(senderProfiles).values({ workspaceId: wsId(req), name: b.name, signatureHtml: b.signatureHtml }).returning();
    await setProfileMailboxes(wsId(req), row!.id, b.mailboxIds);
    return row;
  });

  app.patch("/v1/workspaces/:ws/sender-profiles/:id", async (req) => {
    const p = params(req, idParams);
    const b = body(req, profileSchema.partial());
    const [row] = await db.update(senderProfiles).set({ name: b.name, signatureHtml: b.signatureHtml })
      .where(and(eq(senderProfiles.id, p.id), eq(senderProfiles.workspaceId, wsId(req)))).returning();
    if (!row) notFound("Rotation");
    if (b.mailboxIds) await setProfileMailboxes(wsId(req), row.id, b.mailboxIds);
    return row;
  });

  app.delete("/v1/workspaces/:ws/sender-profiles/:id", async (req) => {
    const p = params(req, idParams);
    const [inUse] = await db.select({ n: sql<number>`count(*)::int` }).from(sequenceSenders).where(eq(sequenceSenders.senderProfileId, p.id));
    if (inUse && inUse.n > 0) throw new HttpError(409, "in_use", "This rotation is used by a sequence");
    await db.delete(senderProfiles).where(and(eq(senderProfiles.id, p.id), eq(senderProfiles.workspaceId, wsId(req))));
    return { ok: true };
  });
}
