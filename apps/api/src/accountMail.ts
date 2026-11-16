import { connectionFor } from "@outreach/core";
import { db, mailboxes } from "@outreach/db";
import { composeEmail, sendSmtp, sendSystemEmail, systemMailConfigured } from "@outreach/mail";
import { asc, eq } from "drizzle-orm";

export interface AccountEmail { to: string; subject: string; text: string; html: string }

// For people who have no account yet (sign-up codes). Uses the product's own sending account when SYSTEM_SMTP_URL is set; otherwise, on a
// local or single-team install (not production), the oldest active mailbox, so codes still arrive without extra setup.
// "none" means there is nothing to send from at all.
export async function sendPlatformEmail(mail: AccountEmail): Promise<"sent" | "failed" | "none"> {
  if (systemMailConfigured()) {
    try {
      await sendSystemEmail(mail);
      return "sent";
    } catch {
      return "failed";
    }
  }
  if (process.env.NODE_ENV === "production") return "none";
  const mailbox = await db.query.mailboxes.findFirst({ where: eq(mailboxes.status, "active"), orderBy: asc(mailboxes.createdAt) });
  if (!mailbox) return "none";
  try {
    const creds = await connectionFor(mailbox);
    const email = composeEmail({ from: { name: mailbox.fromName || "Account security", address: mailbox.email }, to: mail.to, subject: mail.subject, bodyHtml: mail.html, plainText: false });
    await sendSmtp(creds.server, creds.auth, email);
    return "sent";
  } catch {
    return "failed";
  }
}
