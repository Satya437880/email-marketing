import { useQuery } from "@tanstack/react-query";
import { Check, FileText } from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import { cx, Modal } from "./ui";

const FILTERS: [string, string][] = [["replied", "Replied"], ["opened", "Opened"], ["bounced", "Bounced"], ["ooo", "Out of office"], ["unsubscribed", "Unsubscribed"], ["dnc", "Do not contact (DNC)"]];

// "Download reports" (for one sequence, or for the whole workspace): pick one or more CSV reports and download them.
export function ReportsModal({ ws, sequenceId, from, to, onClose }: { ws: string; sequenceId?: string; from?: string; to?: string; onClose: () => void }) {
  const seq = sequenceId ? `&sequenceId=${sequenceId}` : "";
  const range = `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;
  const reports = [
    { key: "contact-list", name: "Contact list", text: sequenceId ? "The people in this sequence, with their details" : "Every contact in this workspace, with their details", url: `/v1/workspaces/${ws}/reports/contact-list.csv?x=1${seq}` },
    { key: "all-emails", name: "All emails report", text: sequenceId ? "Emails sent and received in this sequence in the selected dates" : "Every email sent and received", url: `/v1/workspaces/${ws}/reports/messages.csv?x=1${seq}${range}` },
    { key: "contacts", name: "Contacts report", text: sequenceId ? "Every contact in this sequence with status" : "Every contact in every sequence, with status and progress", url: `/v1/workspaces/${ws}/reports/sequence-contacts.csv?x=1${seq}` },
  ];
  const [picked, setPicked] = useState<string[]>([]);
  // For the whole-workspace window: choose which sequences go into each report (none ticked = all of them).
  const [seqPicked, setSeqPicked] = useState<Record<string, string[]>>({});
  const [filters, setFilters] = useState<string[]>([]);
  const setSeqs = (key: string, v: string[]) => setSeqPicked((p) => ({ ...p, [key]: v }));
  const seqs = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<{ id: string; name: string }[]>(`/v1/workspaces/${ws}/sequences`), enabled: !sequenceId });
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  // Each file is its own download; they start one after another so the browser doesn't block them.
  const download = () => {
    reports.filter((r) => picked.includes(r.key)).forEach((r, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        const seqs = seqPicked[r.key] ?? [];
        a.href = r.url + (!sequenceId && seqs.length ? `&sequenceIds=${seqs.join(",")}` : "") + (r.key === "contacts" && filters.length ? `&filters=${filters.join(",")}` : "");
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 500);
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Download reports" icon={<FileText size={20} />}>
      <h3 className="text-lg font-semibold text-ink-900">Your reports</h3>
      <p className="text-sm text-ink-500 mb-4">Select the report you want to download</p>
      <div className="space-y-3">
        {reports.map((r) => {
          const on = picked.includes(r.key);
          const withList = on && !sequenceId;
          const chosen = seqPicked[r.key] ?? [];
          return (
            <div key={r.key} className={cx("rounded-2xl border transition-colors", on ? "border-brand-600 bg-brand-50/40" : "border-ink-200")}>
              <button type="button" aria-pressed={on} onClick={() => toggle(r.key)} className="w-full flex items-center gap-4 px-4 py-3.5 text-left">
                <span className="relative grid place-items-center w-10 h-12 shrink-0 rounded-md border border-ink-200 bg-surface text-ink-300">
                  <FileText size={26} strokeWidth={1.2} />
                  <span className="absolute -left-1 bottom-1 rounded bg-emerald-600 px-1 text-[10px] font-bold leading-4 text-white">CSV</span>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] text-ink-800">{r.name}</span>
                  <span className="block text-xs text-ink-500">{r.text}</span>
                </span>
                <span className={cx("grid place-items-center w-5 h-5 rounded-full shrink-0 self-start", on ? "bg-brand-600 text-white" : "border border-ink-300")}>{on && <Check size={13} strokeWidth={3} />}</span>
              </button>
              {withList && (
                <div className="px-4 pb-4 pl-[4.5rem]">
                  {r.key === "contacts" && (
                    <>
                      <div className="text-sm text-ink-500 mb-2">Filters <span className="text-xs">({filters.length ? "contacts that match any ticked" : "none ticked: everyone"})</span></div>
                      <div className="space-y-1.5 mb-4">
                        {FILTERS.map(([k, label]) => (
                          <label key={k} className="flex items-center gap-3 cursor-pointer py-1">
                            <input type="checkbox" className="w-5 h-5 rounded border-ink-300" checked={filters.includes(k)} onChange={() => setFilters((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))} />
                            <span className="text-[15px] text-ink-800">{label}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="text-sm text-ink-500 mb-2">Sequences <span className="text-xs">({chosen.length ? `${chosen.length} selected` : "none ticked: all sequences"})</span></div>
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-2">
                    {seqs.isLoading ? <div className="text-sm text-ink-400">Loading…</div> : !(seqs.data ?? []).length ? <div className="text-sm text-ink-400">No sequences yet</div> : (seqs.data ?? []).map((q) => {
                      const ticked = chosen.includes(q.id);
                      return (
                        <label key={q.id} className="flex items-center gap-3 cursor-pointer py-1">
                          <input type="checkbox" className="w-5 h-5 rounded border-ink-300" checked={ticked} onChange={() => setSeqs(r.key, ticked ? chosen.filter((x) => x !== q.id) : [...chosen, q.id])} />
                          <span className="text-[15px] text-ink-800 truncate">{q.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button className="btn-primary w-full h-12 mt-5 text-[15px]" disabled={!picked.length} onClick={download}>Download selected</button>
    </Modal>
  );
}
