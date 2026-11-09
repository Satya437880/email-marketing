import { createHmac } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { db, webhooks, type WebhookEvent } from "@outreach/db";
import { and, arrayContains, eq } from "drizzle-orm";

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

// Webhook URLs come from users and are fetched by the server: only public https hosts are allowed.
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use https://");
  if (url.username || url.password) throw new Error("Webhook URLs can't contain a username or password");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Webhook URLs must point to a public server");
  const addrs = isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new Error("That host can't be found");
  if (addrs.some(privateIp)) throw new Error("Webhook URLs must point to a public server");
  return url;
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function slackText(event: WebhookEvent, data: Record<string, unknown>): string {
  const who = String(data.contactEmail ?? "a contact");
  switch (event) {
    case "reply.received": return `:incoming_envelope: New reply from *${who}*${data.subject ? ` — ${data.subject}` : ""}\n>${String(data.snippet ?? "").slice(0, 280)}`;
    case "label.changed": return `:label: Reply from *${who}* labelled *${String(data.label ?? "none")}*`;
    case "contact.bounced": return `:warning: Email to *${who}* bounced`;
    case "contact.unsubscribed": return `:no_entry: *${who}* unsubscribed`;
    case "sequence.completed": return `:checkered_flag: Sequence *${String(data.sequenceName ?? "")}* finished`;
    default: return `${event}: ${who}`;
  }
}

async function deliver(hook: typeof webhooks.$inferSelect, event: WebhookEvent, data: Record<string, unknown>) {
  const body = hook.kind === "slack"
    ? JSON.stringify({ text: slackText(event, data) })
    : JSON.stringify({ event, workspaceId: hook.workspaceId, occurredAt: new Date().toISOString(), data });
  let status: number | null = null;
  let error: string | null = null;
  try {
    const url = await assertPublicHttpsUrl(hook.url);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "MapleMPSS-Webhooks/1.0",
        "x-webhook-event": event,
        ...(hook.kind === "generic" ? { "x-webhook-signature": signPayload(hook.secret, body) } : {}),
      },
      body,
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  await db.update(webhooks).set({ lastStatus: status, lastError: error, lastAt: new Date() }).where(eq(webhooks.id, hook.id));
  return { status, error };
}

// Fire-and-forget: webhook problems are recorded on the webhook and never break sending or syncing.
export function emitEvent(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>): void {
  void (async () => {
    const hooks = await db.select().from(webhooks).where(and(eq(webhooks.workspaceId, workspaceId), arrayContains(webhooks.events, [event])));
    await Promise.all(hooks.map((h) => deliver(h, event, data)));
  })().catch(() => undefined);
}

export async function sendTestEvent(hook: typeof webhooks.$inferSelect) {
  return deliver(hook, "reply.received", {
    test: true, contactEmail: "jordan@example.com", subject: "Re: quick question", snippet: "This is a test event from Maple MPSS. Sounds interesting — can we talk Thursday?",
  });
}
