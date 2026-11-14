// Template syntax:
//   {{Hi|Hello|Hey}}         spintax: one option is chosen per contact
//   {{first_name}}           variable
//   {{first_name:there}}     variable with fallback when empty
// Spintax can nest and options may contain variables.

export type Variables = Record<string, string | number | null | undefined>;

export interface RenderOptions {
  seed: string;
  html?: boolean;
}

const TOKEN = /\{\{([^{}]*)\}\}/;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeVarName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function render(template: string, vars: Variables, opts: RenderOptions): string {
  const rand = seededRandom(opts.seed);
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    if (v !== null && v !== undefined && String(v).trim() !== "") lookup.set(normalizeVarName(k), String(v));
  }

  // Variable values are swapped in only at the end so their content is never parsed as syntax.
  const values: string[] = [];
  let out = template;
  for (let m = TOKEN.exec(out); m; m = TOKEN.exec(out)) {
    const inner = m[1] ?? "";
    let replacement: string;
    if (inner.includes("|")) {
      const options = inner.split("|");
      replacement = options[Math.floor(rand() * options.length)] ?? "";
    } else {
      const sep = inner.indexOf(":");
      const name = normalizeVarName(sep === -1 ? inner : inner.slice(0, sep));
      const fallback = sep === -1 ? "" : inner.slice(sep + 1);
      const raw = lookup.get(name) ?? fallback;
      values.push(opts.html ? escapeHtml(raw) : raw);
      replacement = `\u0000${values.length - 1}\u0000`;
    }
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
  }
  return out.replace(PLACEHOLDER, (_, i) => values[Number(i)] ?? "");
}

export function listVariables(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{\{([^{}|]*)\}\}/g)) {
    const inner = m[1] ?? "";
    const sep = inner.indexOf(":");
    found.add(normalizeVarName(sep === -1 ? inner : inner.slice(0, sep)));
  }
  return [...found];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    // A block starts on its own line, so a <div> right after a line of text does not run into it.
    .replace(/<div(\s[^>]*)?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href, text) => (text === href ? href : `${text} (${href})`))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
