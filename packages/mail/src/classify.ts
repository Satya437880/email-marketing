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
const UNSUB_BODY = /^\s*(unsubscribe|remove me|stop(?=\s*([.!,]|$))|opt[- ]?out|take me off)/i;
const GREETING = /^\s*(hi|hello|hey|dear)\b[^\n,.!:]{0,40}[,.!:]?[ \t]*\n+/i;
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

  // Only the person's own words: the quoted email below them carries our opt-out line.
  const own = replyOwnText(msg.text.replace(/\r\n/g, "\n"));
  if (UNSUB_BODY.test(own.replace(GREETING, "")) || UNSUB_ANY.test(own)) return { kind: "unsubscribe" };

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

// What a genuine reply is about, judged from its own words (the quoted history below it is ignored). Returns the matching Primebox
// label, or null when it is not clear, so a person can label it. Meeting completed and Closed depend on what happens after the reply,
// so they are always set by hand.
export type ReplyLabel = "Positive" | "Meeting booked" | "Negative" | "Wrong contact" | "Not at this time";

const WRONG_CONTACT = /(wrong (person|contact|email|address)|not the (right|correct) (person|contact|one)|no longer (with|at|works?|employed)|left (the company|the organi[sz]ation|my (job|company))|(don'?t|do not) work (here|there) (any ?more|any longer)|you (may|might|should) (want to )?(contact|reach|speak|talk)|please (contact|reach out to|speak (to|with)|direct (this|your))|forward(ed)? (this|your (email|message)) to)/i;
const NEGATIVE = /(not interested|no,? thanks?|no,? thank you|not a (good )?fit|not for us|not (something )?we('re| are| would be) (looking|interested)|we('re| are) (all set|good|covered|happy with)|already (have|use|work with|using)|(don'?t|do not) need|not looking|we'?ll pass|i'?ll pass|pass on this)/i;
const NOT_NOW = /(not (right )?now|not at this time|bad timing|maybe later|check back|circle back|get back to you|reach out (again )?(in|next|after|later)|(next|following) (quarter|year|month)|in (a few|a couple of|some) (months|weeks)|after (the )?(holidays?|summer|new year|q[1-4])|busy (right now|at the moment|at present)|no budget|budget (is|has been|isn'?t) (frozen|tight|approved))/i;
const MEETING_WORD = /(call|meeting|demo|chat|slot|time|calendar|invite)/i;
const MEETING_BOOKED = /(\bbooked\b|\bscheduled\b|\bconfirmed\b|calendar invite|invite (sent|accepted)|accepted (your|the) invite|calendly\.com|cal\.com|see you (on|at|then)|looking forward to (speaking|talking|meeting|our (call|meeting|chat)))/i;
const POSITIVE = /(\binterested\b|sounds (good|great|interesting|like)|\blove to\b|happy to (chat|talk|connect|jump|schedule|meet|learn)|let'?s (chat|talk|connect|schedule|set up|book|do)|send (me )?(more|over|some)? ?(info|details|information|pricing|a deck|the deck)|tell me more|can you (share|send|tell)|please call|call me|free (on|this|next|tomorrow)|available (on|this|next|tomorrow)|^\s*(yes|sure|ok(ay)?)\b)/im;

// Only what the person wrote: everything from the quoted older email onwards ("On ... wrote:", "From: ... Sent: ...", "> " lines,
// "-----Original Message-----", signatures sent from a phone) is cut off.
export function replyOwnText(text: string): string {
  const cut = text.search(/\r?\n[ \t]*>|\r?\n[ \t]*On .{0,200}wrote:|\r?\n[ \t]*-{2,}[ \t]*(original|forwarded) message|\r?\n[ \t]*From:[ \t]|\r?\n[ \t]*_{5,}|\r?\n[ \t]*Sent from my |\r?\n[ \t]*Get Outlook for /i);
  let own = cut >= 0 ? text.slice(0, cut) : text;
  // Some mail apps put the quote on the same line as the reply.
  const inline = own.search(/\s(From:\s.{0,120}<[^>]+@[^>]+>|On [A-Z][a-z]{2},? .{0,160}wrote:)/);
  if (inline >= 0) own = own.slice(0, inline);
  return own.trim();
}

export function classifyReplyIntent(text: string): ReplyLabel | null {
  const own = replyOwnText(text).slice(0, 1500);
  if (!own.trim()) return null;
  if (WRONG_CONTACT.test(own)) return "Wrong contact";
  if (NEGATIVE.test(own)) return "Negative";
  if (NOT_NOW.test(own)) return "Not at this time";
  if (MEETING_BOOKED.test(own) && MEETING_WORD.test(own)) return "Meeting booked";
  if (POSITIVE.test(own)) return "Positive";
  return null;
}
