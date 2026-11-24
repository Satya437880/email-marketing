import { escapeHtml, htmlToText } from "./render";

// The whole conversation, quoted the way Outlook does it: the newest message is written first, then every earlier message as its own
// block (a thin line, then From / Sent / To / Subject, then what it said), newest to oldest (6, 5, 4, 3, 2, 1).
// It is rebuilt from every message in the thread, so a gap in an earlier email's own saved copy (for example one sent before
// quoting existed) cannot cut the history short, and replies from the contact are included too.

export interface HistoryMessage {
  direction: "in" | "out";
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  sentAt: Date;
  bodyHtml: string;
  bodyText: string;
}

// Quoted text is kept tight like Outlook's: no empty lines at the end (they show as a big gap above the next line), at most one in a row
// inside, and paragraphs without their own top/bottom space.
const EMPTY_BLOCK = String.raw`<(?:div|p|span)\b[^>]*>(?:\s|&nbsp;|<br\s*/?>)*</(?:div|p|span)>`;
const TAIL_EMPTY = new RegExp(String.raw`(?:\s|&nbsp;|<br\s*/?>|${EMPTY_BLOCK})+$`, "i");
const RUN_EMPTY = new RegExp(String.raw`(?:${EMPTY_BLOCK}|<br\s*/?>\s*){2,}`, "gi");
function tidy(html: string): string {
  const flat = html.replace(/<p(\s[^>]*)?>/gi, (_m, a: string | undefined) => (a && /style="/i.test(a) ? `<p${a.replace(/style="/i, 'style="margin:0;')}>` : `<p${a ?? ""} style="margin:0">`));
  return flat.replace(TAIL_EMPTY, "").replace(RUN_EMPTY, '<div style="margin:0;padding:0"><br></div>').trim();
}

// Only what this message itself said: no wrapper, no opt-out line, no tracking pixel, and none of the history it quoted.
function ownHtml(m: HistoryMessage): string {
  if (m.direction === "out" && m.bodyHtml) {
    let h = m.bodyHtml.replace(/^[\s\S]*?line-height:1\.5">/i, "").replace(/<\/div><\/body><\/html>\s*$/i, "");
    // History added by this app, in either of its styles (Outlook-style block or the older "wrote:" quote), is cut off.
    const cut = [h.search(/<hr data-quote/i), h.search(/<div style="margin:0;padding:0">On [^<]*wrote:<\/div>\s*<blockquote/i)].filter((i) => i >= 0);
    if (cut.length) h = h.slice(0, Math.min(...cut));
    return tidy(h
      .replace(/<div style="margin:0;padding:0;font-size:10px[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<img[^>]*display:none[^>]*>/gi, ""));
  }
  // Mail from the contact: use the plain text, up to where their own mail app started quoting.
  const lines = m.bodyText.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((l) => /^\s*(On .{5,200}wrote:\s*$|From:\s.+|-{2,}\s*Original Message\s*-{2,}|_{5,}|>)/i.test(l));
  const own = (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
  return escapeHtml(own).replace(/\n/g, "<br>");
}

// "18 November 2026 10:39 AM", in the sender's time zone.
export function formatSent(d: Date, timeZone = "UTC"): string {
  const parts = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  let p: Intl.DateTimeFormatPart[];
  try { p = parts(timeZone); } catch { p = parts("UTC"); }
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${v.day} ${v.month} ${v.year} ${v.hour}:${v.minute} ${String(v.dayPeriod).toUpperCase()}`;
}

const reSubject = (s: string) => (s.trim() ? (/^re:/i.test(s.trim()) ? s.trim().replace(/^re:\s*/i, "RE: ") : s.trim()) : "");

const FONT = "font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.25";

// `messages` are every earlier message in the thread, in any order. The result is passed to composeEmail as `quote` and is placed
// under the new message exactly as it is (preformatted).
export function buildQuoteHistory(messages: HistoryMessage[], opts: { timeZone?: string; names?: Record<string, string> } = {}): { html: string; text: string; from: string; sentAt: Date; preformatted: true } | undefined {
  if (!messages.length) return undefined;
  const newestFirst = [...messages].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const htmlBlocks: string[] = [];
  const textBlocks: string[] = [];
  for (const m of newestFirst) {
    // Like Outlook: "Name <address>", and when there is no name, 'address' <address>.
    const nameOf = (addr: string, own?: string) => own || opts.names?.[addr.toLowerCase()] || "";
    const label = (name: string, addr: string) => ({
      text: name && name !== addr ? `${name} <${addr}>` : `'${addr}' <${addr}>`,
      html: `${name && name !== addr ? escapeHtml(name) : `'<a href="mailto:${escapeHtml(addr)}">${escapeHtml(addr)}</a>'`} &lt;<a href="mailto:${escapeHtml(addr)}">${escapeHtml(addr)}</a>&gt;`,
    });
    // Our own emails show just the sender's name (as in Outlook); a reply from the contact shows name and address.
    const fromName = nameOf(m.fromAddress, m.fromName);
    const who = m.direction === "out" && fromName ? { text: fromName, html: escapeHtml(fromName) } : label(fromName, m.fromAddress);
    const to = m.toAddress ? label(nameOf(m.toAddress), m.toAddress) : undefined;
    const sent = formatSent(m.sentAt, opts.timeZone);
    const subject = reSubject(m.subject);
    const body = ownHtml(m);
    htmlBlocks.push(
      `<hr data-quote style="border:0;border-top:1px solid #e1e1e1;margin:2px 0 4px 0;height:0;line-height:0;font-size:0">`
      + `<div style="${FONT}"><b>From:</b> ${who.html}<br><b>Sent:</b> ${escapeHtml(sent)}`
      + (to ? `<br><b>To:</b> ${to.html}` : "")
      + (subject ? `<br><b>Subject:</b> ${escapeHtml(subject)}` : "")
      + `</div><div style="margin:8px 0 0 0">${body}</div>`,
    );
    textBlocks.push(`________________________________\nFrom: ${who.text}\nSent: ${sent}\n${to ? `To: ${to.text}\n` : ""}${subject ? `Subject: ${subject}\n` : ""}\n${htmlToText(body).trim()}`);
  }
  const latest = newestFirst[0]!;
  return { html: htmlBlocks.join(""), text: textBlocks.join("\n\n"), from: latest.fromName || latest.fromAddress, sentAt: latest.sentAt, preformatted: true };
}
