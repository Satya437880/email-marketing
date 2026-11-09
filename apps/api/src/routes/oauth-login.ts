import { envOAuthCreds, exchangeLoginCode, loginAuthorizationUrl, signState, verifyState, type OAuthProvider } from "@outreach/core";
import { db, users } from "@outreach/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSession } from "../auth";
import { resolveOAuthLogin } from "../oauth-login";

const LOGIN_COOKIE = "oauth_login";
const COOKIE_PATH = "/v1/auth/oauth";
const providerSchema = z.enum(["google", "microsoft"]);

const envNames: Record<OAuthProvider, string> = {
  google: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
  microsoft: "MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET",
};
const label = (p: OAuthProvider) => (p === "google" ? "Google" : "Microsoft");

// "Login with Google / Microsoft" on the login page. These are plain browser navigations, not fetch calls.
export async function oauthLoginRoutes(app: FastifyInstance) {
  // The login page only shows a button for a provider that is configured, so every button works.
  app.get("/v1/auth/providers", async () => ({ google: !!envOAuthCreds("google"), microsoft: !!envOAuthCreds("microsoft") }));

  app.get("/v1/auth/oauth/:provider/start", async (req, reply) => {
    const parsed = providerSchema.safeParse((req.params as { provider: string }).provider);
    const fail = (m: string) => reply.redirect(`/login?error=${encodeURIComponent(m)}`, 302);
    if (!parsed.success) return fail("Unknown login provider.");
    const provider = parsed.data;
    const creds = envOAuthCreds(provider);
    if (!creds) return fail(`${label(provider)} login isn't configured. Add ${envNames[provider]} to the server's .env file, then restart the API.`);

    const state = signState({ purpose: "login", ws: "", userId: "", provider, timezone: "UTC" });
    // Ties this attempt to this browser, so a callback link can't be used to log someone else in.
    reply.setCookie(LOGIN_COOKIE, verifyState(state)!.n, {
      path: COOKIE_PATH, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600,
    });
    return reply.redirect(loginAuthorizationUrl(provider, state, creds), 302);
  });

  app.get("/v1/auth/oauth/:provider/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const fail = (m: string) => reply.redirect(`/login?error=${encodeURIComponent(m.slice(0, 240))}`, 302);
    const cookieNonce = req.cookies[LOGIN_COOKIE];
    reply.clearCookie(LOGIN_COOKIE, { path: COOKIE_PATH });

    const parsed = providerSchema.safeParse((req.params as { provider: string }).provider);
    const state = q.state ? verifyState(q.state) : null;
    if (!parsed.success || !state || state.purpose !== "login" || state.provider !== parsed.data || !cookieNonce || cookieNonce !== state.n) {
      return fail("This login link expired or was opened in a different browser. Please try again.");
    }
    const provider = parsed.data;
    if (q.error) return fail(q.error === "access_denied" ? "Login was cancelled." : q.error_description ?? q.error);
    if (!q.code) return fail("The provider didn't return a login code. Please try again.");
    const creds = envOAuthCreds(provider);
    if (!creds) return fail(`${label(provider)} login isn't configured. Add ${envNames[provider]} to the server's .env file.`);

    let resolution;
    try {
      resolution = await resolveOAuthLogin(await exchangeLoginCode(provider, q.code, creds));
    } catch (e) {
      req.log.warn(e);
      return fail((e as Error).message);
    }
    if (!resolution.ok) return fail(resolution.message);

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, resolution.userId));
    await createSession(reply, resolution.userId);
    return reply.redirect("/", 302);
  });
}
