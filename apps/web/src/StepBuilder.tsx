import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Step, Variant } from "./api";
import { EmailEditor } from "./EmailEditor";
import { toBlocks, toSteps, type Block } from "./stepBlocks";
import { cx, useToast } from "./ui";

export function StepBuilder({ steps, onChange }: { steps: Step[]; onChange: (steps: Step[]) => void }) {
  const toast = useToast();
  const blocks = toBlocks(steps);
  const [sel, setSel] = useState({ block: 0, variant: 0 });
  const bi = Math.min(sel.block, Math.max(0, blocks.length - 1));
  const block = blocks[bi];
  const vi = Math.min(sel.variant, Math.max(0, (block?.variants.length ?? 1) - 1));
  const variant = block?.variants[vi];

  const commit = (next: Block[]) => onChange(toSteps(next));
  const updateBlock = (i: number, patch: Partial<Block>) => commit(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const updateVariant = (patch: Partial<Variant>) => block && updateBlock(bi, { variants: block.variants.map((v, j) => (j === vi ? { ...v, ...patch } : v)) });

  const addBlock = () => {
    const first = blocks.length === 0;
    commit([...blocks, { waitDays: first ? 0 : 2, name: first ? "Initial email" : "Follow-up email", variants: [{ label: "A", subject: "", bodyHtml: "", weight: 1 }] }]);
    setSel({ block: blocks.length, variant: 0 });
  };
  const addVariant = (i: number) => {
    const b = blocks[i]!;
    if (b.variants.length >= 5) return;
    const base = b.variants[sel.block === i ? vi : 0] ?? b.variants[0];
    updateBlock(i, { variants: [...b.variants, { label: String.fromCharCode(65 + b.variants.length), subject: base?.subject ?? "", bodyHtml: base?.bodyHtml ?? "", weight: 1 }] });
    setSel({ block: i, variant: b.variants.length });
  };
  // Deleting the only variant of a step deletes the step.
  const removeRow = (i: number, v: number) => {
    const b = blocks[i]!;
    if (b.variants.length > 1) {
      updateBlock(i, { variants: b.variants.filter((_, j) => j !== v).map((x, j) => ({ ...x, label: String.fromCharCode(65 + j) })) });
      setSel({ block: i, variant: 0 });
      return;
    }
    if (blocks.length <= 1) return toast("A sequence needs at least one email", "error");
    const next = blocks.filter((_, j) => j !== i);
    // The email that becomes first keeps its delay step, set to zero.
    if (i === 0 && next[0]) next[0] = { ...next[0], waitDays: 0 };
    commit(next);
    setSel({ block: Math.max(0, Math.min(i, next.length - 1)), variant: 0 });
  };

  return (
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-6 items-start">
      <div className="space-y-3">
        {blocks.map((b, i) => (
          <div key={b.id ?? `new-${i}`}>
            {i > 0 && (
              <div className="relative flex items-center gap-3 py-3">
                <span className="absolute left-0 right-0 top-1/2 h-px bg-ink-200" />
                <input type="number" min={0} max={365} aria-label="Days to wait" className="input relative z-10 w-16 h-10 text-center" value={b.waitDays}
                  onChange={(e) => updateBlock(i, { waitDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
                <span className="relative z-10 bg-ink-50 pr-2 text-sm text-ink-500">Days to wait in between</span>
              </div>
            )}
            <div className={cx("card p-2", bi === i && "ring-2 ring-brand-500/30")}>
              {b.variants.map((v, k) => (
                <div key={k} className={cx("group flex items-center rounded-lg", bi === i && vi === k ? "bg-ink-100" : "hover:bg-ink-50")}>
                  <button className="flex-1 min-w-0 text-left px-3 py-3 text-sm font-medium truncate" onClick={() => setSel({ block: i, variant: k })}>
                    {b.variants.length > 1 ? `${v.label} · ` : ""}{b.name || (i === 0 ? "Initial email" : "Follow-up email")}
                  </button>
                  {(b.variants.length > 1 || blocks.length > 1) && (
                    <button className="btn-ghost btn-sm mr-1 text-ink-500" aria-label={b.variants.length > 1 ? "Remove variant" : "Remove step"} onClick={() => removeRow(i, k)}><Trash2 size={15} /></button>
                  )}
                </div>
              ))}
              <button className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-brand-700 disabled:opacity-40" disabled={b.variants.length >= 5} onClick={() => addVariant(i)}>
                <Plus size={16} /> Add variant
              </button>
            </div>
          </div>
        ))}
        <button className="w-full card flex items-center justify-center gap-2 h-12 text-[15px] font-medium hover:bg-ink-50" onClick={addBlock}><Plus size={18} /> Add new step</button>
      </div>

      {block && variant ? (
        <EmailEditor
          editorKey={`${bi}-${vi}-${block.id ?? "new"}`}
          stepName={block.name}
          onStepName={(name) => updateBlock(bi, { name })}
          subject={variant.subject}
          onSubject={(subject) => updateVariant({ subject })}
          bodyHtml={variant.bodyHtml}
          onBody={(bodyHtml) => updateVariant({ bodyHtml })}
          subjectPlaceholder={bi > 0 ? "Leave empty to reply in the same thread" : undefined}
        />
      ) : (
        <div className="card p-10 text-center text-ink-500">Add a step to start writing your emails.</div>
      )}
    </div>
  );
}
