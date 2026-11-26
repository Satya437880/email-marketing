import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "./ui";
import { IANA_ZONES, ZONE_COUNTRY } from "./ianaZones";
import { EXTRA_ZONES, NA_ABBR, ZONE_TAGS } from "./timezoneAliases";

function allZones(): string[] {
  let list: string[] = [];
  try { list = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { /* older browsers */ }
  // Browsers leave UTC and the older/alternative names (Asia/Kolkata, US/Eastern, Etc/GMT+5 ...) out of their list; offer every one this browser understands.
  const known = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
  return [...new Set([...list, ...IANA_ZONES.filter(known), ...EXTRA_ZONES.filter(known)])].sort((a, b) => (a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b)));
}

// United States and Canada: every zone gets its abbreviation from its winter offset, so no city is left without EST, CST, MST, PST ...
function northAmerica(tz: string): { abbr: string; region: string; words: string } | undefined {
  const country = ZONE_COUNTRY[tz];
  if (!country) return undefined;
  try {
    const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 15, 12))).find((p) => p.type === "timeZoneName")?.value ?? "";
    const a = NA_ABBR[off];
    return a ? { abbr: a.abbr, region: country === "US" ? "United States" : "Canada", words: `${a.words} ${country === "US" ? "USA US America" : "CA Canadian"}` } : undefined;
  } catch { return undefined; }
}

function describe(tz: string) {
  let offset = "";
  let long = "";
  let short = "";
  try {
    const parts = (name: "shortOffset" | "long" | "short") => new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: name }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    offset = parts("shortOffset");
    long = parts("long");
    short = parts("short");
  } catch { /* unknown zone: show the bare name */ }
  // Common abbreviations people type that browsers don't print for every zone.
  const alias = /Kolkata|Calcutta/.test(tz) ? "IST india" : "";
  return { offset, long, short: `${short} ${alias}`.trim(), label: offset ? `${tz} (${offset})` : tz };
}

// A time zone picker with a search box. Search by city, country-style name ("India Standard Time"), region ("Europe") or offset ("+5:30").
export function TimezoneSelect({ value, onChange, className }: { value: string; onChange: (tz: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const zones = [...new Set([value, ...allZones()])];
    return zones.map((tz) => {
      const d = describe(tz);
      // The abbreviation and country (EST · United States) shown on the right of the row, and searchable.
      const tag = ZONE_TAGS.find((t) => t.tz === tz) ?? northAmerica(tz);
      return { tz, label: d.label, abbr: tag?.abbr ?? "", region: tag?.region ?? "", hay: `${tz} ${tz.replace(/[_/]/g, " ")} ${d.offset} ${d.long} ${d.short} ${tag ? `${tag.abbr} ${tag.region} ${tag.words ?? ""}` : ""}`.toLowerCase() };
    });
  }, [value]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? items.filter((i) => words.every((w) => i.hay.includes(w))) : items;
  }, [items, q]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = (tz: string) => { onChange(tz); setOpen(false); setQ(""); };
  const current = items.find((i) => i.tz === value);

  return (
    <div className="relative" ref={box}>
      <button type="button" className={cx("input flex items-center justify-between gap-2 text-left", className)} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="truncate">{current?.label ?? value}{current?.abbr ? ` · ${current.abbr}` : ""}</span>
        <ChevronDown size={16} className="text-ink-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 card p-2 shadow-lg">
          <div className="relative mb-2">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input h-9 pl-9" autoFocus placeholder="Search time zone, e.g. EST, PST, Canada, India, +5:30" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); pick(shown[0].tz); } }} />
          </div>
          <div className="max-h-64 overflow-y-auto" role="listbox">
            {shown.length ? shown.map((i) => (
              <button type="button" key={i.tz} role="option" aria-selected={i.tz === value} className={cx("w-full flex items-center gap-3 text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50", i.tz === value && "bg-brand-50 text-brand-800 font-medium")} onClick={() => pick(i.tz)}><span className="flex-1 min-w-0 truncate">{i.label}</span>{i.abbr && <span className="shrink-0 text-xs text-ink-500"><b className="font-semibold text-ink-700">{i.abbr}</b> · {i.region}</span>}</button>
            )) : <div className="px-2.5 py-3 text-sm text-ink-500">No time zone matches "{q}".</div>}
          </div>
        </div>
      )}
    </div>
  );
}
