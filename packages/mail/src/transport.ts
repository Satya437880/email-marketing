import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { OutgoingEmail } from "./compose";

// Google and Microsoft OAuth mailboxes use the same SMTP/IMAP adapters with XOAUTH2 access tokens.
export type MailboxAuth =
  | { type: "password"; user: string; pass: string }
  | { type: "oauth2"; user: string; accessToken: string };

export interface ServerConfig {
  smtp: { host: string; port: number; secure: boolean };
  imap: { host: string; port: number; secure: boolean };
}

export const PROVIDER_SERVERS: Record<"google" | "microsoft", ServerConfig> = {
  google: { smtp: { host: "smtp.gmail.com", port: 465, secure: true }, imap: { host: "imap.gmail.com", port: 993, secure: true } },
  microsoft: { smtp: { host: "smtp.office365.com", port: 587, secure: false }, imap: { host: "outlook.office365.com", port: 993, secure: true } },
};

function smtpAuth(auth: MailboxAuth) {
  return auth.type === "password" ? { user: auth.user, pass: auth.pass } : { type: "OAuth2" as const, user: auth.user, accessToken: auth.accessToken };
}

function imapAuth(auth: MailboxAuth) {
  return auth.type === "password" ? { user: auth.user, pass: auth.pass } : { user: auth.user, accessToken: auth.accessToken };
}

export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}

export async function sendSmtp(server: ServerConfig, auth: MailboxAuth, email: OutgoingEmail): Promise<SendResult> {
  const transporter = nodemailer.createTransport({ ...server.smtp, auth: smtpAuth(auth), connectionTimeout: 20000, greetingTimeout: 15000 });
  try {
    const info = await transporter.sendMail({
      from: { name: email.from.name, address: email.from.address },
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      subject: email.subject,
      text: email.text,
      html: email.html || undefined,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      references: email.references,
      headers: email.headers,
    });
    return {
      messageId: email.messageId,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
      response: info.response,
    };
  } finally {
    transporter.close();
  }
}

export interface ConnectionTest {
  smtp: { ok: boolean; error?: string };
  imap: { ok: boolean; error?: string };
}

export async function testConnection(server: ServerConfig, auth: MailboxAuth): Promise<ConnectionTest> {
  const result: ConnectionTest = { smtp: { ok: false }, imap: { ok: false } };
  const transporter = nodemailer.createTransport({ ...server.smtp, auth: smtpAuth(auth), connectionTimeout: 15000 });
  try {
    await transporter.verify();
    result.smtp.ok = true;
  } catch (e) {
    result.smtp.error = (e as Error).message;
  } finally {
    transporter.close();
  }
  const client = new ImapFlow({ ...server.imap, auth: imapAuth(auth), logger: false });
  try {
    await client.connect();
    result.imap.ok = true;
  } catch (e) {
    result.imap.error = (e as Error).message;
  } finally {
    await client.logout().catch(() => undefined);
  }
  return result;
}

export interface FetchedMessage {
  uid: number;
  messageId: string | undefined;
  inReplyTo: string | undefined;
  references: string[];
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  date: Date;
  headers: Record<string, string>;
}

// Fetches messages in INBOX with a UID greater than sinceUid and returns the new high-water UID.
// With no cursor yet (or a changed UIDVALIDITY) it only records the current position, so old mail is never imported.
export async function fetchNewMessages(
  server: ServerConfig,
  auth: MailboxAuth,
  cursor: { lastUid: number; uidValidity: string | null },
  limit = 200,
): Promise<{ messages: FetchedMessage[]; lastUid: number; uidValidity: string }> {
  const client = new ImapFlow({ ...server.imap, auth: imapAuth(auth), logger: false });
  await client.connect();
  const messages: FetchedMessage[] = [];
  let sinceUid = cursor.lastUid;
  let lastUid = sinceUid;
  let uidValidity = "";
  const lock = await client.getMailboxLock("INBOX");
  try {
    const mailbox = client.mailbox;
    uidValidity = mailbox ? String(mailbox.uidValidity) : "";
    if (!mailbox) return { messages, lastUid, uidValidity };
    if (cursor.lastUid === 0 || cursor.uidValidity !== uidValidity) {
      return { messages, lastUid: Math.max(0, Number(mailbox.uidNext) - 1), uidValidity };
    }
    sinceUid = cursor.lastUid;
    for await (const msg of client.fetch({ uid: `${sinceUid + 1}:*` }, { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= sinceUid || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const headers: Record<string, string> = {};
      for (const [k, v] of parsed.headers) headers[k] = typeof v === "string" ? v : JSON.stringify(v);
      const fromAddr = parsed.from?.value[0];
      const toList = Array.isArray(parsed.to) ? parsed.to.flatMap((a) => a.value) : (parsed.to?.value ?? []);
      messages.push({
        uid: msg.uid,
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
        from: (fromAddr?.address ?? "").toLowerCase(),
        fromName: fromAddr?.name ?? "",
        to: toList.map((a) => (a.address ?? "").toLowerCase()).filter(Boolean),
        subject: parsed.subject ?? "",
        text: parsed.text ?? "",
        html: typeof parsed.html === "string" ? parsed.html : "",
        date: parsed.date ?? new Date(),
        headers,
      });
      lastUid = Math.max(lastUid, msg.uid);
      if (messages.length >= limit) break;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  return { messages, lastUid, uidValidity };
}
