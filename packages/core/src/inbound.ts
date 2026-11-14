import { companies, contacts, db, events, mailboxes, messages, sequenceContacts, sequences, threads, workspaces } from "@outreach/db";
import { alignToWindow, localDayKey } from "@outreach/engine";
import { classifyInbound, fetchNewMessages, type FetchedMessage } from "@outreach/mail";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { connectionFor } from "./mailbox";
import { maybeCompleteSequence } from "./send";
import { emitEvent } from "./webhooks";
import { addDnc, labelId } from "./workspace";

type Mailbox = typeof mailboxes.$inferSelect;
const OPEN_STATES = ["queued", "active", "sending", "ooo"] as const;

export async function syncMailbox(mailbox: Mailbox): Promise<{ fetched: number; processed: number }> {
  const creds = await connectionFor(mailbox);
  try {
    const res = await fetchNewMessages(creds.server, creds.auth, { lastUid: mailbox.imapLastUid, uidValidity: mailbox.imapUidValidity });
    let processed = 0;
    for (const m of res.messages) {
      if (await processInbound(mailbox, m)) processed++;
    }
    await db.update(mailboxes).set({
      imapLastUid: res.lastUid, imapUidValidity: res.uidValidity, lastSyncAt: new Date(),
      ...(mailbox.status === "error" ? { status: "active" as const, statusError: null } : {}),
    }).where(eq(mailboxes.id, mailbox.id));
    return { fetched: res.messages.length, processed };
  } catch (e) {
    const err = e as Error & { authenticationFailed?: boolean };
    if (err.authenticationFailed || /auth/i.test(err.message)) {
      await db.update(mailboxes).set({ status: "error", statusError: err.message }).where(eq(mailboxes.id, mailbox.id));
    }
    throw e;
  }
}

async function findThread(workspaceId: string, ids: string[]) {
  if (!ids.length) return undefined;
  const [hit] = await db.select({ threadId: messages.threadId }).from(messages)
    .where(and(eq(messages.workspaceId, workspaceId), inArray(messages.messageIdHeader, ids)))
    .orderBy(desc(messages.sentAt)).limit(1);
  return hit ? db.query.threads.findFirst({ where: eq(threads.id, hit.threadId) }) : undefined;
}

