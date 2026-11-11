import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthProvider = "google" | "microsoft";

// The OAuth app (client) a workspace signs in through. Comes from the workspace's own settings, or the server's .env.
export interface OAuthCreds {
  clientId: string;
  clientSecret: string;
  tenant?: string | null;
}

export function envOAuthCreds(provider: OAuthProvider): OAuthCreds | null {
  const id = provider === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID;
  const secret = provider === "google" ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret, tenant: provider === "microsoft" ? process.env.MICROSOFT_TENANT || null : null };
}

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams: Record<string, string>;
}

function config(provider: OAuthProvider, creds: OAuthCreds): ProviderConfig {
  if (provider === "google") {
    return {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      // Full mail scope is what Gmail requires for IMAP and SMTP over XOAUTH2.
      scopes: ["openid", "email", "profile", "https://mail.google.com/"],
      // select_account shows Google's "Choose an account" page every time.
      extraAuthParams: { access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true" },
    };
  }
  const tenant = encodeURIComponent(creds.tenant || "common");
  return {
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: ["openid", "email", "profile", "offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"],
    extraAuthParams: { prompt: "select_account", response_mode: "query" },
  };
}

export function redirectUri(provider: OAuthProvider): string {
  const base = (process.env.PUBLIC_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  return `${base}/v1/oauth/${provider}/callback`;
}

export interface OAuthState {
  // A state signed for one purpose is rejected by the other flow.
  purpose: "mailbox" | "login";
  ws: string;
  userId: string;
  provider: OAuthProvider;
  timezone: string;
  exp: number;
  n: string;
}

function stateKey(): string {
  const k = process.env.SESSION_SECRET;
  if (!k) throw new Error("SESSION_SECRET must be set");
  return k;
}

// The state parameter is signed so a callback can only complete a flow this server started for this user.
export function signState(s: Omit<OAuthState, "exp" | "n">): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + 10 * 60000, n: randomBytes(8).toString("hex") })).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string): OAuthState | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  return s.exp > Date.now() ? s : null;
}

// loginHint preselects an account on the provider's page (used when reconnecting a known mailbox).
export function authorizationUrl(provider: OAuthProvider, state: string, creds: OAuthCreds, loginHint?: string): string {
  const c = config(provider, creds);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: c.scopes.join(" "),
    state,
    ...c.extraAuthParams,
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `${c.authUrl}?${params}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function tokenRequest(provider: OAuthProvider, creds: OAuthCreds, params: Record<string, string>) {
  const c = config(provider, creds);
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, ...params }),
  });
  const data = (await res.json()) as Record<string, string | number>;
  if (!res.ok) throw new Error(`${provider} token error: ${data.error ?? res.status}${data.error_description ? ` (${data.error_description})` : ""}`);
  return data;
}

function decodeIdToken(idToken: string): Record<string, unknown> {
  const part = idToken.split(".")[1];
  return part ? JSON.parse(Buffer.from(part, "base64url").toString("utf8")) : {};
}

export async function exchangeCode(provider: OAuthProvider, code: string, creds: OAuthCreds): Promise<TokenSet & { email: string; name: string }> {
  const data = await tokenRequest(provider, creds, { grant_type: "authorization_code", code, redirect_uri: redirectUri(provider) });
  if (!data.refresh_token) throw new Error("No refresh token returned. Remove the app's access from the account and try again.");
  const claims = data.id_token ? decodeIdToken(String(data.id_token)) : {};
  const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? "").toLowerCase();
  if (!email) throw new Error("Could not read the mailbox address from the sign-in");
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    email,
    name: typeof claims.name === "string" && claims.name ? claims.name : email.split("@")[0] ?? email,
  };
}

export async function refreshAccessToken(provider: OAuthProvider, refreshToken: string, creds: OAuthCreds): Promise<TokenSet> {
  const data = await tokenRequest(provider, creds, { grant_type: "refresh_token", refresh_token: refreshToken });
  return {
    accessToken: String(data.access_token),
    // Microsoft rotates refresh tokens; Google usually doesn't return a new one.
    refreshToken: data.refresh_token ? String(data.refresh_token) : refreshToken,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
  };
}

// ---- Logging in to the app itself with Google / Microsoft (identity only; no mailbox access is requested) ----

export function loginRedirectUri(provider: OAuthProvider): string {
  const base = (process.env.PUBLIC_URL ?? process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  return `${base}/v1/auth/oauth/${provider}/callback`;
}

export function loginAuthorizationUrl(provider: OAuthProvider, state: string, creds: OAuthCreds): string {
  const c = config(provider, creds);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: loginRedirectUri(provider),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    ...(provider === "microsoft" ? { response_mode: "query" } : {}),
  });
  return `${c.authUrl}?${params}`;
}

export interface LoginProfile {
  provider: OAuthProvider;
  sub: string;
  email: string;
  // Only Google asserts that it verified the address; Microsoft's email claim is not proof of ownership.
  emailVerified: boolean;
  name: string;
}

// The token comes straight from the provider's token endpoint over TLS, so its signature isn't re-checked;
// the audience, issuer and expiry still are.
export function profileFromIdToken(provider: OAuthProvider, claims: Record<string, unknown>, clientId: string, now = Date.now()): LoginProfile {
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  const issuerOk = provider === "google"
    ? iss === "https://accounts.google.com" || iss === "accounts.google.com"
    : iss.startsWith("https://login.microsoftonline.com/");
  if (!issuerOk) throw new Error("The sign-in came from an unexpected issuer");
  if (claims.aud !== clientId) throw new Error("The sign-in was issued for a different app");
  if (!(Number(claims.exp) * 1000 > now)) throw new Error("The sign-in has expired. Please try again.");
  const email = String(claims.email ?? claims.preferred_username ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Couldn't read an email address from the sign-in");
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!sub) throw new Error("The sign-in didn't include an account ID");
  return {
    provider,
    sub,
    email,
    emailVerified: provider === "google" && (claims.email_verified === true || claims.email_verified === "true"),
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email.split("@")[0]!,
  };
}

export async function exchangeLoginCode(provider: OAuthProvider, code: string, creds: OAuthCreds): Promise<LoginProfile> {
  const data = await tokenRequest(provider, creds, { grant_type: "authorization_code", code, redirect_uri: loginRedirectUri(provider) });
  if (!data.id_token) throw new Error("The provider didn't return an identity token");
  return profileFromIdToken(provider, decodeIdToken(String(data.id_token)), creds.clientId);
}

// What a person sees when a sign-in or mailbox connection fails. The technical text is for the server log only.
// ownerProblem means the app's own Google/Microsoft registration is wrong, which only the server owner can fix.
export function describeOAuthFailure(provider: OAuthProvider, raw: string): { message: string; ownerProblem: boolean } {
  const name = provider === "google" ? "Google" : "Microsoft";
  if (/invalid_client|unauthorized_client|invalid client|OAuth client was not found|redirect_uri_mismatch|AADSTS7000215|AADSTS700016|AADSTS50011|AADSTS70011/i.test(raw)) {
    return { message: `${name} connection isn't set up correctly. Please contact support.`, ownerProblem: true };
  }
  if (/invalid_grant|expired|AADSTS70008|AADSTS54005/i.test(raw)) return { message: "That sign-in expired or was already used. Please try again.", ownerProblem: false };
  if (/refresh token/i.test(raw)) {
    return { message: `${name} didn't allow ongoing access. Remove this app from your ${name} account's connected apps, then try again.`, ownerProblem: false };
  }
  return { message: `We couldn't connect your ${name} account. Please try again.`, ownerProblem: false };
}
