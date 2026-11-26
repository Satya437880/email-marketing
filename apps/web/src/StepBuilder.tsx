import { ChevronDown, ChevronUp, Clock, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Step, Variant } from "./api";
import { EmailEditor } from "./EmailEditor";
import { toBlocks, toSteps, type Block } from "./stepBlocks";
import { cx, useToast } from "./ui";

const UNITS = [{ k: "minutes", f: 1 }, { k: "hours", f: 60 }, { k: "days", f: 1440 }] as const;
const MAX_MINUTES = 365 * 1440;

// 90 minutes stays "90 minutes"; 120 becomes "2 hours"; 2880 becomes "2 days".
function splitWait(total: number): { value: number; unit: (typeof UNITS)[number]["k"] } {
  if (total > 0 && total % 1440 === 0) return { value: total / 1440, unit: "days" };
  if (total > 0 && total % 60 === 0) return { value: total / 60, unit: "hours" };
  return { value: total > 0 ? total : 10, unit: "minutes" };
}

function describeWait(total: number, followUp: boolean): string {
  const after = followUp ? "the previous step is completed" : "the contact is added";
  if (total <= 0) return `Sends immediately after ${after}`;
  const { value, unit } = splitWait(total);
  return `Sends ${value} ${value === 1 ? unit.slice(0, -1) : unit} after ${after}`;
}

// Round radio with a thick dark ring when selected.
function Radio({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <>
      <input type="radio" className="sr-only" checked={checked} onChange={onChange} />
      <span aria-hidden="true" className={cx("shrink-0 w-5 h-5 rounded-full border bg-surface", checked ? "border-[6px] border-ink-900" : "border-ink-300")} />
    </>
  );
}

