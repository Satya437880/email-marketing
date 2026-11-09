import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bold, Braces, ChevronDown, Code, Image as ImageIcon, LayoutTemplate, Link as LinkIcon, Mail, Redo2, Send, TableProperties, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Mailbox } from "./api";
import { useWs } from "./App";
import { cx, Modal, useToast } from "./ui";

export const VARIABLES = [
  { v: "first_name", l: "First name" }, { v: "last_name", l: "Last name" }, { v: "company", l: "Company" },
  { v: "title", l: "Job title" }, { v: "sender_first_name", l: "Sender first name" }, { v: "sender_name", l: "Sender full name" },
];

interface Template { id: string; name: string; subject: string; bodyHtml: string; kind: string }
interface SpamReport { score: number; issues: { code: string; message: string }[] }

function Dropdown({ label, icon, children, align = "left" }: { label: ReactNode; icon?: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex items-center gap-1.5 rounded-md px-2 h-8 text-sm font-medium text-ink-600 hover:bg-ink-100 whitespace-nowrap" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}{label}
      </button>
      {open && <div className={cx("absolute top-9 z-30 w-56 card p-1 max-h-72 overflow-y-auto", align === "right" ? "right-0" : "left-0")}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

const menuItem = "w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50";

function ToolButton({ title, onClick, children, active }: { title: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} className={cx("grid place-items-center w-8 h-8 rounded-md text-ink-600 hover:bg-ink-100", active && "bg-ink-100 text-ink-900")}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  );
}

function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  const v = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Rich-text area with Variables, bold, link, image, HTML source, undo/redo and a word count.
// Content is loaded into the editable element only when editorKey changes, so typing never resets the caret.
export function RichBody({ html, onChange, editorKey, variables, placeholder, toolbarStart, minHeight = 260 }: {
  html: string; onChange: (html: string) => void; editorKey: string; variables: { v: string; l: string }[];
  placeholder?: string; toolbarStart?: ReactNode; minHeight?: number;
}) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, source]);

  const sync = () => ref.current && onChange(ref.current.innerHTML);
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, value);
    sync();
  };
  const insertVar = (v: string) => (source ? onChange(`${html}{{${v}}}`) : exec("insertText", `{{${v}}}`));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
  const words = text ? text.split(/\s+/).length : 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-ink-100">
        {toolbarStart}
        <Dropdown label="Variables" icon={<Braces size={15} />}>
          {(close) => variables.map((x) => (
            <button key={x.v} className={menuItem} onClick={() => { insertVar(x.v); close(); }}>{x.l} <span className="text-ink-400 text-xs">{`{{${x.v}}}`}</span></button>
          ))}
        </Dropdown>
        <span className="w-px h-5 bg-ink-200 mx-1" />
        <ToolButton title="Bold" onClick={() => exec("bold")}><Bold size={16} /></ToolButton>
        <ToolButton title="Insert link" onClick={() => {
          const url = safeUrl(prompt("Link URL"));
          if (url) exec("createLink", url);
          else toast("Enter a valid http(s) link", "error");
        }}><LinkIcon size={16} /></ToolButton>
        <ToolButton title="Insert image (hurts cold-email deliverability)" onClick={() => {
          const url = safeUrl(prompt("Image URL (images can hurt deliverability in cold email)"));
          if (url) exec("insertImage", url);
        }}><ImageIcon size={16} /></ToolButton>
        <ToolButton title="Edit HTML" active={source} onClick={() => setSource((s) => !s)}><Code size={16} /></ToolButton>
        <span className="w-px h-5 bg-ink-200 mx-1" />
        <ToolButton title="Undo" onClick={() => exec("undo")}><Undo2 size={16} /></ToolButton>
        <ToolButton title="Redo" onClick={() => exec("redo")}><Redo2 size={16} /></ToolButton>
      </div>
      <div className="relative">
        {source ? (
          <textarea className="w-full p-5 font-mono text-xs bg-transparent focus:outline-none" style={{ minHeight }} value={html} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            className="p-5 pb-10 text-[15px] leading-relaxed focus:outline-none prose-mail empty:before:content-[attr(data-placeholder)] empty:before:text-ink-400"
            style={{ minHeight }}
            data-placeholder={placeholder}
            onInput={sync}
            onBlur={sync}
            onPaste={(e) => {
              // Paste as plain text so formatting from other apps doesn't bloat the email.
              e.preventDefault();
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              sync();
            }}
          />
        )}
        <span className="absolute right-4 bottom-3 chip bg-ink-100 text-ink-600 pointer-events-none">{words} words</span>
      </div>
    </>
  );
}

