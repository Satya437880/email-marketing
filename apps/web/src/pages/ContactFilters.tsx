import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SequenceRow, type Tag } from "../api";
import { cx, PortalMenu, useDebounced } from "../ui";

type Mode = "include" | "exclude";
interface ListF { mode: Mode; values: string[] }
type VarOp = "contains" | "equals" | "starts" | "empty" | "not_empty";

// The Filters panel on the Contacts page.
export interface ContactFilterState {
  lastContacted: { mode: Mode; amount: string; unit: "days" | "weeks" | "months" };
  tag: ListF;
  esp: ListF;
  validation: ListF;
  sequence: ListF;
  company: ListF;
  customVar: { mode: Mode; name: string; op: VarOp; value: string };
  excludeContacted: boolean;
}

const empty = (): ListF => ({ mode: "include", values: [] });
export const NO_CONTACT_FILTERS: ContactFilterState = {
  lastContacted: { mode: "include", amount: "", unit: "days" },
  tag: empty(), esp: empty(), validation: empty(), sequence: empty(), company: empty(),
  customVar: { mode: "include", name: "", op: "contains", value: "" },
  excludeContacted: false,
};

const UNIT_DAYS = { days: 1, weeks: 7, months: 30 };
const needsValue = (op: VarOp) => op === "contains" || op === "equals" || op === "starts";
const lastActive = (f: ContactFilterState) => Number(f.lastContacted.amount) > 0 || f.lastContacted.amount === "0";
const varActive = (f: ContactFilterState) => !!f.customVar.name && (!needsValue(f.customVar.op) || !!f.customVar.value.trim());

export function activeContactFilters(f: ContactFilterState): number {
  return [lastActive(f), f.tag.values.length > 0, f.esp.values.length > 0, f.validation.values.length > 0, varActive(f), f.sequence.values.length > 0, f.company.values.length > 0, f.excludeContacted].filter(Boolean).length;
}

// What is sent to the server (only the filters that are actually set).
export function contactFiltersToParam(f: ContactFilterState): string | undefined {
  const o: Record<string, unknown> = {};
  if (lastActive(f)) o.lastContacted = { mode: f.lastContacted.mode, days: Math.round(Number(f.lastContacted.amount) * UNIT_DAYS[f.lastContacted.unit]) };
  for (const k of ["tag", "esp", "validation", "sequence", "company"] as const) if (f[k].values.length) o[k] = f[k];
  if (varActive(f)) o.customVar = { mode: f.customVar.mode, name: f.customVar.name, op: f.customVar.op, value: f.customVar.value };
  if (f.excludeContacted) o.excludeContacted = true;
  return Object.keys(o).length ? JSON.stringify(o) : undefined;
}

type Cat = "lastContacted" | "tag" | "esp" | "validation" | "customVar" | "sequence" | "company";
const CATS: { key: Cat; label: string }[] = [
  { key: "lastContacted", label: "Last contacted" }, { key: "tag", label: "Tag" }, { key: "esp", label: "ESP" }, { key: "validation", label: "Validation status" },
  { key: "customVar", label: "Custom variable" }, { key: "sequence", label: "Sequence" }, { key: "company", label: "Company" },
];

const ESP_OPTIONS = [{ id: "google", label: "Google (Workspace or Gmail)" }, { id: "microsoft", label: "Microsoft (365 or Outlook)" }, { id: "other", label: "Other provider" }, { id: "unknown", label: "Unknown" }];
const VALIDATION_OPTIONS = [{ id: "unverified", label: "Unvalidated" }, { id: "valid", label: "Valid" }, { id: "invalid", label: "Invalid (bounced)" }];

