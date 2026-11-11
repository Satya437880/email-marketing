import { db, decryptJson, encryptJson, mailboxes } from "@outreach/db";
import { PROVIDER_SERVERS, type MailboxAuth, type ServerConfig } from "@outreach/mail";
import { eq } from "drizzle-orm";
import { envOAuthCreds, refreshAccessToken } from "./oauth";

type PasswordAuth = { type: "password"; user: string; pass: string };
type StoredOAuth = { type: "oauth"; user: string; refreshToken: string; accessToken: string; expiresAt: number };

export interface StoredCredentials {
  auth: PasswordAuth | StoredOAuth;
  server: ServerConfig;
}

export function sealCredentials(c: StoredCredentials): string {
  return encryptJson(c);
}

function open(mailbox: typeof mailboxes.$inferSelect): StoredCredentials {
  const c = decryptJson<StoredCredentials>(mailbox.credentials);
  if (mailbox.provider !== "smtp" && !c.server) c.server = PROVIDER_SERVERS[mailbox.provider];
  return c;
}

const refreshing = new Map<string, Promise<StoredOAuth>>();

// Returns ready-to-use SMTP/IMAP auth, refreshing and saving the OAuth access token when it is near expiry.
export async function connectionFor(mailbox: typeof mailboxes.$inferSelect): Promise<{ server: ServerConfig; auth: MailboxAuth }> {
  const c = open(mailbox);
  if (c.auth.type === "password") return { server: c.server, auth: c.auth };
  let oauth = c.auth;
  if (oauth.expiresAt - Date.now() < 5 * 60000) {
    let pending = refreshing.get(mailbox.id);
    if (!pending) {
      const provider = mailbox.provider === "microsoft" ? "microsoft" : "google";
      pending = (async () => {
        const creds = envOAuthCreds(provider);
        if (!creds) throw new Error("Google/Microsoft sign-in is no longer configured on the server");
        const t = await refreshAccessToken(provider, oauth.refreshToken, creds);
        const next: StoredOAuth = { ...oauth, ...t };
        await db.update(mailboxes).set({ credentials: sealCredentials({ server: c.server, auth: next }) }).where(eq(mailboxes.id, mailbox.id));
        return next;
      })().finally(() => refreshing.delete(mailbox.id));
      refreshing.set(mailbox.id, pending);
    }
    try {
      oauth = await pending;
    } catch (e) {
      await db.update(mailboxes).set({ status: "error", statusError: `Sign-in expired: ${(e as Error).message}. Reconnect this mailbox.` }).where(eq(mailboxes.id, mailbox.id));
      throw e;
    }
  }
  return { server: c.server, auth: { type: "oauth2", user: oauth.user, accessToken: oauth.accessToken } };
}
