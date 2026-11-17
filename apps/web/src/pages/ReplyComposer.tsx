import { useMutation, useQuery } from "@tanstack/react-query";
import { BellPlus, Braces, ChevronDown, LayoutTemplate, Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Attachment, type Message } from "../api";
import { useWs } from "../App";
import { RichBody, VARIABLES } from "../EmailEditor";
import { Avatar, cx, useToast } from "../ui";

interface ReplyInfo {
  to: string;
  defaultMailboxId: string;
  mailboxes: { id: string; email: string; fromName: string; signatureHtml: string }[];
}
interface ReplyTemplate { id: string; name: string; subject: string; bodyHtml: string; kind: "sequence" | "reply" }

const emails = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTACH_MAX = 10 * 1024 * 1024;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// The reply text is HTML with two marked blocks the app manages: the signature and the quoted thread history.
function parts(html: string) {
  const box = document.createElement("div");
  box.innerHTML = html;
  return box;
}
const signatureBlock = (sig: string) => (sig.trim() ? `<div data-signature="1">${sig}</div>` : "");
function swapSignature(html: string, sig: string): string {
  const box = parts(html);
  const old = box.querySelector("[data-signature]");
  const fresh = signatureBlock(sig);
  if (old) { if (fresh) old.outerHTML = fresh; else old.remove(); return box.innerHTML; }
  const hist = box.querySelector("[data-history]");
  if (hist) { hist.insertAdjacentHTML("beforebegin", fresh); return box.innerHTML; }
  return box.innerHTML + fresh;
}
function setHistory(html: string, history: string): string {
  const box = parts(html);
  box.querySelector("[data-history]")?.remove();
  return box.innerHTML + history;
}
// What the person actually typed, without the signature and the quoted history.
function typedText(html: string): string {
  const box = parts(html);
  box.querySelectorAll("[data-signature], [data-history]").forEach((n) => n.remove());
  return (box.textContent ?? "").replace(/\s+/g, " ").trim();
}

