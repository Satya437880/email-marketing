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
  attachments?: { filename: string; contentType: string; content: Buffer; cid?: string; contentDisposition?: "inline" | "attachment" }[];
}

export interface ComposeInput {
  from: { name: string; address: string };
  to: string;
  subject: string;
  bodyHtml: string;
  signatureHtml?: string;
  plainText: boolean;
  // text is shown at the bottom of the email as the unsubscribe link itself.
  optOut?: { url: string; mailto?: string; text: string } | null;
  openPixelUrl?: string | null;
  clickRewrite?: ((url: string) => string) | null;
  thread?: { inReplyTo: string; references: string[] };
  // The email being replied to, shown below the new text like a normal reply ("On <date>, <name> wrote:").
  // preformatted: html/text are the finished history (see buildQuoteHistory) and are placed under the new message as they are.
  quote?: { html: string; text: string; from: string; sentAt: Date; preformatted?: boolean };
  cc?: string[];
  bcc?: string[];
  attachments?: { name: string; type: string; data: string }[];
  // Pictures added in the editor are stored as data: URIs. Sending turns them into embedded (cid) images, which inboxes display; the preview keeps them as-is.
  keepDataImages?: boolean;
}

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] ?? "localhost";
  return `<${Date.now().toString(36)}.${randomBytes(9).toString("hex")}@${domain}>`;
}

// A link on this computer (localhost) means nothing to the person who receives the email, so it must never be put in one.
export function isLocalUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "0.0.0.0" || h === "[::1]" || h.endsWith(".local");
  } catch {
    return false;
  }
}

// "On Tue, Nov 17, 2026, 2:18 PM UTC, Name <a@b.com> wrote:"
export function quoteLead(from: string, sentAt: Date): string {
  const when = new Intl.DateTimeFormat("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(sentAt);
  return `On ${when}, ${from} wrote:`;
}

export function composeEmail(input: ComposeInput): OutgoingEmail {
  // Drop trailing empty lines from the body so the signature sits exactly one blank line below it.
  const inline: NonNullable<OutgoingEmail["attachments"]> = [];
  const domain = input.from.address.split("@")[1] ?? "localhost";
  const source = input.keepDataImages ? input.bodyHtml : input.bodyHtml.replace(/src="data:(image\/[\w.+-]+);base64,([^"]+)"/gi, (_m, type: string, data: string) => {
    const cid = `img${inline.length + 1}.${randomBytes(6).toString("hex")}@${domain}`;
    inline.push({ filename: `image${inline.length + 1}.${type.split("/")[1]?.replace("jpeg", "jpg").replace(/\+.*/, "") ?? "png"}`, contentType: type, content: Buffer.from(data, "base64"), cid, contentDisposition: "inline" });
    return `src="cid:${cid}"`;
  });
  let html = source.replace(/(\s|&nbsp;|<br\s*\/?>|<(div|p)>\s*(<br\s*\/?>)?\s*<\/\2>)+$/gi, "");
  // One blank line = one empty block, so the gap is the same whether the text before it ends in a line or a paragraph.
  const gap = `<div style="margin:0;padding:0"><br></div>`;
  const leading = /^(\s|&nbsp;|<br\s*\/?>|<(div|p)>\s*(<br\s*\/?>)?\s*<\/\2>)+/i;
  if (input.signatureHtml?.replace(leading, "").trim()) html += `${gap}${input.signatureHtml.replace(leading, "")}`;

  // With no public web address configured the opt-out cannot be a link; recipients are asked to reply instead (replies saying so are detected).
  const optLocal = !!input.optOut && isLocalUrl(input.optOut.url);
  const optText = input.optOut?.text.trim() || "Opt-out";
  if (input.optOut) {
    // Directly under the signature, no blank line (still one blank line after the body if there is no signature).
    const hasSig = html.endsWith(input.signatureHtml?.replace(leading, "") ?? "\0") && !!input.signatureHtml?.replace(leading, "").trim();
    html += `${hasSig ? "" : gap}<div style="margin:0;padding:0;font-size:10px;line-height:1.3;color:#888">${optLocal ? `${escapeHtml(optText)}: just reply “unsubscribe”.` : `<a href="${escapeHtml(input.optOut.url)}">${escapeHtml(optText)}</a>`}</div>`;
  }

  if (!input.plainText && input.clickRewrite && !isLocalUrl(input.clickRewrite("https://example.com"))) {
    const rewrite = input.clickRewrite;
    const skip = input.optOut?.url;
    html = html.replace(/href="(https?:\/\/[^"]+)"/gi, (whole, url: string) => (url === skip ? whole : `href="${escapeHtml(rewrite(url))}"`));
  }
  if (!input.plainText && input.openPixelUrl && !isLocalUrl(input.openPixelUrl)) {
    html += `<img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" style="display:none">`;
  }

  let text = htmlToText(html);
  if (input.thread && input.quote?.preformatted) {
    html += input.quote.html;
    text += `

${input.quote.text}`;
  } else if (input.thread && input.quote) {
    const q = input.quote;
    // Show only what was written: drop the old opt-out line and tracking pixel, keep any older quoted messages.
    const inner = q.html
      .replace(/^[\s\S]*?line-height:1\.5">/i, "")
      .replace(/<\/div><\/body><\/html>\s*$/i, "")
      .replace(/<div style="margin:0;padding:0;font-size:10px[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<img[^>]*display:none[^>]*>/gi, "")
      .replace(/(<div style="margin:0;padding:0"><br><\/div>\s*)+$/i, "");
    const lead = quoteLead(q.from, q.sentAt);
    html += `${gap}<div style="margin:0;padding:0">${escapeHtml(lead)}</div><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${inner || escapeHtml(q.text)}</blockquote>`;
    text += `\n\n${lead}\n${(inner ? htmlToText(inner) : q.text).trim().split("\n").map((l) => `> ${l}`).join("\n")}`;
  }

  const headers: Record<string, string> = {};
  if (input.optOut) {
    if (optLocal) {
      headers["List-Unsubscribe"] = `<mailto:${input.optOut.mailto ?? input.from.address}?subject=unsubscribe>`;
    } else {
      const targets = [`<${input.optOut.url}>`];
      if (input.optOut.mailto) targets.unshift(`<mailto:${input.optOut.mailto}>`);
      headers["List-Unsubscribe"] = targets.join(", ");
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
  }

  const subject = input.thread && !/^re:/i.test(input.subject) ? `RE: ${input.subject}` : input.subject;

  return {
    from: input.from,
    to: input.to,
    subject,
    html: input.plainText ? "" : wrapHtml(html),
    text,
    messageId: newMessageId(input.from.address),
    inReplyTo: input.thread?.inReplyTo,
    references: input.thread?.references,
    cc: input.cc,
    bcc: input.bcc,
    headers,
    attachments: input.attachments?.length || inline.length ? [...(input.attachments ?? []).map((a) => ({ filename: a.name, contentType: a.type, content: Buffer.from(a.data, "base64") })), ...inline] : undefined,
  };
}

function wrapHtml(body: string): string {
  return `<!doctype html><html><body><div style="font-family:Calibri,Candara,Arial,sans-serif;font-size:10.5pt;line-height:1.5">${body}</div></body></html>`;
}