// Returns true when the message was linked to a contact and stored.
export async function processInbound(mailbox: Mailbox, msg: FetchedMessage, now = new Date()): Promise<boolean> {
  const wsId = mailbox.workspaceId;
  if (msg.from === mailbox.email.toLowerCase()) return false;
  if (msg.messageId) {
    const [dupe] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.workspaceId, wsId), eq(messages.messageIdHeader, msg.messageId))).limit(1);
    if (dupe) return false;
  }

  const kind = classifyInbound({ from: msg.from, subject: msg.subject, text: msg.text, headers: msg.headers, receivedAt: msg.date });

  let thread = await findThread(wsId, [msg.inReplyTo, ...msg.references].filter((x): x is string => !!x));
  const lookupEmail = kind.kind === "bounce" ? kind.bouncedRecipient : msg.from;
  let contact = thread?.contactId ? await db.query.contacts.findFirst({ where: eq(contacts.id, thread.contactId) }) : undefined;
  if (!contact && lookupEmail) {
    contact = await db.query.contacts.findFirst({ where: and(eq(contacts.workspaceId, wsId), eq(contacts.email, lookupEmail)) });
  }
  if (!contact) return false;
  if (!thread) {
    thread = await db.query.threads.findFirst({ where: and(eq(threads.workspaceId, wsId), eq(threads.contactId, contact.id)), orderBy: desc(threads.lastMessageAt) });
  }

  const statsMailbox = thread ? await db.query.mailboxes.findFirst({ where: eq(mailboxes.id, thread.mailboxId) }) ?? mailbox : mailbox;
  const bump = async (col: "replies" | "bounced") => {
    await db.execute(sql`
      insert into mailbox_daily_stats (mailbox_id, day, ${sql.identifier(col)}) values (${statsMailbox.id}, ${localDayKey(now, statsMailbox.timezone)}, 1)
      on conflict (mailbox_id, day) do update set ${sql.identifier(col)} = mailbox_daily_stats.${sql.identifier(col)} + 1
    `);
  };

  const openScs = await db.select({ id: sequenceContacts.id, sequenceId: sequenceContacts.sequenceId, settings: sequences.settings })
    .from(sequenceContacts).innerJoin(sequences, eq(sequences.id, sequenceContacts.sequenceId))
    .where(and(eq(sequenceContacts.contactId, contact.id), inArray(sequenceContacts.state, [...OPEN_STATES])));
  const event = (type: "replied" | "bounced" | "opted_out" | "ooo", meta: Record<string, unknown> = {}) =>
    db.insert(events).values({ workspaceId: wsId, type, contactId: contact.id, sequenceId: thread?.sequenceId ?? null, mailboxId: statsMailbox.id, meta });

  if (kind.kind === "bounce") {
    if (kind.bounceType === "hard") {
      await db.update(contacts).set({ validationStatus: "invalid" }).where(eq(contacts.id, contact.id));
      if (openScs.length) {
        await db.update(sequenceContacts).set({ state: "bounced", nextRunAt: null, lastError: "hard_bounce" })
          .where(inArray(sequenceContacts.id, openScs.map((s) => s.id)));
      }
      await event("bounced", { type: "hard" });
      emitEvent(wsId, "contact.bounced", { contactEmail: contact.email, contactId: contact.id, sequenceId: thread?.sequenceId ?? null });
      await bump("bounced");
      for (const s of new Set(openScs.map((x) => x.sequenceId))) await maybeCompleteSequence(s);
    }
    return true;
  }

  const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, wsId) });
  const auto = ws?.autoLabel ?? true;
  let label: string | null = null;

  if (kind.kind === "out_of_office") {
    label = "Out of office";
    for (const s of openScs) {
      const back = new Date((kind.returnDate ?? new Date(now.getTime() + 7 * 86400000)).getTime() + s.settings.oooBufferDays * 86400000);
      // Restarts follow the sequence's own schedule (timezone, active days, per-day hours), the same as normal sends.
      const resume = alignToWindow(back, s.settings.schedule);
      await db.update(sequenceContacts)
        .set(s.settings.oooAutoResume ? { state: "ooo", nextRunAt: resume, dueAt: back } : { state: "replied", nextRunAt: null })
        .where(eq(sequenceContacts.id, s.id));
    }
    await event("ooo", { returnDate: kind.returnDate?.toISOString() ?? null });
  } else if (kind.kind === "auto_reply") {
    label = "Automatic";
  } else {
    if (kind.kind === "unsubscribe") {
      label = "Unsubscribed";
      await addDnc(wsId, "email", contact.email, "reply");
      await db.update(contacts).set({ unsubscribedAt: now }).where(eq(contacts.id, contact.id));
      await event("opted_out", { via: "reply" });
      emitEvent(wsId, "contact.unsubscribed", { contactEmail: contact.email, contactId: contact.id, via: "reply" });
    }
    if (openScs.length) {
      await db.update(sequenceContacts).set({ state: kind.kind === "unsubscribe" ? "opted_out" : "replied", nextRunAt: null })
        .where(inArray(sequenceContacts.id, openScs.map((s) => s.id)));
    }
    if (contact.companyId) await db.update(companies).set({ repliedAt: now }).where(eq(companies.id, contact.companyId));
    await event("replied", { kind: kind.kind });
    emitEvent(wsId, "reply.received", {
      contactEmail: contact.email, contactId: contact.id, contactName: `${contact.firstName} ${contact.lastName}`.trim(), company: contact.companyName,
      subject: msg.subject, snippet: msg.text.replace(/\s+/g, " ").slice(0, 500), sequenceId: thread?.sequenceId ?? null, threadId: thread?.id ?? null,
    });
    await bump("replies");
    for (const s of new Set(openScs.map((x) => x.sequenceId))) await maybeCompleteSequence(s);
  }

  const labelRef = auto && label ? await labelId(wsId, label) : null;
  if (!thread) {
    [thread] = await db.insert(threads).values({ workspaceId: wsId, contactId: contact.id, mailboxId: mailbox.id, subject: msg.subject, lastMessageAt: msg.date }).returning();
  }
  await db.insert(messages).values({
    workspaceId: wsId,
    threadId: thread!.id,
    mailboxId: mailbox.id,
    contactId: contact.id,
    sequenceId: thread!.sequenceId,
    direction: "in",
    messageIdHeader: msg.messageId ?? `<generated-${mailbox.id}-${msg.uid}>`,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
    fromAddress: msg.from,
    fromName: msg.fromName,
    toAddress: msg.to[0] ?? mailbox.email,
    subject: msg.subject,
    bodyHtml: msg.html,
    bodyText: msg.text,
    sentAt: msg.date,
  });
  await db.update(threads).set({
    hasInbound: true,
    unread: true,
    lastMessageAt: msg.date > thread!.lastMessageAt ? msg.date : thread!.lastMessageAt,
    ...(labelRef ? { labelId: labelRef } : {}),
  }).where(eq(threads.id, thread!.id));
  return true;
}