// The previous email as a quote, the way an email program shows it under a reply. The old opt-out line and tracking pixel are left out.
function historyBlock(messages: Message[]): string {
  const last = messages[messages.length - 1];
  if (!last) return "";
  const raw = last.bodyHtml?.trim()
    ? last.bodyHtml
      .replace(/^[\s\S]*?line-height:1\.5">/i, "")
      .replace(/<\/div><\/body><\/html>\s*$/i, "")
      .replace(/<div style="margin:0;padding:0;font-size:10px[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<img[^>]*display:none[^>]*>/gi, "")
    : `<pre>${esc(last.bodyText ?? "")}</pre>`;
  const when = new Date(last.sentAt).toUTCString();
  return `<div data-history="1"><div><br></div><div>On ${esc(when)}, ${esc(last.fromName || last.fromAddress)} wrote:</div><blockquote style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${raw}</blockquote></div>`;
}

const readBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

// The reply box in Primebox: recipient with CC/BCC, a formatting toolbar, saved templates, the sender's signature already in the text,
// the quoted thread history, variables, attachments and "Send via <mailbox>".
export function ReplyComposer({ threadId, messages, onClose, onSent, onReminder }: { threadId: string; messages: Message[]; onClose: () => void; onSent: () => void; onReminder: () => void }) {
  const ws = useWs();
  const toast = useToast();
  const info = useQuery({ queryKey: ["reply-info", ws, threadId], queryFn: () => api<ReplyInfo>(`/v1/workspaces/${ws}/threads/${threadId}/reply-info`) });
  const templates = useQuery({ queryKey: ["reply-templates", ws], queryFn: () => api<ReplyTemplate[]>(`/v1/workspaces/${ws}/templates`) });
  const [html, setHtml] = useState("");
  const [editorKey, setEditorKey] = useState("start");
  const [mailboxId, setMailboxId] = useState("");
  const [history, setHistoryOn] = useState(true);
  const [showCc, setShowCc] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [varOpen, setVarOpen] = useState(false);
  const [tpl2Open, setTpl2Open] = useState(false);
  const tpl2Ref = useRef<HTMLDivElement>(null);
  const varRef = useRef<HTMLDivElement>(null);
  const insertRef = useRef<((text: string) => void) | null>(null);
  const [fromOpen, setFromOpen] = useState(false);
  const tplRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const quote = useMemo(() => historyBlock(messages), [messages]);

  const boxes = info.data?.mailboxes ?? [];
  const mailbox = boxes.find((m) => m.id === mailboxId);

  // Once the mailbox details arrive, start the text with a blank line, the sender's signature and the quoted thread, so the reply is ready to type into.
  useEffect(() => {
    if (!info.data || started.current) return;
    started.current = true;
    const mb = info.data.mailboxes.find((m) => m.id === info.data.defaultMailboxId) ?? info.data.mailboxes[0];
    setMailboxId(mb?.id ?? "");
    setHtml(`<div><br></div><div><br></div>${signatureBlock(mb?.signatureHtml ?? "")}${quote}`);
    setEditorKey("ready");
  }, [info.data, quote]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!tplRef.current?.contains(e.target as Node)) setTplOpen(false);
      if (!varRef.current?.contains(e.target as Node)) setVarOpen(false);
      if (!tpl2Ref.current?.contains(e.target as Node)) setTpl2Open(false);
      if (!fromRef.current?.contains(e.target as Node)) setFromOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const pickMailbox = (id: string) => {
    const next = boxes.find((m) => m.id === id);
    setMailboxId(id);
    setFromOpen(false);
    if (!next) return;
    setHtml((h) => swapSignature(h, next.signatureHtml));
    setEditorKey(`mb-${id}-${Date.now()}`);
  };

  const toggleHistory = (on: boolean) => {
    setHistoryOn(on);
    setHtml((h) => setHistory(h, on ? quote : ""));
    setEditorKey(`hist-${on}-${Date.now()}`);
  };

  const insertTemplate = (t: ReplyTemplate) => {
    const box = parts(html);
    const anchor = box.querySelector("[data-signature]") ?? box.querySelector("[data-history]");
    if (anchor) anchor.insertAdjacentHTML("beforebegin", `${t.bodyHtml}<div><br></div>`); else box.insertAdjacentHTML("beforeend", t.bodyHtml);
    setHtml(box.innerHTML);
    setEditorKey(`tpl-${t.id}-${Date.now()}`);
    setTplOpen(false);
    setTpl2Open(false);
  };

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= 5) { toast("Up to 5 files per email", "error"); break; }
      if (next.reduce((t, a) => t + a.size, 0) + f.size > ATTACH_MAX) { toast(`${f.name} would take attachments over 10 MB`, "error"); continue; }
      next.push({ name: f.name, type: f.type || "application/octet-stream", size: f.size, data: await readBase64(f) });
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const typed = useMemo(() => typedText(html), [html]);
  const words = typed ? typed.split(/\s+/).length : 0;
  const ccList = emails(cc);
  const bccList = emails(bcc);
  const badAddress = [...ccList, ...bccList].find((a) => !EMAIL_OK.test(a));

  const send = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/threads/${threadId}/reply`, {
      // The signature and the quoted thread are already in the text, so the server adds neither.
      body: {
        bodyHtml: html, includeHistory: false, signatureIncluded: true, mailboxId: mailboxId || undefined,
        ...(ccList.length ? { cc: ccList } : {}), ...(bccList.length ? { bcc: bccList } : {}),
        ...(files.length ? { attachments: files.map((f) => ({ name: f.name, type: f.type, data: f.data })) } : {}),
      },
    }),
    onSuccess: () => { toast("Reply sent"); onSent(); },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const iconBtn = "grid place-items-center w-9 h-9 rounded-md text-ink-600 hover:bg-ink-100";
  const replyTemplates = (templates.data ?? []).filter((t) => t.kind === "reply");
  const templateMenu = (up: boolean) => (
    <div className={cx("absolute left-0 z-30 w-64 card p-1 max-h-60 overflow-y-auto shadow-lg", up ? "bottom-full mb-1" : "top-full mt-1")}>
      {replyTemplates.length === 0
        ? <div className="px-3 py-3 text-sm text-ink-500">No saved reply templates yet.</div>
        : replyTemplates.map((t) => (
          <button key={t.id} className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50 truncate" onClick={() => insertTemplate(t)}>{t.name}</button>
        ))}
    </div>
  );

  return (
    <div className="border-t border-ink-200 bg-ink-50/60 p-3">
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-ink-50 border-b border-ink-100">
          <span className="text-sm font-semibold text-ink-600">Email</span>
          <button className="btn-ghost btn-sm" aria-label="Close the reply box" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-ink-100 text-sm">
          <span className="text-ink-600">To:</span>
          {info.data?.to && <span className="chip bg-brand-50 text-brand-700 border border-brand-200 py-1">{info.data.to}</span>}
          <span className="ml-auto flex items-center gap-3 text-ink-500">
            {!showCc && <button className="hover:text-ink-900" onClick={() => setShowCc(true)}>CC</button>}
            {!showCc && <button className="hover:text-ink-900" onClick={() => setShowCc(true)}>BCC</button>}
          </span>
        </div>
        {showCc && (
          <div className="grid sm:grid-cols-2 gap-2 px-4 py-2.5 border-b border-ink-100">
            <input className="input h-9" placeholder="CC: name@company.com" value={cc} onChange={(e) => setCc(e.target.value)} />
            <input className="input h-9" placeholder="BCC: name@company.com" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </div>
        )}

        <div className="relative max-h-[46vh] overflow-y-auto">
          <RichBody
            html={html}
            onChange={setHtml}
            editorKey={editorKey}
            variables={VARIABLES}
            hideVariables
            replyBar
            insertRef={insertRef}
            minHeight={170}
            toolbarPosition="top"
            placeholder="Write your reply…"
            toolbarStart={
              <>
                <div className="relative" ref={tplRef}>
                  <button type="button" className="inline-flex items-center gap-2 h-8 px-2 rounded-md text-sm font-semibold text-ink-700 hover:bg-ink-100" onClick={() => setTplOpen((o) => !o)}>
                    <LayoutTemplate size={16} /> Templates
                  </button>
                  {tplOpen && templateMenu(false)}
                </div>
                <span className="w-px h-5 bg-ink-200 mx-1" />
              </>
            }
          />
          <span className="sticky float-right bottom-2 mr-3 mb-2 rounded-full border border-ink-200 bg-surface px-2.5 py-0.5 text-xs text-ink-600 shadow-sm">{words} word{words === 1 ? "" : "s"}</span>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-ink-100">
            {files.map((f, i) => (
              <span key={i} className="chip bg-ink-100 text-ink-700"><Paperclip size={12} /> {f.name} <span className="text-ink-400">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <button aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><X size={12} /></button></span>
            ))}
          </div>
        )}

        <label className="flex items-center gap-3 px-4 py-3 border-t border-ink-100 text-sm text-ink-700">
          <input type="checkbox" className="w-5 h-5 rounded" checked={history} onChange={(e) => toggleHistory(e.target.checked)} /> Include thread history
        </label>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4">
          <div className="relative mr-2" ref={fromRef}>
            <div className="flex">
              <button className="btn-primary h-11 rounded-r-none gap-2 font-semibold" disabled={send.isPending || !typed || !mailbox || !!badAddress}
                title={!typed ? "Write your reply first" : badAddress ? `Fix the address: ${badAddress}` : undefined} onClick={() => send.mutate()}>
                {send.isPending ? "Sending…" : <>Send via {mailbox && <Avatar name={mailbox.fromName || mailbox.email} size={24} />} {(mailbox?.fromName || mailbox?.email.split("@")[0] || "").split(" ")[0]}</>}
              </button>
              <button className="btn-primary h-11 rounded-l-none border-l border-white/30 px-2" aria-label="Choose the mailbox to send from" disabled={boxes.length < 2} onClick={() => setFromOpen((o) => !o)}><ChevronDown size={16} /></button>
            </div>
            {fromOpen && (
              <div className="absolute left-0 bottom-full mb-1 z-30 w-72 card p-1 max-h-60 overflow-y-auto shadow-lg">
                {boxes.map((m) => (
                  <button key={m.id} className={cx("w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50", m.id === mailboxId && "bg-brand-50 text-brand-800")} onClick={() => pickMailbox(m.id)}>
                    <div className="font-medium truncate">{m.fromName || m.email}</div>
                    <div className="text-xs text-ink-500 truncate">{m.email}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={iconBtn} title="Set a reminder" aria-label="Set a reminder" onClick={onReminder}><BellPlus size={20} /></button>
          <div className="relative" ref={tpl2Ref}>
            <button type="button" className={iconBtn} title="Templates" aria-label="Templates" onClick={() => setTpl2Open((o) => !o)}><LayoutTemplate size={20} /></button>
            {tpl2Open && templateMenu(true)}
          </div>
          <div className="relative" ref={varRef}>
            <button type="button" className={iconBtn} title="Variables" aria-label="Variables" onMouseDown={(e) => e.preventDefault()} onClick={() => setVarOpen((o) => !o)}><Braces size={20} /></button>
            {varOpen && (
              <div className="absolute left-0 bottom-full mb-1 z-30 w-56 card p-1 shadow-lg">
                {VARIABLES.map((x) => (
                  <button key={x.v} className="w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-ink-50" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { insertRef.current?.(`{{${x.v}}}`); setVarOpen(false); }}>{x.l} <span className="text-ink-400 text-xs">{`{{${x.v}}}`}</span></button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className={cx(iconBtn, "relative")} title="Attach files (up to 5, 10 MB in total)" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
            <Paperclip size={20} />{files.length > 0 && <span className="absolute -top-1 -right-1 chip bg-brand-600 text-white px-1 py-0 text-[10px]">{files.length}</span>}
          </button>
          {badAddress && <span className="text-xs text-red-600 ml-2">"{badAddress}" is not a valid email address</span>}
        </div>
      </div>
    </div>
  );
}
