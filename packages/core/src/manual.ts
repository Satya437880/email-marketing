import { contacts, db, DEFAULT_SEQUENCE_SETTINGS, mailboxes, messages, threads } from "@outreach/db";
import { localDayKey } from "@outreach/engine";
import { composeEmail, render, sendSmtp } from "@outreach/mail";
import { and, eq, inArray, sql } from "drizzle-orm";
import { connectionFor } from "./mailbox";
import { contactVariables, renderSignature, trackingToken } from "./send";
import { dncMatches } from "./workspace";

export const MANUAL_SEND_MAX = 25;

export interface ManualSendInput {
  workspaceId: string;
  mailboxId: string;
  contactIds: string[];
  subject: string;
  bodyHtml: string;
  attachments?: { name: string; type: string; data: string }[];
}

export interface ManualSendResult {
  contactId: string;
  email: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

// One-off emails written by hand (no sequence). Each goes through the same rules as sequence sends that protect
// deliverability: do-not-contact, unsubscribed and invalid addresses are skipped, and the mailbox's daily limit is counted.
export async function sendManualEmails(input: ManualSendInput, opts: { trackingBaseUrl: string }): Promise<ManualSendResult[]> {
  const mailbox = await db.query.mailboxes.findFirst({ where: and(eq(mailboxes.id, input.mailboxId), eq(mailboxes.workspaceId, input.workspaceId)) });
  if (!mailbox) throw new Error("Mailbox not found");
  if (mailbox.status !== "active") throw new Error("This mailbox is not active. Reconnect it first.");

  const rows = await db.select().from(contacts).where(and(eq(contacts.workspaceId, input.workspaceId), inArray(contacts.id, input.contactIds)));
  const blocked = await dncMatches(input.workspaceId, rows.map((r) => r.email));
  const base = mailbox.trackingDomain && mailbox.trackingDomainVerified ? `https://${mailbox.trackingDomain}` : opts.trackingBaseUrl.replace(/\/$/, "");
  const optOut = DEFAULT_SEQUENCE_SETTINGS.optOut;
  const creds = await connectionFor(mailbox);
  const results: ManualSendResult[] = [];

  for (const contact of rows) {
    const res = (status: ManualSendResult["status"], reason?: string) => results.push({ contactId: contact.id, email: contact.email, status, reason });
    if (contact.unsubscribedAt) { res("skipped", "Unsubscribed"); continue; }
    if (blocked.has(contact.email.toLowerCase())) { res("skipped", "On the do-not-contact list"); continue; }
    if (contact.validationStatus === "invalid") { res("skipped", "Invalid email address"); continue; }

    const now = new Date();
    const day = localDayKey(now, mailbox.timezone);
    // Reserve a slot against the daily limit; the update only succeeds while there is room.
    const reserved = await db.execute(sql`
      insert into mailbox_daily_stats (mailbox_id, day, sent) values (${mailbox.id}, ${day}, 1)
      on conflict (mailbox_id, day) do update set sent = mailbox_daily_stats.sent + 1
      where mailbox_daily_stats.sent < ${mailbox.dailyLimit}
      returning sent
    `) as unknown as unknown[];
    if (!reserved.length) { res("skipped", "Daily sending limit reached for this mailbox"); continue; }

    const vars = contactVariables(contact, mailbox);
    const seed = `manual:${contact.id}:${now.getTime()}`;
    const subject = render(input.subject, vars, { seed: `${seed}:s` }).trim() || "(no subject)";
    const bodyHtml = render(input.bodyHtml, vars, { seed, html: true });
    const token = trackingToken();
    try {
      const email = composeEmail({
        from: { name: mailbox.fromName, address: mailbox.email },
        to: contact.email,
        subject,
        bodyHtml,
        attachments: input.attachments,
        signatureHtml: renderSignature(mailbox, `${seed}:sig`),
        plainText: false,
        optOut: optOut.enabled ? { url: `${base}/u/${token}`, text: optOut.text, replyOnly: optOut.replyOnly } : null,
      });
      const sent = await sendSmtp(creds.server, creds.auth, email);
      if (sent.rejected.length && !sent.accepted.length) throw new Error(`Rejected: ${sent.response}`);
      await db.transaction(async (tx) => {
        const [thread] = await tx.insert(threads).values({ workspaceId: input.workspaceId, contactId: contact.id, mailboxId: mailbox.id, subject: email.subject, lastMessageAt: now }).returning({ id: threads.id });
        await tx.insert(messages).values({
          workspaceId: input.workspaceId, threadId: thread!.id, mailboxId: mailbox.id, contactId: contact.id, direction: "out",
          messageIdHeader: email.messageId, references: [], fromAddress: mailbox.email, fromName: mailbox.fromName, toAddress: contact.email,
          subject: email.subject, bodyHtml: email.html || bodyHtml, bodyText: email.text, trackingToken: token, sentAt: now,
        });
        await tx.update(contacts).set({ lastContactedAt: now }).where(eq(contacts.id, contact.id));
      });
      res("sent");
    } catch (e) {
      // Give the reserved slot back: nothing went out.
      await db.execute(sql`update mailbox_daily_stats set sent = greatest(sent - 1, 0) where mailbox_id = ${mailbox.id} and day = ${day}`);
      res("failed", (e as Error).message.slice(0, 200));
    }
  }
  return results;
}
