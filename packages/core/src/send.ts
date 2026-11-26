import { randomBytes } from "node:crypto";
import {
  contacts, db, events, mailboxes, messages, sequenceContacts, sequences, sequenceSteps, stepVariants, threads,
} from "@outreach/db";
import { alignToWindow, localDayKey, nextEmailStep, pickVariant } from "@outreach/engine";
import { buildQuoteHistory, composeEmail, domainAcceptsMail, render, sendSmtp, type Variables } from "@outreach/mail";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { connectionFor } from "./mailbox";
import type { SendJob } from "./planner";
import { emitEvent } from "./webhooks";

export type SendOutcome = "sent" | "skipped" | "bounced";

export class PermanentSendError extends Error {}

export function trackingToken(): string {
  return randomBytes(16).toString("base64url");
}

export function contactVariables(
  contact: typeof contacts.$inferSelect,
  mailbox: { fromName: string; email: string },
): Variables {
  const senderFirst = mailbox.fromName.split(/\s+/)[0] ?? "";
  return {
    ...contact.variables,
    first_name: contact.firstName,
    last_name: contact.lastName,
    full_name: `${contact.firstName} ${contact.lastName}`.trim(),
    email: contact.email,
    company: contact.companyName,
    company_name: contact.companyName,
    title: contact.title,
    linkedin_url: contact.linkedinUrl,
    sender_name: mailbox.fromName,
    sender_first_name: senderFirst,
    sender_email: mailbox.email,
  };
}

// In a signature, {{first_name}}/{{last_name}} mean the mailbox owner's name, and spintax can vary it per email.
export function renderSignature(mailbox: { signatureHtml: string; fromName: string; email: string }, seed: string): string | undefined {
  if (!mailbox.signatureHtml.trim()) return undefined;
  const [first = "", ...rest] = mailbox.fromName.trim().split(/\s+/);
  const last = rest.join(" ");
  const sig = mailbox.signatureHtml.replace(/^<!--sig:[^>]*-->/, "");
  return render(sig, {
    first_name: first, last_name: last, full_name: mailbox.fromName, sender_first_name: first, sender_last_name: last, sender_name: mailbox.fromName, sender_email: mailbox.email,
  }, { seed, html: true });
}

async function releaseReservation(mailbox: typeof mailboxes.$inferSelect, at: Date) {
  await db.execute(sql`
    update mailbox_daily_stats set sent = greatest(sent - 1, 0)
    where mailbox_id = ${mailbox.id} and day = ${localDayKey(at, mailbox.timezone)}
  `);
}