// "When to start this step": for the first email, how long after a contact is added (or the sequence launches) it goes out;
// for a follow-up, how long after the previous step is completed.
function StartDelay({ minutes, onSave, followUp = false }: { minutes: number; onSave: (minutes: number) => void; followUp?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "after">("now");
  // The box holds text so it can be cleared and retyped; leading zeros are stripped as you type.
  const [text, setText] = useState("10");
  const value = text === "" ? 0 : Number(text);
  const [unit, setUnit] = useState<(typeof UNITS)[number]["k"]>("minutes");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const openIt = () => {
    const s = splitWait(minutes);
    setMode(minutes > 0 ? "after" : "now");
    setText(String(s.value));
    setUnit(s.unit);
    setOpen(true);
  };
  const factor = UNITS.find((u) => u.k === unit)!.f;
  const total = Math.min(MAX_MINUTES, Math.max(0, Math.round(value)) * factor);
  const save = () => { onSave(mode === "now" ? 0 : total); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button className="inline-flex items-center gap-2 rounded-full bg-ink-100 px-3.5 py-1.5 text-sm text-ink-700 hover:bg-ink-200" onClick={() => (open ? setOpen(false) : openIt())}>
        <Clock size={15} /> {describeWait(minutes, followUp)} <Pencil size={13} className="text-ink-500" />
      </button>
      {open && (
        <div className="absolute z-30 left-1/2 -translate-x-1/2 mt-2 w-[30rem] max-w-[calc(100vw-3rem)] card shadow-lg text-left">
          <div className="px-6 pt-6 pb-5 space-y-5">
            <div className="text-[15px] text-ink-600">When to start this step</div>
            <label className="flex items-center gap-3 text-[16px] text-ink-700 cursor-pointer">
              <Radio checked={mode === "now"} onChange={() => setMode("now")} />
              {followUp ? "Immediately after previous step is completed" : "Immediately after contact is added"}
            </label>
            <div className="flex flex-nowrap items-center gap-3">
              <label className="flex items-center gap-3 text-[16px] text-ink-700 cursor-pointer whitespace-nowrap">
                <Radio checked={mode === "after"} onChange={() => setMode("after")} />
                Execute step after
              </label>
              <div className="relative">
                <input type="text" inputMode="numeric" aria-label="Wait amount" className="input !w-24 !h-11 !rounded-xl !text-[16px] pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value}
                  onChange={(e) => { setMode("after"); const t = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""); setText(t === "" ? "" : String(Math.min(MAX_MINUTES / factor, Number(t)))); }}
                  onBlur={() => setText(String(value))} />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col text-ink-700">
                  <button type="button" aria-label="Increase" className="h-3.5 grid place-items-center" onClick={() => { setMode("after"); setText(String(Math.min(MAX_MINUTES / factor, value + 1))); }}><ChevronUp size={14} /></button>
                  <button type="button" aria-label="Decrease" className="h-3.5 grid place-items-center" onClick={() => { setMode("after"); setText(String(Math.max(0, value - 1))); }}><ChevronDown size={14} /></button>
                </div>
              </div>
              <div className="relative flex-1 min-w-[7rem]">
                <select aria-label="Wait unit" className="input !h-11 !rounded-xl !text-[16px] appearance-none pr-9" value={unit} onChange={(e) => { setMode("after"); setUnit(e.target.value as typeof unit); }}>
                  {UNITS.map((u) => <option key={u.k} value={u.k}>{u.k}</option>)}
                </select>
                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-600" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 border-t border-ink-200 px-6 py-4">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function StepBuilder({ steps, onChange }: { steps: Step[]; onChange: (steps: Step[]) => void }) {
  const toast = useToast();
  const blocks = toBlocks(steps);
  // The newest draft, including edits made since the last render: a template sets the subject and then the body, and the
  // second edit must not be built on the old copy.
  const latest = useRef(blocks);
  latest.current = blocks;
  // Every step is always open; each keeps its own selected test tab.
  const [tabs, setTabs] = useState<Record<number, number>>({});
  const tabOf = (i: number) => Math.min(tabs[i] ?? 0, Math.max(0, (blocks[i]?.variants.length ?? 1) - 1));
  const setTab = (i: number, v: number) => setTabs((t) => ({ ...t, [i]: v }));

  const commit = (next: Block[]) => { latest.current = next; onChange(toSteps(next)); };
  const updateBlock = (i: number, patch: Partial<Block>) => commit(latest.current.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const updateVariant = (i: number, patch: Partial<Variant>) => {
    const b = latest.current[i];
    if (b) updateBlock(i, { variants: b.variants.map((v, j) => (j === tabOf(i) ? { ...v, ...patch } : v)) });
  };

  const addBlock = () => {
    const first = blocks.length === 0;
    commit([...blocks, { waitMinutes: first ? 0 : 2 * 1440, name: first ? "Initial email" : `Follow-up ${blocks.length}`, variants: [{ label: "A", subject: "", bodyHtml: "", weight: 1 }] }]);
    setTab(blocks.length, 0);
  };
  const addVariant = (i: number) => {
    const b = blocks[i]!;
    if (b.variants.length >= 5) return;
    const base = b.variants[tabOf(i)] ?? b.variants[0];
    updateBlock(i, { variants: [...b.variants, { label: String.fromCharCode(65 + b.variants.length), subject: base?.subject ?? "", bodyHtml: base?.bodyHtml ?? "", weight: 1, attachments: base?.attachments ?? [] }] });
    setTab(i, b.variants.length);
  };
  // Deleting the only variant of a step deletes the step.
  const removeRow = (i: number, v: number) => {
    const b = blocks[i]!;
    if (b.variants.length > 1) {
      updateBlock(i, { variants: b.variants.filter((_, j) => j !== v).map((x, j) => ({ ...x, label: String.fromCharCode(65 + j) })) });
      setTab(i, 0);
      return;
    }
    if (blocks.length <= 1) return toast("A sequence needs at least one email", "error");
    const next = blocks.filter((_, j) => j !== i);
    // The email that becomes first keeps its delay step, set to zero.
    if (i === 0 && next[0]) next[0] = { ...next[0], waitMinutes: 0 };
    commit(next);
    setTabs({});
  };

  const connector = <div className="mx-auto h-5 w-px bg-ink-300" />;
  // A follow-up that replies in the thread shows the subject of the email that started it: the nearest earlier step that has a subject.
  const threadSubject = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      const sub = blocks[j]?.variants[0]?.subject?.trim();
      if (sub) return sub;
    }
    return "";
  };
  const defaultName = (i: number) => (i === 0 ? "Initial email" : `Follow-up ${i}`);

  // Steps stack as full-width cards joined by a vertical line. The open step shows its variant tabs, the draft and a live preview.
  return (
    <div className="max-w-[1500px] mx-auto">
      {blocks.map((b, i) => {
        const open = true;
        const vi = tabOf(i);
        const variant = b.variants[vi];
        const removable = b.variants.length > 1 || blocks.length > 1;
        return (
          <div key={b.id ?? `new-${i}`}>
            {i === 0 ? (
              <div className="flex justify-center"><StartDelay minutes={b.waitMinutes} onSave={(waitMinutes) => updateBlock(0, { waitMinutes })} /></div>
            ) : (
              <div className="flex justify-center"><StartDelay followUp minutes={b.waitMinutes} onSave={(waitMinutes) => updateBlock(i, { waitMinutes })} /></div>
            )}
            {connector}

            <div className={cx("card overflow-hidden", open && "ring-2 ring-brand-500/30")}>
              <div className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid place-items-center w-9 h-9 rounded-lg border border-ink-200 shrink-0"><Mail size={16} /></span>
                {open ? (
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm text-ink-500 whitespace-nowrap">Step {i + 1}:</span>
                    <input className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold focus:outline-none" value={b.name} onChange={(e) => updateBlock(i, { name: e.target.value })} placeholder={defaultName(i)} aria-label="Step name" />
                    {b.variants.length > 1 && variant && <span className="text-sm text-ink-500 whitespace-nowrap">/ Test {variant.label}</span>}
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate">Step {i + 1}: {b.name || defaultName(i)}</div>
                    <div className="text-xs text-ink-500 truncate">{b.variants[0]?.subject || (i > 0 ? "Replies in the same thread" : "No subject yet")}{b.variants.length > 1 ? ` · ${b.variants.length} tests` : ""}</div>
                  </div>
                )}
                {removable && (
                  <button className="btn-ghost btn-sm text-ink-500" aria-label={open && b.variants.length > 1 ? "Remove test" : "Remove step"} title={open && b.variants.length > 1 ? "Remove this test" : "Remove step"}
                    onClick={(e) => { e.stopPropagation(); removeRow(i, open ? vi : 0); }}><Trash2 size={15} /></button>
                )}
              </div>

              {open && (
                <>
                  <div className="flex items-center gap-1 px-4 border-y border-ink-100 overflow-x-auto">
                    {b.variants.map((v, k) => (
                      <button key={k} className={cx("px-3 py-2.5 -mb-px border-b-2 text-sm whitespace-nowrap", vi === k ? "border-ink-900 font-semibold text-ink-900" : "border-transparent text-ink-500 hover:text-ink-800")}
                        onClick={() => setTab(i, k)}>Test {v.label}</button>
                    ))}
                    <button className="flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-brand-700 disabled:opacity-40 whitespace-nowrap" disabled={b.variants.length >= 5} onClick={() => addVariant(i)}>
                      <Plus size={15} /> Add test
                    </button>
                  </div>
                  {variant && (
                    <EmailEditor
                      embedded
                      canReply={i > 0}
                      threadMode={b.threadMode ?? null}
                      onThreadMode={(threadMode) => updateBlock(i, { threadMode, ...(threadMode === "reply" ? { variants: b.variants.map((x, j) => (j === vi ? { ...x, subject: "" } : x)) } : {}) })}
                      replySubject={threadSubject(i)}
                      earlier={blocks.slice(0, i).map((x) => ({ subject: x.variants[0]?.subject ?? "", bodyHtml: x.variants[0]?.bodyHtml ?? "" }))}
                      stats={{ sent: b.sent ?? 0, waiting: b.waiting ?? 0 }}
                      editorKey={`${i}-${vi}-${b.id ?? "new"}`}
                      stepName={b.name}
                      onStepName={(name) => updateBlock(i, { name })}
                      subject={variant.subject}
                      onSubject={(subject) => updateVariant(i, { subject })}
                      bodyHtml={variant.bodyHtml}
                      onBody={(bodyHtml) => updateVariant(i, { bodyHtml })}
                      attachments={variant.attachments ?? []}
                      onAttachments={(attachments) => updateVariant(i, { attachments })}
                      subjectPlaceholder={i > 0 ? "Enter the subject for this email" : undefined}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

      {blocks.length > 0 && connector}
      {blocks.length === 0 && <div className="card p-10 text-center text-ink-500 mb-4">Add a step to start writing your emails.</div>}
      <div className="flex justify-center">
        <button className="card inline-flex items-center justify-center gap-2 h-11 px-6 text-[15px] font-medium hover:bg-ink-50" onClick={addBlock}><Plus size={18} /> Add new step</button>
      </div>
    </div>
  );
}