export interface EmailEditorProps {
  stepName: string;
  onStepName: (v: string) => void;
  subject: string;
  onSubject: (v: string) => void;
  bodyHtml: string;
  onBody: (html: string) => void;
  subjectPlaceholder?: string;
  editorKey: string;
}

// Subject + rich-text body editor with variables, templates, spam check, preview send and save-as-template.
export function EmailEditor({ stepName, onStepName, subject, onSubject, bodyHtml, onBody, subjectPlaceholder, editorKey }: EmailEditorProps) {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const subjectRef = useRef<HTMLInputElement>(null);
  const [spam, setSpam] = useState<SpamReport | null>(null);
  const [showSpam, setShowSpam] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saveTpl, setSaveTpl] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api<SpamReport>(`/v1/workspaces/${ws}/spam-check`, { body: { subject, bodyHtml } }).then(setSpam).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [subject, bodyHtml, ws]);

  const templates = useQuery({ queryKey: ["templates", ws], queryFn: () => api<Template[]>(`/v1/workspaces/${ws}/templates`) });

  const [templateLoads, setTemplateLoads] = useState(0);
  const insertSubjectVar = (v: string) => {
    const el = subjectRef.current;
    const token = `{{${v}}}`;
    if (!el) return onSubject(subject + token);
    const start = el.selectionStart ?? subject.length;
    const end = el.selectionEnd ?? subject.length;
    onSubject(subject.slice(0, start) + token + subject.slice(end));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const meter = spam ? (spam.score >= 80 ? "bg-emerald-500" : spam.score >= 60 ? "bg-amber-500" : "bg-red-500") : "bg-ink-200";

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4 border-b border-ink-100">
        <span className="grid place-items-center w-12 h-12 rounded-xl border border-ink-200"><Mail size={20} /></span>
        <input className="flex-1 min-w-0 bg-transparent text-lg font-semibold focus:outline-none" value={stepName} onChange={(e) => onStepName(e.target.value)} placeholder="Step name" />
      </div>

      <div className="flex items-center gap-2 px-2 border-b border-ink-100">
        <input ref={subjectRef} className="flex-1 min-w-0 h-12 bg-transparent px-3 text-[15px] focus:outline-none placeholder:text-ink-400"
          value={subject} onChange={(e) => onSubject(e.target.value)} placeholder={subjectPlaceholder ?? "Enter your subject here (Tip: 2 words are the best for deliverability)"} />
        <Dropdown label={<>Subject variables <ChevronDown size={15} /></>} icon={<Braces size={15} />} align="right">
          {(close) => VARIABLES.map((x) => <button key={x.v} className={menuItem} onClick={() => { insertSubjectVar(x.v); close(); }}>{x.l} <span className="text-ink-400 text-xs">{`{{${x.v}}}`}</span></button>)}
        </Dropdown>
      </div>

      <RichBody
        html={bodyHtml}
        onChange={onBody}
        editorKey={`${editorKey}:${templateLoads}`}
        variables={[...VARIABLES, { v: "Hi|Hello|Hey", l: "Spintax greeting" }]}
        placeholder="Write your email… use Variables to personalise it."
        toolbarStart={
          <Dropdown label="Templates" icon={<LayoutTemplate size={15} />}>
            {(close) => {
              const list = (templates.data ?? []).filter((t) => t.kind === "sequence");
              return list.length ? list.map((t) => (
                <button key={t.id} className={menuItem} onClick={() => {
                  if (bodyHtml.trim() && !confirm(`Replace this email with the template "${t.name}"?`)) return;
                  if (t.subject) onSubject(t.subject);
                  onBody(t.bodyHtml);
                  setTemplateLoads((n) => n + 1);
                  close();
                }}>{t.name}</button>
              )) : <div className="px-2.5 py-2 text-sm text-ink-500">No templates yet. Write an email and click “Save as template”.</div>;
            }}
          </Dropdown>
        }
      />

      <div className="flex flex-wrap gap-3 px-5 py-4 border-t border-ink-100">
        <button className="btn-secondary h-11 px-4" onClick={() => setShowSpam(true)}>
          <AlertTriangle size={17} /> Spam check
          <span className="w-12 h-1.5 rounded-full bg-ink-100 overflow-hidden"><span className={cx("block h-full", meter)} style={{ width: `${spam?.score ?? 0}%` }} /></span>
        </button>
        <button className="btn-secondary h-11 px-4" onClick={() => setPreview(true)}><Send size={17} /> Send preview email</button>
        <button className="btn-secondary h-11 px-4" onClick={() => setSaveTpl(true)} disabled={!bodyHtml.trim()}><TableProperties size={17} /> Save as template</button>
      </div>

      {showSpam && (
        <Modal open onClose={() => setShowSpam(false)} title={`Spam check: ${spam?.score ?? "–"} / 100`} footer={<button className="btn-primary" onClick={() => setShowSpam(false)}>Close</button>}>
          {spam?.issues.length
            ? <ul className="space-y-1.5 text-sm">{spam.issues.map((i) => <li key={i.code} className="flex gap-2"><AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />{i.message}</li>)}</ul>
            : <p className="text-sm">No problems found. Short, plain, personal emails land best.</p>}
        </Modal>
      )}
      {preview && <PreviewModal ws={ws} subject={subject} bodyHtml={bodyHtml} onClose={() => setPreview(false)} />}
      {saveTpl && <SaveTemplateModal ws={ws} subject={subject} bodyHtml={bodyHtml} onClose={() => setSaveTpl(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["templates", ws] })} />}
    </div>
  );
}

