import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Mail, Pencil, Search, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useWs } from "../App";
import { cx, Empty, fmtDate, fmtInZone, PageHeader, Pager, Spinner, Tab, useDebounced, useToast } from "../ui";

interface EmailItem {
  id: string;
  kind: "scheduled" | "sent";
  status: "scheduled" | "paused" | "sent";
  at: string | null;
  timezone: string | null;
  contactId: string | null;
  email: string;
  name: string;
  sequenceId: string | null;
  sequenceName: string | null;
  step: number | null;
  steps: number | null;
  subject: string;
  snippet: string;
  canSendNow: boolean;
}
interface EmailList { items: EmailItem[]; total: number; scheduled: number }

const PAGE_SIZE = 50;
const STATUS_STYLE: Record<EmailItem["status"], string> = {
  scheduled: "bg-sky-50 text-sky-700",
  paused: "bg-amber-50 text-amber-700",
  sent: "bg-emerald-50 text-emerald-700",
};
const STATUS_LABEL: Record<EmailItem["status"], string> = { scheduled: "Scheduled", paused: "Paused", sent: "Sent" };

function SendTime({ m }: { m: EmailItem }) {
  // Scheduled emails always show in their sequence's time zone, whatever zone this computer is set to.
  return <div>{m.kind === "scheduled" && m.timezone ? fmtInZone(m.at, m.timezone) : fmtDate(m.at, true)}</div>;
}

export function EmailsPage() {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"all" | "scheduled" | "sent">("all");
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed);
  const [page, setPage] = useState(1);

  const list = useQuery({
    queryKey: ["emails", ws, tab, search, page],
    queryFn: () => api<EmailList>(`/v1/workspaces/${ws}/emails?status=${tab}&page=${page}&pageSize=${PAGE_SIZE}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`),
    refetchInterval: 30000,
  });

  const sendNow = useMutation({
    mutationFn: (id: string) => api(`/v1/workspaces/${ws}/emails/${id}/send-now`, { method: "POST", body: {} }),
    onSuccess: () => { toast("Moved to the front of the queue. It goes out on the next send run."); void qc.invalidateQueries({ queryKey: ["emails", ws] }); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const pick = (t: typeof tab) => { setTab(t); setPage(1); };
  const items = list.data?.items ?? [];

  return (
    <div>
      <PageHeader icon={<Mail size={18} />} title="Emails" actions={<Link to={`/${ws}/emails/compose`} className="btn-primary"><Pencil size={16} /> Compose</Link>}>
        <Tab active={tab === "all"} onClick={() => pick("all")}>All emails</Tab>
        <Tab active={tab === "scheduled"} onClick={() => pick("scheduled")}>Scheduled{list.data && tab !== "sent" ? ` (${list.data.scheduled})` : ""}</Tab>
        <Tab active={tab === "sent"} onClick={() => pick("sent")}>Sent</Tab>
      </PageHeader>

      <div className="px-4 md:px-8 py-4">
        <div className="relative max-w-sm mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Search emails" aria-label="Search emails" value={typed} onChange={(e) => { setTyped(e.target.value); setPage(1); }} />
        </div>

        <div className="card overflow-x-auto">
          {list.isLoading ? <div className="py-16 grid place-items-center"><Spinner /></div> : !items.length ? (
            <Empty icon={<Mail size={20} />} title={tab === "scheduled" ? "Nothing scheduled" : tab === "sent" ? "No emails sent yet" : "No emails yet"}
              text="Emails appear here once a sequence has contacts. Scheduled ones show when they will go out, and you can send them early." />
          ) : (
            <table className="w-full min-w-[860px]">
              <thead>
                <tr><th className="th">Recipient</th><th className="th">Status</th><th className="th">Date</th><th className="th">Sequence</th><th className="th">Message</th><th className="th text-right">Actions</th></tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={`${m.kind}-${m.id}`} className="hover:bg-ink-50/60">
                    <td className="td">
                      <div className="font-medium text-ink-900">{m.name || m.email}</div>
                      {m.name && <div className="text-xs text-ink-500">{m.email}</div>}
                    </td>
                    <td className="td"><span className={cx("chip", STATUS_STYLE[m.status])}>{STATUS_LABEL[m.status]}</span></td>
                    <td className="td whitespace-nowrap">
                      <SendTime m={m} />
                      <div className="text-xs text-ink-500">{m.kind === "scheduled" ? "Goes out" : "Sent"}</div>
                    </td>
                    <td className="td">
                      {m.sequenceId ? <Link className="underline decoration-ink-300 hover:decoration-ink-700" to={`/${ws}/sequences/${m.sequenceId}`}>{m.step && m.steps ? `Step ${m.step} of ${m.steps}` : "Sequence"} · {m.sequenceName}</Link> : <span className="text-ink-400">Manual</span>}
                    </td>
                    <td className="td max-w-md">
                      <div className="font-medium text-ink-900 truncate">{m.subject || "(no subject)"}</div>
                      <div className="text-xs text-ink-500 truncate">{m.snippet}</div>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      {m.kind === "scheduled" && (
                        <button className="btn-secondary btn-sm" disabled={!m.canSendNow || sendNow.isPending} title={m.canSendNow ? "Send this email as soon as possible" : "Resume the sequence to send"}
                          onClick={() => { if (confirm(`Send this email to ${m.email} now?`)) sendNow.mutate(m.id); }}>
                          <Send size={14} /> Send now
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!!list.data?.total && <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />}
        </div>
        {tab !== "sent" && <p className="mt-3 text-xs text-ink-500 flex items-center gap-1.5"><Clock size={13} /> "Send now" moves an email to the front of the queue. It still follows your sending window and mailbox daily limits.</p>}
      </div>
    </div>
  );
}
