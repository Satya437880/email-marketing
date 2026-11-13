import { htmlToText } from "./render";

export interface SpamIssue {
  code: string;
  message: string;
  penalty: number;
}

export interface SpamReport {
  score: number;
  rating: "good" | "fair" | "poor";
  wordCount: number;
  issues: SpamIssue[];
  metrics: SpamMetrics;
}

// Raw counts behind the score, for the spam-potential panel.
export interface SpamMetrics {
  spamWords: number;
  personalisationPct: number; // spintax + variables as a share of the words
  links: number;
  images: number;
  emojis: number;
  words: number;
}

const SPAM_PHRASES = [
  "100% free", "act now", "apply now", "as seen on", "buy now", "cash bonus", "click here", "click below",
  "congratulations", "dear friend", "double your", "earn money", "exclusive deal", "extra income", "free gift",
  "free trial", "guarantee", "increase sales", "limited time", "lowest price", "make money", "no cost",
  "no obligation", "once in a lifetime", "order now", "risk-free", "risk free", "special promotion",
  "this isn't spam", "urgent", "winner", "you have been selected", "100% satisfied", "best price", "cheap",
  "credit card", "earn $", "fast cash", "instant", "miracle", "save big", "unsubscribe now",
];

export function spamCheck(subject: string, bodyHtml: string): SpamReport {
  const text = htmlToText(bodyHtml);
  const lower = `${subject}\n${text}`.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const issues: SpamIssue[] = [];
  const add = (code: string, message: string, penalty: number) => issues.push({ code, message, penalty });

  const hits = SPAM_PHRASES.filter((p) => lower.includes(p));
  if (hits.length) add("spam_words", `Spam-trigger phrases: ${hits.slice(0, 5).join(", ")}`, Math.min(30, hits.length * 8));

  const links = (bodyHtml.match(/<a\s[^>]*href=/gi) ?? []).length + (text.match(/https?:\/\//g) ?? []).length;
  if (links > 2) add("links", `${links} links; keep cold emails to 1 or none`, Math.min(25, (links - 2) * 8));
  else if (links > 1) add("links", "2 links; one or none reads more personal", 5);

  const images = (bodyHtml.match(/<img\s/gi) ?? []).length;
  if (images > 0) add("images", "Images hurt cold-email deliverability", 10 + Math.min(15, (images - 1) * 5));

  if (words.length > 150) add("length", `${words.length} words; aim for 50 to 125`, Math.min(20, Math.ceil((words.length - 150) / 20) * 5));
  else if (words.length < 20 && words.length > 0) add("length", "Very short body", 5);

  const subjectWords = subject.trim().split(/\s+/).filter(Boolean).length;
  if (subjectWords > 7) add("subject_length", `Subject has ${subjectWords} words; 2 to 5 works best`, 10);
  if (/[!?]{2,}|!/.test(subject)) add("subject_punct", "Avoid exclamation marks in the subject", 8);

  const capsWords = `${subject} ${text}`.split(/\s+/).filter((w) => w.length > 3 && /^[A-Z]+$/.test(w));
  if (capsWords.length > 1) add("caps", "Several ALL-CAPS words", Math.min(15, capsWords.length * 4));

  const exclaims = (text.match(/!/g) ?? []).length;
  if (exclaims > 2) add("exclamations", `${exclaims} exclamation marks`, Math.min(10, exclaims * 2));

  if (/\$\d|€\d|£\d|\d+%\s*off/i.test(lower)) add("money", "Prices or discounts read as promotional", 8);

  const score = Math.max(0, 100 - issues.reduce((s, i) => s + i.penalty, 0));
  const tokens = (`${subject} ${bodyHtml}`.match(/\{\{[^}]+\}\}/g) ?? []).length;
  const metrics: SpamMetrics = {
    spamWords: hits.length,
    personalisationPct: Math.min(100, Math.round((tokens / Math.max(words.length, 1)) * 100)),
    links,
    images,
    emojis: (`${subject} ${text}`.match(/\p{Extended_Pictographic}/gu) ?? []).length,
    words: words.length,
  };
  return { score, rating: score >= 80 ? "good" : score >= 60 ? "fair" : "poor", wordCount: words.length, issues, metrics };
}
