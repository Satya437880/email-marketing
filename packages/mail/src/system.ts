import nodemailer from "nodemailer";

// Product emails (sign-up codes). Uses its own SMTP account, set with SYSTEM_SMTP_URL, e.g. smtps://user:app-password@smtp.gmail.com:465
export function systemMailConfigured(): boolean {
  return !!process.env.SYSTEM_SMTP_URL;
}

export async function sendSystemEmail(input: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const url = process.env.SYSTEM_SMTP_URL;
  if (!url) throw new Error("System email is not configured");
  const transporter = nodemailer.createTransport(url, { connectionTimeout: 15000, greetingTimeout: 10000 });
  try {
    await transporter.sendMail({ from: process.env.SYSTEM_MAIL_FROM || decodeURIComponent(new URL(url).username), to: input.to, subject: input.subject, html: input.html, text: input.text });
  } finally {
    transporter.close();
  }
}
