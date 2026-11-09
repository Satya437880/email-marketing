import { randomBytes } from "node:crypto";
import { escapeHtml, htmlToText } from "./render";

export interface OutgoingEmail {
  from: { name: string; address: string };
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  cc?: string[];
  bcc?: string[];
  headers: Record<string, string>;
}

export interface ComposeInput {
  from: { name: string; address: string };
  to: string;
  subject: string;
  bodyHtml: string;
  signatureHtml?: string;
  plainText: boolean;
  optOut?: { url: string; mailto?: string; text: string } | null;
  openPixelUrl?: string | null;
  clickRewrite?: ((url: string) => string) | null;
  thread?: { inReplyTo: string; references: string[] };
  cc?: string[];
  bcc?: string[];
}

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] ?? "localhost";
  return `<${Date.now().toString(36)}.${randomBytes(9).toString("hex")}@${domain}>`;
}

export function composeEmail(input: ComposeInput): OutgoingEmail {
  let html = input.bodyHtml;
  if (input.signatureHtml) html += `<br><br>${input.signatureHtml}`;

  if (input.optOut) {
    html += `<br><br><span style="font-size:12px;color:#888">${escapeHtml(input.optOut.text)} <a href="${escapeHtml(input.optOut.url)}">here</a>.</span>`;
  }

  if (!input.plainText && input.clickRewrite) {
    const rewrite = input.clickRewrite;
    const skip = input.optOut?.url;
    html = html.replace(/href="(https?:\/\/[^"]+)"/gi, (whole, url: string) => (url === skip ? whole : `href="${escapeHtml(rewrite(url))}"`));
  }
  if (!input.plainText && input.openPixelUrl) {
    html += `<img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" style="display:none">`;
  }

  const headers: Record<string, string> = {};
  if (input.optOut) {
    const targets = [`<${input.optOut.url}>`];
    if (input.optOut.mailto) targets.unshift(`<mailto:${input.optOut.mailto}>`);
    headers["List-Unsubscribe"] = targets.join(", ");
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const subject = input.thread && !/^re:/i.test(input.subject) ? `Re: ${input.subject}` : input.subject;

  return {
    from: input.from,
    to: input.to,
    subject,
    html: input.plainText ? "" : wrapHtml(html),
    text: htmlToText(html),
    messageId: newMessageId(input.from.address),
    inReplyTo: input.thread?.inReplyTo,
    references: input.thread?.references,
    cc: input.cc,
    bcc: input.bcc,
    headers,
  };
}

function wrapHtml(body: string): string {
  return `<!doctype html><html><body><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${body}</div></body></html>`;
}
