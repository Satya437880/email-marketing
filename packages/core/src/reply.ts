import { contacts, db, mailboxes, messages, threads } from "@outreach/db";
import { buildQuoteHistory, composeEmail, render, sendSmtp } from "@outreach/mail";
import { and, desc, eq } from "drizzle-orm";
import { connectionFor } from "./mailbox";
import { contactVariables, renderSignature } from "./send";

export interface ReplyInput {
  workspaceId: string;
  threadId: string;
  bodyHtml: string;
  includeHistory: boolean;
  cc?: string[];
  bcc?: string[];
  via?: string;
  // The editor already contains the signature (the person can see and edit it), so none is added on top.
  signatureIncluded?: boolean;
  attachments?: { name: string; type: string; data: string }[];
}

export async function sendReply(input: ReplyInput, now = new Date()) {
  const thread = await db.query.threads.findFirst({ where: and(eq(threads.id, input.threadId), eq(threads.workspaceId, input.workspaceId)) });
  if (!thread) throw new Error("Thread not found");
  const mailbox = await db.query.mailboxes.findFirst({
    where: and(eq(mailboxes.workspaceId, input.workspaceId), eq(mailboxes.id, input.via ?? thread.mailboxId)),
  });
  if (!mailbox) throw new Error("Mailbox not found");

  const [last] = await db.select().from(messages).where(eq(messages.threadId, thread.id)).orderBy(desc(messages.sentAt)).limit(1);
  const [lastInbound] = await db.select().from(messages)
    .where(and(eq(messages.threadId, thread.id), eq(messages.direction, "in"))).orderBy(desc(messages.sentAt)).limit(1);
  const contact = thread.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, thread.contactId) }) : undefined;
  const to = lastInbound?.fromAddress ?? contact?.email;
  if (!to) throw new Error("No recipient for this thread");

  // Variables such as {{first_name}} are filled in for the person receiving the reply.
  let body = contact ? render(input.bodyHtml, contactVariables(contact, mailbox), { seed: `${thread.id}:${now.getTime()}`, html: true }) : input.bodyHtml;
  // The whole conversation, newest first, in the same Outlook style as sequence emails.
  const history = input.includeHistory && last ? buildQuoteHistory(await db.select().from(messages).where(eq(messages.threadId, thread.id)), { timeZone: mailbox.timezone, names: { [mailbox.email.toLowerCase()]: mailbox.fromName, ...(contact ? { [contact.email.toLowerCase()]: `${contact.firstName} ${contact.lastName}`.trim() } : {}) } }) : undefined;

  const email = composeEmail({
    from: { name: mailbox.fromName, address: mailbox.email },
    to,
    subject: thread.subject,
    bodyHtml: body,
    attachments: input.attachments,
    signatureHtml: input.signatureIncluded ? undefined : renderSignature(mailbox, `${thread.id}:${now.getTime()}`),
    plainText: false,
    thread: last ? { inReplyTo: last.messageIdHeader, references: [...last.references, last.messageIdHeader].slice(-10) } : undefined,
    quote: history,
    cc: input.cc,
    bcc: input.bcc,
  });
  const creds = await connectionFor(mailbox);
  await sendSmtp(creds.server, creds.auth, email);

  const [saved] = await db.insert(messages).values({
    workspaceId: input.workspaceId,
    threadId: thread.id,
    mailboxId: mailbox.id,
    contactId: thread.contactId,
    sequenceId: thread.sequenceId,
    direction: "out",
    messageIdHeader: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references ?? [],
    fromAddress: mailbox.email,
    fromName: mailbox.fromName,
    toAddress: to,
    subject: email.subject,
    bodyHtml: email.html,
    bodyText: email.text,
    sentAt: now,
  }).returning();
  await db.update(threads).set({ lastMessageAt: now, unread: false }).where(eq(threads.id, thread.id));
  return saved!;
}
