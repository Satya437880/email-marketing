import { contacts, db, events, messages, sequenceContacts, sequences } from "@outreach/db";
import { and, eq, inArray } from "drizzle-orm";
import { maybeCompleteSequence } from "./send";
import { emitEvent } from "./webhooks";
import { addDnc } from "./workspace";

async function messageByToken(token: string) {
  return db.query.messages.findFirst({ where: eq(messages.trackingToken, token) });
}

// "Pause on open/click": the contact stops receiving this sequence once they engage, so a person can follow up by hand.
async function pauseIfConfigured(msg: NonNullable<Awaited<ReturnType<typeof messageByToken>>>, kind: "open" | "click") {
  if (!msg.sequenceId || !msg.contactId) return;
  const seq = await db.query.sequences.findFirst({ where: eq(sequences.id, msg.sequenceId), columns: { settings: true } });
  const enabled = kind === "open" ? seq?.settings.pauseOnOpen : seq?.settings.pauseOnClick;
  if (!enabled) return;
  await db.update(sequenceContacts).set({ state: "finished", nextRunAt: null, lastError: kind === "open" ? "paused_on_open" : "paused_on_click" })
    .where(and(eq(sequenceContacts.sequenceId, msg.sequenceId), eq(sequenceContacts.contactId, msg.contactId), inArray(sequenceContacts.state, ["queued", "active", "ooo"])));
  await maybeCompleteSequence(msg.sequenceId);
}

export async function recordOpen(token: string): Promise<void> {
  const msg = await messageByToken(token);
  if (!msg) return;
  await db.insert(events).values({
    workspaceId: msg.workspaceId, type: "opened", contactId: msg.contactId, sequenceId: msg.sequenceId, stepId: msg.stepId,
    variantId: msg.variantId, mailboxId: msg.mailboxId, messageId: msg.id,
  });
  await pauseIfConfigured(msg, "open");
}

// Only redirects to links that were actually in the sent email, so the endpoint can't be used as an open redirect.
export async function recordClick(token: string, url: string): Promise<string | null> {
  const msg = await messageByToken(token);
  if (!msg || !/^https?:\/\//i.test(url)) return null;
  const encoded = encodeURIComponent(url).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  if (!msg.bodyHtml.includes(`u=${encoded}`) && !msg.bodyHtml.includes(`u=${encodeURIComponent(url)}`)) return null;
  await db.insert(events).values({
    workspaceId: msg.workspaceId, type: "clicked", contactId: msg.contactId, sequenceId: msg.sequenceId, stepId: msg.stepId,
    variantId: msg.variantId, mailboxId: msg.mailboxId, messageId: msg.id, meta: { url },
  });
  await pauseIfConfigured(msg, "click");
  return url;
}

export async function unsubscribeByToken(token: string): Promise<{ email: string } | null> {
  const msg = await messageByToken(token);
  if (!msg?.contactId) return null;
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, msg.contactId) });
  if (!contact) return null;
  if (!contact.unsubscribedAt) {
    await db.update(contacts).set({ unsubscribedAt: new Date() }).where(eq(contacts.id, contact.id));
    await addDnc(msg.workspaceId, "email", contact.email, "opt_out_link");
    const open = await db.update(sequenceContacts).set({ state: "opted_out", nextRunAt: null })
      .where(and(eq(sequenceContacts.contactId, contact.id), inArray(sequenceContacts.state, ["queued", "active", "sending", "ooo"])))
      .returning({ sequenceId: sequenceContacts.sequenceId });
    await db.insert(events).values({
      workspaceId: msg.workspaceId, type: "opted_out", contactId: contact.id, sequenceId: msg.sequenceId, mailboxId: msg.mailboxId, messageId: msg.id, meta: { via: "link" },
    });
    for (const s of new Set(open.map((o) => o.sequenceId))) await maybeCompleteSequence(s);
    emitEvent(msg.workspaceId, "contact.unsubscribed", { contactEmail: contact.email, contactId: contact.id, via: "link" });
  }
  return { email: contact.email };
}