export async function executeSend(job: SendJob, opts: { trackingBaseUrl: string; now?: Date }): Promise<SendOutcome> {
  const now = opts.now ?? new Date();
  const sc = await db.query.sequenceContacts.findFirst({ where: eq(sequenceContacts.id, job.sequenceContactId) });
  const mailbox = await db.query.mailboxes.findFirst({ where: eq(mailboxes.id, job.mailboxId) });
  if (!sc || !mailbox) return "skipped";

  const sequence = await db.query.sequences.findFirst({ where: eq(sequences.id, sc.sequenceId) });
  if (sc.state !== "sending" || !sequence || sequence.status !== "active" || mailbox.status !== "active") {
    await releaseReservation(mailbox, now);
    if (sc.state === "sending") {
      await db.update(sequenceContacts).set({ state: "active", nextRunAt: now, dueAt: now }).where(eq(sequenceContacts.id, sc.id));
    }
    return "skipped";
  }

  const steps = await db.select().from(sequenceSteps).where(eq(sequenceSteps.sequenceId, sequence.id)).orderBy(asc(sequenceSteps.position));
  // Read from the contact: the steps may have been edited since this send was queued.
  const stepIndex = sc.nextStep ?? job.stepIndex;
  const step = steps[stepIndex];
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, sc.contactId) });
  if (!step || step.type !== "email" || !contact) {
    await releaseReservation(mailbox, now);
    await db.update(sequenceContacts).set({ state: "error", lastError: "step_missing", nextRunAt: null }).where(eq(sequenceContacts.id, sc.id));
    return "skipped";
  }

  const variants = await db.select().from(stepVariants).where(eq(stepVariants.stepId, step.id)).orderBy(asc(stepVariants.label));
  const variant = pickVariant(variants, `${sc.id}:${step.id}`);
  if (!variant) {
    await releaseReservation(mailbox, now);
    await db.update(sequenceContacts).set({ state: "error", lastError: "no_variant", nextRunAt: null }).where(eq(sequenceContacts.id, sc.id));
    return "skipped";
  }

  const settings = sequence.settings;

  if ((settings.bounceShield ?? true) && (contact.validationStatus === "invalid" || !(await domainAcceptsMail(contact.email)))) {
    await releaseReservation(mailbox, now);
    await db.update(sequenceContacts).set({ state: "bounced", nextRunAt: null, lastError: "bounce_shield" }).where(eq(sequenceContacts.id, sc.id));
    await db.insert(events).values({ workspaceId: sequence.workspaceId, type: "bounced", contactId: contact.id, sequenceId: sequence.id, stepId: step.id, mailboxId: mailbox.id, meta: { reason: "bounce_shield", prevented: true } });
    await maybeCompleteSequence(sequence.id);
    return "bounced";
  }
  const vars = contactVariables(contact, mailbox);
  const seed = `${sc.id}:${step.id}`;
  const renderedSubject = render(variant.subject, vars, { seed: `${seed}:s` }).trim();
  const bodyHtml = render(variant.bodyHtml, vars, { seed, html: true });

  // Each email step chooses how it is threaded: "new" starts a new thread, "reply" replies in the existing thread with the same subject,
  // and "reply_new_subject" replies in the existing thread under a new subject. A step with no choice keeps the older rule: an empty
  // subject replies in the thread and anything else starts a new one. The first email always starts a thread.
  let thread = sc.threadId ? await db.query.threads.findFirst({ where: eq(threads.id, sc.threadId) }) : undefined;
  const isFirstEmail = steps.find((s) => s.type === "email")?.id === step.id;
  const mode = isFirstEmail ? "new"
    : step.threadMode === "new" || step.threadMode === "reply" || step.threadMode === "reply_new_subject" ? step.threadMode
      : renderedSubject === "" ? "reply" : "new";
  const continueThread = !!thread && mode !== "new";
  // Replying with the same subject keeps the thread's subject; a new subject is used as written (the thread's own subject if left empty).
  const keepSubject = continueThread && (mode === "reply" || renderedSubject === "");
  let threadHeaders: { inReplyTo: string; references: string[] } | undefined;
  let quote: { html: string; text: string; from: string; sentAt: Date } | undefined;
  const contactRow = await db.query.contacts.findFirst({ where: eq(contacts.id, sc.contactId) });
  const threadNames: Record<string, string> = { [mailbox.email.toLowerCase()]: mailbox.fromName };
  if (contactRow) threadNames[contactRow.email.toLowerCase()] = `${contactRow.firstName} ${contactRow.lastName}`.trim();
  if (continueThread && thread) {
    const prior = await db.select({ mid: messages.messageIdHeader, refs: messages.references, html: messages.bodyHtml, text: messages.bodyText, name: messages.fromName, addr: messages.fromAddress, at: messages.sentAt })
      .from(messages).where(and(eq(messages.threadId, thread.id), eq(messages.direction, "out"))).orderBy(desc(messages.sentAt)).limit(1);
    // The quoted history is rebuilt from every earlier message in the thread (newest first), so it is whole even if an earlier email was
    // sent before quoting existed, and it includes any replies from the contact.
    const all = await db.select({ direction: messages.direction, fromName: messages.fromName, fromAddress: messages.fromAddress, toAddress: messages.toAddress, subject: messages.subject, sentAt: messages.sentAt, bodyHtml: messages.bodyHtml, bodyText: messages.bodyText })
      .from(messages).where(eq(messages.threadId, thread.id));
    if (prior[0]) {
      threadHeaders = { inReplyTo: prior[0].mid, references: [...prior[0].refs, prior[0].mid].slice(-10) };
      quote = buildQuoteHistory(all, { timeZone: mailbox.timezone, names: threadNames }) ?? { html: prior[0].html, text: prior[0].text, from: `${prior[0].name} <${prior[0].addr}>`.trim(), sentAt: prior[0].at };
    }
  }
  // Follow-ups are written with an empty subject so they reply in the contact's thread. A contact with no thread to reply in (they never
  // got the first email) would otherwise receive "(no subject)", so the sequence's first email subject is used instead.
  let openerSubject = "";
  if (!keepSubject && renderedSubject === "") {
    const firstEmail = steps.find((s) => s.type === "email");
    if (firstEmail && firstEmail.id !== step.id) {
      const [v] = await db.select().from(stepVariants).where(eq(stepVariants.stepId, firstEmail.id)).orderBy(asc(stepVariants.label)).limit(1);
      if (v) openerSubject = render(v.subject, vars, { seed: `${seed}:s0` }).trim();
    }
  }
  const subject = keepSubject && thread ? thread.subject : renderedSubject || openerSubject || "(no subject)";

  const token = trackingToken();
  const base = mailbox.trackingDomain && mailbox.trackingDomainVerified ? `https://${mailbox.trackingDomain}` : opts.trackingBaseUrl.replace(/\/$/, "");
  const email = composeEmail({
    from: { name: mailbox.fromName, address: mailbox.email },
    to: contact.email,
    subject,
    bodyHtml,
    attachments: variant.attachments,
    signatureHtml: renderSignature(mailbox, `${seed}:sig`),
    plainText: settings.plainText,
    optOut: settings.optOut.enabled ? { url: `${base}/u/${token}`, text: settings.optOut.text, lead: settings.optOut.lead } : null,
    openPixelUrl: settings.trackOpens ? `${base}/t/o/${token}` : null,
    clickRewrite: settings.trackClicks ? (u) => `${base}/t/c/${token}?u=${encodeURIComponent(u)}` : null,
    thread: threadHeaders,
    quote,
    cc: settings.cc.length ? settings.cc : undefined,
    bcc: settings.bcc.length ? settings.bcc : undefined,
  });

  const creds = await connectionFor(mailbox);
  try {
    const res = await sendSmtp(creds.server, creds.auth, email);
    if (res.rejected.length && !res.accepted.length) throw Object.assign(new Error(`Rejected: ${res.response}`), { responseCode: 550, code: "EENVELOPE" });
  } catch (e) {
    const err = e as Error & { responseCode?: number; code?: string };
    if (err.code === "EAUTH") {
      await db.update(mailboxes).set({ status: "error", statusError: err.message }).where(eq(mailboxes.id, mailbox.id));
      throw new PermanentSendError(`Mailbox auth failed: ${err.message}`);
    }
    if (err.code === "EENVELOPE" && (err.responseCode ?? 0) >= 500) {
      await db.transaction(async (tx) => {
        await tx.update(sequenceContacts).set({ state: "bounced", nextRunAt: null, lastError: err.message }).where(eq(sequenceContacts.id, sc.id));
        await tx.update(contacts).set({ validationStatus: "invalid" }).where(eq(contacts.id, contact.id));
        await tx.insert(events).values({ workspaceId: sequence.workspaceId, type: "bounced", contactId: contact.id, sequenceId: sequence.id, stepId: step.id, mailboxId: mailbox.id, meta: { reason: err.message, at: "smtp" } });
      });
      return "bounced";
    }
    throw err;
  }

  const next = nextEmailStep(steps.map((s) => ({ id: s.id, type: s.type, delayDays: s.delayDays, delayMinutes: s.delayMinutes })), stepIndex, now);
  await db.transaction(async (tx) => {
    if (!continueThread || !thread) {
      [thread] = await tx.insert(threads).values({
        workspaceId: sequence.workspaceId, contactId: contact.id, mailboxId: mailbox.id, sequenceId: sequence.id, subject, lastMessageAt: now,
      }).returning();
    } else {
      await tx.update(threads).set({ lastMessageAt: now }).where(eq(threads.id, thread.id));
    }
    const [msg] = await tx.insert(messages).values({
      workspaceId: sequence.workspaceId,
      threadId: thread!.id,
      mailboxId: mailbox.id,
      contactId: contact.id,
      sequenceId: sequence.id,
      stepId: step.id,
      variantId: variant.id,
      direction: "out",
      messageIdHeader: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references ?? [],
      fromAddress: mailbox.email,
      fromName: mailbox.fromName,
      toAddress: contact.email,
      subject: email.subject,
      bodyHtml: email.html || bodyHtml,
      bodyText: email.text,
      trackingToken: token,
      sentAt: now,
    }).returning({ id: messages.id });
    await tx.insert(events).values({
      workspaceId: sequence.workspaceId, type: "sent", contactId: contact.id, sequenceId: sequence.id, stepId: step.id,
      variantId: variant.id, mailboxId: mailbox.id, messageId: msg!.id, meta: { stepIndex },
    });
    await tx.update(contacts).set({ lastContactedAt: now }).where(eq(contacts.id, contact.id));
    await tx.update(sequenceContacts).set({
      state: next ? "active" : "finished",
      currentStep: stepIndex,
      nextStep: next?.index ?? null,
      nextRunAt: next ? alignToWindow(next.dueAt, sequence.settings.schedule) : null,
      dueAt: next?.dueAt ?? null,
      threadId: thread!.id,
      lastError: null,
    }).where(and(eq(sequenceContacts.id, sc.id), eq(sequenceContacts.state, "sending")));
  });
  emitEvent(sequence.workspaceId, "email.sent", {
    contactEmail: contact.email, contactId: contact.id, sequenceId: sequence.id, sequenceName: sequence.name, step: stepIndex, subject: email.subject, mailbox: mailbox.email,
  });
  await maybeCompleteSequence(sequence.id);
  return "sent";
}