export function ContactFiltersButton({ ws, value, onChange }: { ws: string; value: ContactFilterState; onChange: (f: ContactFilterState) => void }) {
  const [cat, setCat] = useState<Cat>("lastContacted");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const sequences = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`) });
  const companies = useQuery({ queryKey: ["contact-companies", ws, debounced], enabled: cat === "company", queryFn: () => api<{ name: string; n: number }[]>(`/v1/workspaces/${ws}/contacts/filter-options?kind=company&q=${encodeURIComponent(debounced)}`) });
  const varNames = useQuery({ queryKey: ["contact-variable-names", ws], enabled: cat === "customVar", queryFn: () => api<{ name: string; n: number }[]>(`/v1/workspaces/${ws}/contacts/filter-options?kind=variable`) });
  useEffect(() => setSearch(""), [cat]);

  const count = activeContactFilters(value);
  const countOf = (c: Cat) => (c === "lastContacted" ? (lastActive(value) ? 1 : 0) : c === "customVar" ? (varActive(value) ? 1 : 0) : value[c].values.length);
  const mode: Mode = cat === "lastContacted" ? value.lastContacted.mode : cat === "customVar" ? value.customVar.mode : value[cat].mode;
  const setMode = (m: Mode) => {
    if (cat === "lastContacted") onChange({ ...value, lastContacted: { ...value.lastContacted, mode: m } });
    else if (cat === "customVar") onChange({ ...value, customVar: { ...value.customVar, mode: m } });
    else onChange({ ...value, [cat]: { ...value[cat], mode: m } });
  };

  const options: { id: string; label: string; note?: string }[] =
    cat === "tag" ? [{ id: "__untagged__", label: "Untagged contacts" }, ...(tags.data ?? []).map((t) => ({ id: t.id, label: t.name, note: `${t.contacts}` }))]
      : cat === "sequence" ? (sequences.data ?? []).map((s) => ({ id: s.id, label: s.name }))
        : cat === "esp" ? ESP_OPTIONS
          : cat === "validation" ? VALIDATION_OPTIONS
            : cat === "company" ? (companies.data ?? []).map((c) => ({ id: c.name, label: c.name, note: `${c.n}` }))
              : [];
  // Companies are searched on the server; the other lists are searched here.
  const shown = cat === "company" ? options : options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const listKey = cat === "lastContacted" || cat === "customVar" ? null : cat;
  const toggle = (id: string) => {
    if (!listKey) return;
    const cur = value[listKey];
    onChange({ ...value, [listKey]: { ...cur, values: cur.values.includes(id) ? cur.values.filter((x) => x !== id) : [...cur.values, id] } });
  };

  return (
    <PortalMenu align="left" width={680} trigger={
      <button className={cx("btn-secondary", count > 0 && "border-brand-500 text-brand-700")}>
        <SlidersHorizontal size={15} /> Filters{count > 0 && <span className="chip bg-brand-600 text-white">{count}</span>}
      </button>
    }>
      {() => (
        <div className="-m-1.5">
          <div className="flex">
            <div className="w-60 shrink-0 bg-ink-50/70 border-r border-ink-100">
              <div className="px-4 py-3 text-sm font-semibold text-ink-500">Filters</div>
              <div className="p-2.5 space-y-0.5">
                {CATS.map((c) => (
                  <button key={c.key} className={cx("w-full flex items-center gap-2 rounded-lg px-3 h-10 text-[15px] text-left", cat === c.key ? "bg-ink-100 text-ink-900 font-medium" : "text-ink-700 hover:bg-ink-100/70")} onClick={() => setCat(c.key)}>
                    <span className="flex-1">{c.label}</span>
                    {countOf(c.key) > 0 && <span className="min-w-[20px] h-5 px-1 grid place-items-center rounded-md bg-brand-600 text-xs font-medium text-white">{countOf(c.key)}</span>}
                    <ChevronRight size={16} className="text-ink-500" />
                  </button>
                ))}
                <label className="flex items-center gap-2 rounded-lg px-3 h-10 text-[15px] text-ink-700 cursor-pointer" title="Hide contacts who have already been emailed">
                  <span className="flex-1">Exclude contacted</span>
                  <button type="button" role="switch" aria-checked={value.excludeContacted} onClick={() => onChange({ ...value, excludeContacted: !value.excludeContacted })}
                    className={cx("relative w-9 h-5 rounded-full transition-colors", value.excludeContacted ? "bg-brand-600" : "bg-ink-200")}>
                    <span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", value.excludeContacted ? "left-[18px]" : "left-0.5")} />
                  </button>
                </label>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex gap-5 px-4 pt-3 border-b border-ink-100">
                {(["include", "exclude"] as Mode[]).map((m) => (
                  <button key={m} className={cx("pb-2.5 -mb-px border-b-2 text-sm font-semibold capitalize", mode === m ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")} onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
              <div className="p-3 min-h-[250px]">
                {cat === "lastContacted" ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-sm text-ink-700">At least</span>
                    <input className="input h-10 w-28" type="number" min={0} placeholder="e.g. 7…" value={value.lastContacted.amount} onChange={(e) => onChange({ ...value, lastContacted: { ...value.lastContacted, amount: e.target.value } })} />
                    <div className="relative">
                      <select className="input h-10 appearance-none pr-9 w-36" value={value.lastContacted.unit} onChange={(e) => onChange({ ...value, lastContacted: { ...value.lastContacted, unit: e.target.value as "days" | "weeks" | "months" } })}>
                        <option value="days">days ago</option><option value="weeks">weeks ago</option><option value="months">months ago</option>
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
                    </div>
                  </div>
                ) : cat === "customVar" ? (
                  <div className="space-y-2.5">
                    <div className="relative">
                      <select className="input h-11 appearance-none pr-9" value={value.customVar.name} onChange={(e) => onChange({ ...value, customVar: { ...value.customVar, name: e.target.value } })}>
                        <option value="">Custom variable</option>
                        {(varNames.data ?? []).map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
                    </div>
                    <div className="relative">
                      <select className="input h-11 appearance-none pr-9" value={value.customVar.op} onChange={(e) => onChange({ ...value, customVar: { ...value.customVar, op: e.target.value as VarOp } })}>
                        <option value="contains">Contains</option><option value="equals">Equals</option><option value="starts">Starts with</option><option value="empty">Is empty</option><option value="not_empty">Is not empty</option>
                      </select>
                      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
                    </div>
                    {needsValue(value.customVar.op) && <input className="input h-11" placeholder="Variable value" value={value.customVar.value} onChange={(e) => onChange({ ...value, customVar: { ...value.customVar, value: e.target.value } })} />}
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500" />
                      <input className="input h-11 pl-10 rounded-xl" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <div className="mt-2 max-h-60 overflow-y-auto">
                      {!shown.length ? <div className="px-3 py-3 text-sm text-ink-400">{cat === "company" && companies.isFetching ? "Loading…" : "Nothing found"}</div> : shown.map((o) => {
                        const on = !!listKey && value[listKey].values.includes(o.id);
                        return (
                          <button key={o.id} className="w-full flex items-center gap-3 rounded-lg px-3 h-10 text-[15px] text-ink-800 text-left hover:bg-ink-50" onClick={() => toggle(o.id)}>
                            <span className={cx("grid place-items-center w-5 h-5 rounded-md border shrink-0", on ? "bg-brand-600 border-brand-600 text-white" : "border-ink-300")}>{on && <Check size={13} strokeWidth={3} />}</span>
                            <span className="flex-1 truncate">{o.label}</span>
                            {o.note && <span className="text-xs text-ink-400">{o.note}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-ink-100 bg-surface">
            <button className="btn-secondary btn-sm" disabled={count === 0} onClick={() => { onChange(NO_CONTACT_FILTERS); setSearch(""); }}><RotateCcw size={14} /> Reset filters</button>
            <span className="text-xs text-ink-500">{count ? `${count} filter${count === 1 ? "" : "s"} on` : "No filters on"}</span>
          </div>
        </div>
      )}
    </PortalMenu>
  );
}
