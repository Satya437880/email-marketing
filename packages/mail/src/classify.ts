// Rule-based classification of inbound mail, applied before any AI labelling.

export type InboundKind = "bounce" | "out_of_office" | "unsubscribe" | "auto_reply" | "reply";

export interface InboundSignals {
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  receivedAt?: Date;
}

export interface Classification {
  kind: InboundKind;
  bounceType?: "hard" | "soft";
  bouncedRecipient?: string;
  returnDate?: Date;
}

const BOUNCE_SENDERS = /^(mailer-daemon|postmaster|mail-daemon)@/i;
const BOUNCE_SUBJECTS = /(undeliverable|delivery status notification|delivery has failed|mail delivery failed|returned mail|failure notice|delivery failure|could not be delivered)/i;
const HARD_BOUNCE = /(5\.1\.[0-9]|550|551|553|user unknown|no such user|does not exist|address rejected|recipient not found|mailbox unavailable|invalid recipient)/i;
const OOO_SUBJECTS = /(out of (the )?office|ooo\b|automatic reply|auto(matic)?[- ]?reply|autoreply|on vacation|on leave|away from (the )?office|abwesenheit|absence)/i;
const OOO_BODY = /(out of (the )?office|on (annual |parental |maternity |paternity )?leave|on vacation|on holiday|away until|back (in the office )?on|return(ing)? on|limited access to (my )?email)/i;
const UNSUB_BODY = /^\s*(unsubscribe|remove me|stop|opt[- ]?out|take me off)/i;
const UNSUB_ANY = /(please (remove|unsubscribe) me|remove me from (your|this) (list|mailing)|stop (emailing|contacting|sending)|do not (contact|email) me|don'?t (contact|email) me|not interested,? (please )?remove)/i;

function header(h: Record<string, string>, name: string): string {
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  return key ? String(h[key]) : "";
}

export function classifyInbound(msg: InboundSignals): Classification {
  const ct = header(msg.headers, "content-type");
  if (BOUNCE_SENDERS.test(msg.from) || /report-type=delivery-status/i.test(ct) || BOUNCE_SUBJECTS.test(msg.subject)) {
    const recipient = msg.text.match(/(?:final-recipient|original-recipient):\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i)?.[1]
      ?? msg.text.match(/<([^\s<>]+@[^\s<>]+)>/)?.[1];
    return { kind: "bounce", bounceType: HARD_BOUNCE.test(msg.text) ? "hard" : "soft", bouncedRecipient: recipient?.toLowerCase() };
  }

  const autoSubmitted = header(msg.headers, "auto-submitted");
  const isAuto = (autoSubmitted && autoSubmitted.toLowerCase() !== "no") || header(msg.headers, "x-autoreply") !== "" || /^(auto_reply|bulk)$/i.test(header(msg.headers, "precedence"));
  if (OOO_SUBJECTS.test(msg.subject) || (isAuto && OOO_BODY.test(msg.text))) {
    return { kind: "out_of_office", returnDate: extractReturnDate(msg.text, msg.receivedAt ?? new Date()) };
  }
  if (isAuto) return { kind: "auto_reply" };

  const firstLines = msg.text.split(/\n\s*\n|\n>|\nOn .+wrote:/)[0] ?? msg.text;
  if (UNSUB_BODY.test(firstLines) || UNSUB_ANY.test(firstLines)) return { kind: "unsubscribe" };

  return { kind: "reply" };
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export function extractReturnDate(text: string, now: Date): Date | undefined {
  const window = text.slice(0, 1500);
  const cue = /(until|back|return(ing)?|through|till|from)\b[^.\n]{0,40}/gi;
  const candidates: Date[] = [];
  for (const m of window.matchAll(cue)) {
    const d = parseLooseDate(m[0], now);
    if (d) candidates.push(d);
  }
  if (!candidates.length) {
    const d = parseLooseDate(window, now);
    if (d) candidates.push(d);
  }
  const future = candidates.filter((d) => d.getTime() > now.getTime() - 86400000);
  return future.sort((a, b) => b.getTime() - a.getTime())[0];
}

function parseLooseDate(s: string, now: Date): Date | undefined {
  const year = now.getUTCFullYear();
  const build = (y: number, mo: number, d: number) => {
    let date = new Date(Date.UTC(y, mo, d, 9));
    if (Number.isNaN(date.getTime()) || date.getUTCDate() !== d) return undefined;
    if (date.getTime() < now.getTime() - 86400000 * 30 && y === year) date = new Date(Date.UTC(y + 1, mo, d, 9));
    return date;
  };
  const iso = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dm = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?,?\s*(20\d{2})?/i);
  if (dm) {
    const mo = MONTHS[(dm[2] ?? "").slice(0, 4).toLowerCase()] ?? MONTHS[(dm[2] ?? "").slice(0, 3).toLowerCase()];
    if (mo !== undefined) return build(dm[3] ? Number(dm[3]) : year, mo, Number(dm[1]));
  }
  const md = s.match(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(20\d{2})?/i);
  if (md) {
    const mo = MONTHS[(md[1] ?? "").slice(0, 4).toLowerCase()] ?? MONTHS[(md[1] ?? "").slice(0, 3).toLowerCase()];
    if (mo !== undefined) return build(md[3] ? Number(md[3]) : year, mo, Number(md[2]));
  }
  const slash = s.match(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : year;
    // Ambiguous d/m vs m/d: prefer the reading that is a valid date.
    return a > 12 ? build(y, b - 1, a) : build(y, a - 1, b);
  }
  return undefined;
}