// Called when a send job has used up its retries.
export async function markSendFailed(job: SendJob, error: string, now = new Date()): Promise<void> {
  const mailbox = await db.query.mailboxes.findFirst({ where: eq(mailboxes.id, job.mailboxId) });
  if (mailbox) await releaseReservation(mailbox, now);
  await db.update(sequenceContacts)
    .set({ state: "active", nextRunAt: new Date(now.getTime() + 3600000), lastError: error.slice(0, 500) })
    .where(and(eq(sequenceContacts.id, job.sequenceContactId), eq(sequenceContacts.state, "sending")));
}

export async function maybeCompleteSequence(sequenceId: string): Promise<void> {
  const [row] = await db.select({ open: sql<number>`count(*)::int` }).from(sequenceContacts)
    .where(and(eq(sequenceContacts.sequenceId, sequenceId), inArray(sequenceContacts.state, ["queued", "active", "sending", "ooo"])));
  if (row && row.open === 0) {
    const done = await db.update(sequences).set({ status: "completed" }).where(and(eq(sequences.id, sequenceId), eq(sequences.status, "active")))
      .returning({ workspaceId: sequences.workspaceId, name: sequences.name });
    if (done[0]) emitEvent(done[0].workspaceId, "sequence.completed", { sequenceId, sequenceName: done[0].name });
  }
}
