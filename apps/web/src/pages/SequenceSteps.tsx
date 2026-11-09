import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, HelpCircle, Languages, Send, Settings as SettingsIcon, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SequenceDetail } from "../api";
import { useWs } from "../App";
import { cx, Modal, useToast } from "../ui";

export const WIZARD_STEPS = [
  { k: "name", label: "Name & Service", icon: <Languages size={18} /> },
  { k: "contacts", label: "Contacts", icon: <User size={18} /> },
  { k: "builder", label: "Draft", icon: <Send size={18} /> },
  { k: "schedule", label: "Schedule", icon: <Clock size={18} /> },
  { k: "settings", label: "Settings", icon: <SettingsIcon size={18} /> },
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number]["k"];

export function Stepper({ step, onStep }: { step: number; onStep: (i: number) => void }) {
  return (
    <ol className="flex w-full">
      {WIZARD_STEPS.map((s, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={s.k} className="relative flex-1 min-w-[72px]">
            {i < WIZARD_STEPS.length - 1 && <span className={cx("absolute top-5 left-1/2 w-full h-0.5", done ? "bg-brand-500" : "bg-ink-200")} />}
            <button className="relative z-10 w-full flex flex-col items-center gap-2 group" onClick={() => onStep(i)} aria-current={current ? "step" : undefined}>
              <span className={cx(
                "grid place-items-center w-10 h-10 rounded-full border bg-surface transition-colors",
                current ? "border-brand-600 text-brand-700 ring-4 ring-brand-500/15" : done ? "border-brand-500 text-brand-600" : "border-ink-200 text-ink-500 group-hover:border-ink-300",
              )}>
                {done ? <Check size={18} /> : s.icon}
              </span>
              <span className={cx("text-xs sm:text-sm font-semibold text-center", current ? "text-brand-700" : done ? "text-ink-700" : "text-ink-500")}>{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StepHeader({ title, text, help, actions }: { title: string; text: string; help?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-5 border-b border-ink-200 mb-2">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">{title}{help && <span title={help} className="text-ink-400 cursor-help"><HelpCircle size={16} /></span>}</h2>
        <p className="text-sm text-ink-500 mt-0.5">{text}</p>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

const LANGUAGES = ["American English", "British English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Hindi", "Arabic"];

interface Product { id: string; name: string; description: string }

export function NameServiceStep({ sequence, onSaved }: { sequence: SequenceDetail; onSaved: () => void }) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(sequence.name);
  const [productId, setProductId] = useState(sequence.settings.productId ?? "");
  const [language, setLanguage] = useState(sequence.settings.language ?? "American English");
  const [creating, setCreating] = useState(false);
  const [p, setP] = useState({ name: "", description: "" });
  const products = useQuery({ queryKey: ["products", ws], queryFn: () => api<Product[]>(`/v1/workspaces/${ws}/products`) });
  useEffect(() => { setName(sequence.name); }, [sequence.name]);

  const dirty = name.trim() !== sequence.name || (productId || null) !== (sequence.settings.productId ?? null) || language !== (sequence.settings.language ?? "American English");
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/sequences/${sequence.id}`, { method: "PATCH", body: { name: name.trim(), settings: { language, productId: productId || null } } }),
    onSuccess: () => { toast("Sequence updated"); onSaved(); qc.invalidateQueries({ queryKey: ["sequences", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const create = useMutation({
    mutationFn: () => api<Product>(`/v1/workspaces/${ws}/products`, { body: p }),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ["products", ws] }); setProductId(row.id); setCreating(false); setP({ name: "", description: "" }); toast("Service created"); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const row = "grid md:grid-cols-[240px_minmax(0,480px)] gap-3 md:gap-8 py-6 border-b border-ink-200";
  return (
    <div>
      <StepHeader title="Edit sequence" help="Give the sequence a name, and say what you're selling and the language you write in." text="Give your sequence a name and select the service you want to sell"
        actions={<button className="btn-primary h-10" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Update sequence"}</button>} />
      <div className={row}><label className="text-sm font-semibold pt-2.5" htmlFor="seq-name">Sequence name</label>
        <input id="seq-name" className="input h-11" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={row}><label className="text-sm font-semibold pt-2.5" htmlFor="seq-product">Service</label>
        <div className="space-y-3">
          <select id="seq-product" className="input h-11" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">No service selected</option>
            {(products.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button className="btn-secondary w-full h-11" onClick={() => setCreating(true)}>Create new service</button>
        </div>
      </div>
      <div className={row}><label className="text-sm font-semibold pt-2.5" htmlFor="seq-lang">Language</label>
        <select id="seq-lang" className="input h-11" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Create new service" subtitle="What you sell, in a sentence or two." footer={<>
        <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
        <button className="btn-primary" disabled={!p.name.trim() || create.isPending} onClick={() => create.mutate()}>Create service</button>
      </>}>
        <div className="space-y-3">
          <div><label className="label">Service name</label><input className="input" value={p.name} autoFocus onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Outsourced accounting" /></div>
          <div><label className="label">Description <span className="font-normal text-ink-400">(optional)</span></label><textarea className="textarea min-h-[100px]" value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} placeholder="Who it's for and the main benefit" /></div>
        </div>
      </Modal>
    </div>
  );
}
