import { db, decryptJson, encryptJson, oauthApps } from "@outreach/db";
import { and, eq } from "drizzle-orm";
import { envOAuthCreds, redirectUri, type OAuthCreds, type OAuthProvider } from "./oauth";

export interface ResolvedOAuth {
  creds: OAuthCreds;
  source: "workspace" | "server";
}

// A workspace's own credentials win; the server's .env values are the fallback.
export async function getOAuthCreds(workspaceId: string, provider: OAuthProvider): Promise<ResolvedOAuth | null> {
  const [row] = await db.select().from(oauthApps).where(and(eq(oauthApps.workspaceId, workspaceId), eq(oauthApps.provider, provider)));
  if (row) {
    return { source: "workspace", creds: { clientId: row.clientId, clientSecret: decryptJson<{ secret: string }>(row.clientSecret).secret, tenant: row.tenant } };
  }
  const env = envOAuthCreds(provider);
  return env ? { source: "server", creds: env } : null;
}

export async function saveOAuthCreds(workspaceId: string, provider: OAuthProvider, creds: OAuthCreds): Promise<void> {
  const values = { workspaceId, provider, clientId: creds.clientId, clientSecret: encryptJson({ secret: creds.clientSecret }), tenant: creds.tenant || null };
  await db.insert(oauthApps).values(values).onConflictDoUpdate({
    target: [oauthApps.workspaceId, oauthApps.provider],
    set: { clientId: values.clientId, clientSecret: values.clientSecret, tenant: values.tenant },
  });
}

export async function deleteOAuthCreds(workspaceId: string, provider: OAuthProvider): Promise<void> {
  await db.delete(oauthApps).where(and(eq(oauthApps.workspaceId, workspaceId), eq(oauthApps.provider, provider)));
}

export interface OAuthProviderStatus {
  configured: boolean;
  source: "workspace" | "server" | null;
  redirectUri: string;
  // The client ID is not a secret; the secret is never returned.
  clientId: string | null;
  tenant: string | null;
}

export async function oauthStatus(workspaceId: string): Promise<Record<OAuthProvider, OAuthProviderStatus>> {
  const out = {} as Record<OAuthProvider, OAuthProviderStatus>;
  for (const p of ["google", "microsoft"] as const) {
    const r = await getOAuthCreds(workspaceId, p);
    out[p] = { configured: !!r, source: r?.source ?? null, redirectUri: redirectUri(p), clientId: r?.source === "workspace" ? r.creds.clientId : null, tenant: r?.creds.tenant ?? null };
  }
  return out;
}
