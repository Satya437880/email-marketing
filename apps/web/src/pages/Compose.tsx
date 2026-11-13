import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Pencil, Plus, Search, Send, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Attachment, type Contact, type Mailbox, type Paged, type SequenceRow, type Tag } from "../api";
import { useWs } from "../App";
import { EmailEditor } from "../EmailEditor";
import { Empty, PageHeader, Spinner, useToast } from "../ui";

const MAX_RECIPIENTS = 25;

interface SendResult { contactId: string; email: string; status: "sent" | "skipped" | "failed"; reason?: string }

// Write and send an email by hand: pick recipients with filters, draft with the same editor sequences use, and send. No sequence is created.
export function ComposePage() {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [search, setSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [sequenceId, setSequenceId] = useState("");
  const [esp, setEsp] = useState("");
  const [picked, setPicked] = useState<Record<string, Contact>>({});
  const [mailboxId, setMailboxId] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");

  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const tags = useQuery({ queryKey: ["tags", ws], queryFn: () => api<Tag[]>(`/v1/workspaces/${ws}/tags`) });
  const seqs = useQuery({ queryKey: ["sequences", ws], queryFn: () => api<SequenceRow[]>(`/v1/workspaces/${ws}/sequences`) });
  const params = new URLSearchParams({ pageSize: "100", ...(search.trim() && { q: search.trim() }), ...(tagId && { tagId }), ...(sequenceId && { sequenceId }), ...(esp && { esp }) });
  const contacts = useQuery({ queryKey: ["contacts", ws, "compose", params.toString()], queryFn: () => api<Paged<Contact>>(`/v1/workspaces/${ws}/contacts?${params}`) });

  const active = (mailboxes.data ?? []).filter((m) => m.status === "active");
  useEffect(() => { if (!mailboxId && active[0]) setMailboxId(active[0].id); }, [active, mailboxId]);

  const list = contacts.data?.items ?? [];
  const chosen = Object.values(picked);
  const count = chosen.length;
  const toggle = (c: Contact) => setPicked((p) => {
    const next = { ...p };
    if (next[c.id]) delete next[c.id];
    else if (Object.keys(next).length >= MAX_RECIPIENTS) { toast(`You can send to ${MAX_RECIPIENTS} contacts at a time`, "error"); return p; }
    else next[c.id] = c;
    return next;
  });
  const selectShown = () => setPicked((p) => {
    const next = { ...p };
    for (const c of list) { if (Object.keys(next).length >= MAX_RECIPIENTS) break; next[c.id] = c; }
    return next;
  });

  // An address that is not in Contacts yet is saved as a contact (or matched if it already exists) and selected.
  const addEmail = useMutation({
    mutationFn: () => {
      const [first = "", ...rest] = newName.trim().split(/\s+/).filter(Boolean);
      return api<Contact>(`/v1/workspaces/${ws}/contacts`, { body: { email: newEmail.trim(), ...(first && { first_name: first }), ...(rest.length && { last_name: rest.join(" ") }) } });
    },
    onSuccess: (c) => {
      if (Object.keys(picked).length >= MAX_RECIPIENTS && !picked[c.id]) return toast(`You can send to ${MAX_RECIPIENTS} contacts at a time`, "error");
      setPicked((p) => ({ ...p, [c.id]: { ...c, tags: c.tags ?? [] } }));
      setNewEmail("");
      setNewName("");
      void qc.invalidateQueries({ queryKey: ["contacts", ws] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const send = useMutation({
    mutationFn: () => api<{ results: SendResult[]; sent: number }>(`/v1/workspaces/${ws}/emails/send`, { body: { mailboxId, contactIds: chosen.map((c) => c.id), subject, bodyHtml, attachments } }),
    onSuccess: (r) => {
      setResults(r.results);
      toast(r.sent ? `Sent ${r.sent} email${r.sent === 1 ? "" : "s"}` : "Nothing was sent", r.sent ? undefined : "error");
      for (const k of ["emails", "mailboxes", "contacts"]) void qc.invalidateQueries({ queryKey: [k, ws] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const ready = count > 0 && !!mailboxId && subject.trim() && bodyHtml.replace(/<[^>]+>/g, "").trim();
  const mailbox = active.find((m) => m.id === mailboxId);

  if (results) {
    const sent = results.filter((r) => r.status === "sent").length;
    return (
      <div>
        <PageHeader icon={<Pencil size={18} />} title="Compose email" />
        <div className="px-4 md:px-8 py-6 max-w-3xl">
          <div className="card p-5">
            <h2 className="font-semibold text-ink-900">{sent} of {results.length} sent</h2>
            <ul className="mt-3 divide-y divide-ink-100">
              {results.map((r) => (
                <li key={r.contactId} className="flex items-center gap-2.5 py-2 text-sm">
                  {r.status === "sent" ? <CheckCircle2 size={16} className="text-emerald-600 shrink-0" /> : <XCircle size={16} className={r.status === "failed" ? "text-red-600 shrink-0" : "text-amber-600 shrink-0"} />}
                  <span className="font-medium">{r.email}</span>
                  <span className="text-ink-500">{r.status === "sent" ? "Sent" : r.reason ?? r.status}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <button className="btn-primary" onClick={() => nav(`/${ws}/emails`)}>Back to emails</button>
              <button className="btn-secondary" onClick={() => { setResults(null); setPicked({}); setSubject(""); setBodyHtml(""); setAttachments([]); }}>Write another</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader icon={<Pencil size={18} />} title="Compose email"
        actions={<Link to={`/${ws}/emails`} className="btn-secondary"><ArrowLeft size={16} /> Back</Link>} />
      <div className="px-4 md:px-8 py-5 space-y-5 max-w-[1500px]">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-ink-900">1. Choose recipients <span className="text-ink-500 font-normal">({count} of {MAX_RECIPIENTS} selected)</span></h2>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={selectShown} disabled={!list.length}>Select first {MAX_RECIPIENTS} shown</button>
              <button className="btn-ghost btn-sm" onClick={() => setPicked({})} disabled={!count}>Clear</button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[14rem] max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" placeholder="Search name, email or company" aria-label="Search contacts" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="input w-auto" aria-label="Tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">All tags</option>
              {(tags.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="input w-auto" aria-label="Sequence" value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>
              <option value="">Any sequence</option>
              {(seqs.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select className="input w-auto" aria-label="Email provider" value={esp} onChange={(e) => setEsp(e.target.value)}>
              <option value="">Any provider</option>
              <option value="google">Google</option>
              <option value="microsoft">Microsoft</option>
              <option value="other">Other</option>
            </select>
          </div>
          <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) addEmail.mutate(); }}>
            <input className="input w-auto min-w-[15rem]" type="email" placeholder="Add an email address manually" aria-label="Email address to add" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="input w-auto min-w-[10rem]" placeholder="Name (optional)" aria-label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn-secondary" type="submit" disabled={!newEmail.trim() || addEmail.isPending}><Plus size={15} /> Add</button>
          </form>
          {count > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chosen.map((c) => (
                <button key={c.id} className="chip bg-brand-50 text-brand-700 hover:bg-brand-100" title="Remove" onClick={() => toggle(c)}>{c.email} ×</button>
              ))}
            </div>
          )}
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-ink-200">
            {contacts.isLoading ? <div className="py-8 grid place-items-center"><Spinner /></div> : !list.length ? (
              <Empty icon={<Search size={20} />} title="No contacts match" text="Change the filters, or import contacts first." />
            ) : list.map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm border-b border-ink-100 last:border-0 hover:bg-ink-50 cursor-pointer">
                <input type="checkbox" checked={!!picked[c.id]} onChange={() => toggle(c)} />
                <span className="font-medium text-ink-900 min-w-[10rem]">{`${c.firstName} ${c.lastName}`.trim() || "—"}</span>
                <span className="text-ink-600">{c.email}</span>
                <span className="text-ink-400 truncate">{c.companyName}</span>
                {c.unsubscribedAt && <span className="chip bg-amber-50 text-amber-700 ml-auto">Unsubscribed</span>}
              </label>
            ))}
          </div>
          {!!contacts.data && contacts.data.total > list.length && <p className="mt-2 text-xs text-ink-500">Showing the first {list.length} of {contacts.data.total}. Narrow the filters to find the rest.</p>}
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 pt-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-ink-900">2. Write your email</h2>
            <label className="flex items-center gap-2 text-sm text-ink-600">From
              <select className="input w-auto" aria-label="Send from" value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
                {!active.length && <option value="">No active mailbox</option>}
                {active.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            </label>
          </div>
          {!mailboxes.isLoading && !active.length && (
            <p className="px-5 pt-3 text-sm text-amber-700">Connect a mailbox first in <Link className="underline" to={`/${ws}/senders`}>Senders &amp; Mailboxes</Link>.</p>
          )}
          <div className="mt-3">
            <EmailEditor
              embedded
              stepName=""
              onStepName={() => undefined}
              subject={subject}
              onSubject={setSubject}
              bodyHtml={bodyHtml}
              onBody={setBodyHtml}
              editorKey="compose"
              attachments={attachments}
              onAttachments={setAttachments}
              subjectPlaceholder="Enter your subject here"
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary h-11 px-6" disabled={!ready || send.isPending} onClick={() => { if (confirm(`Send this email to ${count} contact${count === 1 ? "" : "s"} from ${mailbox?.email}?`)) send.mutate(); }}>
            <Send size={16} /> {send.isPending ? "Sending…" : `Send to ${count || "…"} contact${count === 1 ? "" : "s"}`}
          </button>
          <p className="text-xs text-ink-500">Sent now from the chosen mailbox. Unsubscribed, do-not-contact and invalid addresses are skipped, and the mailbox's daily limit applies.</p>
        </div>
      </div>
    </div>
  );
}