function PreviewModal({ ws, subject, bodyHtml, onClose }: { ws: string; subject: string; bodyHtml: string; onClose: () => void }) {
  const toast = useToast();
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const [to, setTo] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/send-test`, { body: { mailboxId: mailboxId || mailboxes.data?.[0]?.id, to, subject: subject || "(follow-up)", bodyHtml } }),
    onSuccess: () => { toast(`Preview sent to ${to}`); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title="Send preview email" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!to || !mailboxes.data?.length || send.isPending} onClick={() => send.mutate()}>{send.isPending ? "Sending…" : "Send"}</button>
    </>}>
      {!mailboxes.data?.length ? <p className="text-sm">Connect a mailbox first to send previews.</p> : (
        <div className="space-y-3">
          <div><label className="label">Send to</label><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus placeholder="you@company.com" /></div>
          <div><label className="label">Send from</label>
            <select className="input" value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>{mailboxes.data.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}</select>
          </div>
          <p className="text-xs text-ink-500">Variables are filled from the contact with this email if one exists, otherwise with sample values. The subject is prefixed with [Test].</p>
        </div>
      )}
    </Modal>
  );
}

function SaveTemplateModal({ ws, subject, bodyHtml, onClose, onSaved }: { ws: string; subject: string; bodyHtml: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/templates`, { body: { name, subject, bodyHtml, kind: "sequence" } }),
    onSuccess: () => { toast("Template saved"); onSaved(); onClose(); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  return (
    <Modal open onClose={onClose} title="Save as template" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!name.trim()} onClick={() => save.mutate()}>Save</button>
    </>}>
      <label className="label">Template name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Soft follow-up" onKeyDown={(e) => e.key === "Enter" && name.trim() && save.mutate()} />
    </Modal>
  );
}
