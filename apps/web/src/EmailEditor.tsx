import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, AlignCenter, AlignLeft, AlignRight, Bold, Braces, ChevronDown, Code, Image as ImageIcon, Italic, LayoutTemplate, Link as LinkIcon, Mail, Monitor, Paperclip, Redo2, RefreshCw, Send, Smartphone, Smile, Strikethrough, TableProperties, Trash2, Type, Underline, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Attachment, type Contact, type Mailbox, type Paged, type ThreadMode } from "./api";
import { useWs } from "./App";
import { cx, Modal, SafeHtml, useToast } from "./ui";

export const VARIABLES = [
  { v: "first_name", l: "First name" }, { v: "last_name", l: "Last name" }, { v: "company", l: "Company" },
  { v: "title", l: "Job title" }, { v: "sender_first_name", l: "Sender first name" }, { v: "sender_name", l: "Sender full name" },
];

export const SUBJECT_VARIABLES = [
  "first_name", "last_name", "email", "sender_first_name", "sender_full_name", "mailbox_domain", "company", "sequence_name",
  "weekday_today", "weekday_yesterday", "weekday_tomorrow", "weekday+2", "weekday+3", "weekday+4", "weekday+5",
  "data_list", "industry", "Company Name", "Industry",
];

interface Template { id: string; name: string; subject: string; bodyHtml: string; kind: string }
interface SpamMetrics { spamWords: number; personalisationPct: number; links: number; images: number; emojis: number; words: number }
interface SpamReport { score: number; issues: { code: string; message: string }[]; metrics?: SpamMetrics }

function Dropdown({ label, icon, children, align = "left", className, up }: { label: ReactNode; icon?: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; className?: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className={cx("relative", className)} ref={ref}>
      <button type="button" className="flex items-center gap-1.5 rounded-md px-2 h-8 text-sm font-medium text-ink-600 hover:bg-ink-100 whitespace-nowrap" title={typeof label === "string" ? label : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        {icon}<span className="dd-label">{label}</span>
      </button>
      {open && <div className={cx("absolute z-30 w-56 card p-1 max-h-72 overflow-y-auto", up ? "bottom-full mb-1" : "top-9", align === "right" ? "right-0" : "left-0")}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

// Email-safe fonts (they fall back sensibly in every mail app) and the 1-7 sizes the browser editor supports.
const FONTS: [string, string][] = [
  ["Sans Serif", "Arial, Helvetica, sans-serif"], ["Arial", "Arial, sans-serif"], ["Helvetica", "Helvetica, Arial, sans-serif"],
  ["Verdana", "Verdana, Geneva, sans-serif"], ["Tahoma", "Tahoma, Geneva, sans-serif"], ["Trebuchet MS", "'Trebuchet MS', sans-serif"],
  ["Calibri", "Calibri, Candara, sans-serif"], ["Segoe UI", "'Segoe UI', Tahoma, sans-serif"], ["Roboto", "Roboto, Arial, sans-serif"],
  ["Open Sans", "'Open Sans', Arial, sans-serif"], ["Lato", "Lato, Arial, sans-serif"], ["Georgia", "Georgia, serif"],
  ["Times New Roman", "'Times New Roman', Times, serif"], ["Garamond", "Garamond, serif"], ["Palatino", "'Palatino Linotype', Palatino, serif"],
  ["Cambria", "Cambria, Georgia, serif"], ["Courier New", "'Courier New', Courier, monospace"], ["Lucida Console", "'Lucida Console', Monaco, monospace"],
  ["Comic Sans MS", "'Comic Sans MS', cursive, sans-serif"], ["Impact", "Impact, Charcoal, sans-serif"],
];
// Point sizes, like Word and Outlook.
const SIZES = ["8", "9", "10", "10.5", "11", "12", "14", "16", "18", "20", "24", "28", "36"];

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

const EMOJIS = ["😀", "😃", "😄", "😁", "😊", "🙂", "😉", "😍", "🤝", "👍", "👋", "🙏", "👏", "🎉", "🔥", "💡", "✅", "⭐", "📅", "📞", "📧", "💬", "🚀", "💼", "😅", "🤔", "😎", "🙌", "❤️", "👌", "✨", "📎"];

// A small popover that opens under its button and closes on an outside click.
function Pop({ button, children }: { button: (toggle: () => void, open: boolean) => ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div className="relative" ref={box} onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
      {button(() => setOpen((o) => !o), open)}
      {open && <div className="absolute left-0 top-full mt-1 z-30 card shadow-lg">{children(() => setOpen(false))}</div>}
    </div>
  );
}

function GifBox({ onInsert }: { onInsert: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const ok = /^https:\/\/\S+$/i.test(url.trim());
  return (
    <div className="w-72 p-3 space-y-2 text-sm">
      <input autoFocus className="input h-9" placeholder="Paste the GIF link (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && onInsert(url.trim())} />
      <button type="button" className="btn-primary btn-sm w-full" disabled={!ok} onClick={() => onInsert(url.trim())}>Insert GIF</button>
    </div>
  );
}

// Rich-text area with Variables, bold, link, image, HTML source, undo/redo and a word count.
// Content is loaded into the editable element only when editorKey changes, so typing never resets the caret.
export function RichBody({ html, onChange, editorKey, variables, placeholder, toolbarStart, minHeight = 260, toolbarPosition = "top", onAttach, hideVariables, insertRef, replyBar }: {
  html: string; onChange: (html: string) => void; editorKey: string; variables: { v: string; l: string }[];
  placeholder?: string; toolbarStart?: ReactNode; minHeight?: number; toolbarPosition?: "top" | "bottom"; onAttach?: () => void; hideVariables?: boolean;
  // Lets the page around the editor insert text at the caret (for a Variables button that lives outside the toolbar).
  insertRef?: React.MutableRefObject<((text: string) => void) | null>;
  // The compact reply toolbar: alignment, bold, link, picture, GIF, emoji, HTML, undo/redo.
  replyBar?: boolean;
}) {
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [font, setFont] = useState("Calibri, Candara, sans-serif");
  const [size, setSize] = useState("10.5");
  const [color, setColor] = useState("#222222");
  const imageRef = useRef<HTMLInputElement>(null);
  // Keep every toolbar button on one line: when the editor is narrow, dropdowns show just their icon.
  const barRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < 520));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Clicking a picture in the draft shows a small bar to make it bigger, smaller or delete it.
  const [pic, setPic] = useState<HTMLImageElement | null>(null);
  const [, bump] = useState(0);
  const picBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pic) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (picBar.current?.contains(t) || t === pic) return;
      setPic(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pic]);
  const resizePic = (w: number) => {
    if (!pic || !ref.current) return;
    const max = ref.current.clientWidth - 40;
    const next = Math.round(Math.max(40, Math.min(max, w)));
    pic.style.width = `${next}px`;
    pic.style.height = "auto";
    pic.style.maxWidth = "100%";
    pic.setAttribute("width", String(next));
    sync();
    bump((n) => n + 1);
  };
  const alignPic = (where: "left" | "center" | "right") => {
    if (!pic) return;
    pic.style.display = "block";
    pic.style.marginLeft = where === "left" ? "0" : "auto";
    pic.style.marginRight = where === "right" ? "0" : "auto";
    sync();
    bump((n) => n + 1);
  };
  const removePic = () => { pic?.remove(); setPic(null); sync(); };
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const linkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!linkOpen) return;
    const h = (e: MouseEvent) => { if (linkRef.current && !linkRef.current.contains(e.target as Node)) setLinkOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [linkOpen]);
  const openLink = () => {
    setLinkUrl("");
    setLinkText(saved.current?.toString() ?? "");
    setLinkOpen((o) => !o);
  };
  const saveLink = () => {
    const url = safeUrl(linkUrl);
    if (!url) return toast("Enter a valid http(s) link", "error");
    const label = (linkText.trim() || saved.current?.toString() || url).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    exec("insertHTML", `<a href="${url.replace(/"/g, "%22")}">${label}</a>`);
    setLinkOpen(false);
  };
  // Dropdowns and the colour picker steal focus, so remember the selection made inside the editor and restore it before formatting.
  const saved = useRef<Range | null>(null);
  useEffect(() => {
    const h = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, source]);

  const sync = () => ref.current && onChange(ref.current.innerHTML);
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    if (saved.current) { const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(saved.current); }
    document.execCommand(cmd, false, value);
    sync();
  };
  // The browser's own size command only knows sizes 1-7, so it is used as a marker and swapped for a real point size.
  const setPt = (pt: string) => {
    exec("fontSize", "7");
    ref.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement("span");
      span.style.fontSize = `${pt}pt`;
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    sync();
  };
  const insertVar = (v: string) => (source ? onChange(`${html}{{${v}}}`) : exec("insertText", `{{${v}}}`));
  useEffect(() => {
    if (insertRef) insertRef.current = (t: string) => (source ? onChange(`${html}${t}`) : exec("insertText", t));
  });
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
  const words = text ? text.split(/\s+/).length : 0;

  const atBottom = toolbarPosition === "bottom";
  return (
    <div className={cx("flex flex-col", atBottom && "flex-1")}>
      <div ref={barRef} data-compact={compact} className={cx("flex flex-nowrap items-center gap-0.5 px-2 py-1.5 border-ink-100", atBottom ? "order-2 border-t" : "border-b")}>
        {toolbarStart}
        {!hideVariables && <Dropdown up label="Variables" icon={<Braces size={15} />}>
          {(close) => variables.map((x) => (
            <button key={x.v} className={menuItem} onClick={() => { insertVar(x.v); close(); }}>{x.l ? <>{x.l} <span className="text-ink-400 text-xs">{`{{${x.v}}}`}</span></> : `{{${x.v}}}`}</button>
          ))}
        </Dropdown>}
        {!hideVariables && <span className="w-px h-5 bg-ink-200 mx-1" />}
        {replyBar ? (
          <>
            <Dropdown label="" icon={<AlignLeft size={16} />}>
              {(close) => (<>
                <button className={menuItem} onClick={() => { exec("justifyLeft"); close(); }}>Align left</button>
                <button className={menuItem} onClick={() => { exec("justifyCenter"); close(); }}>Align centre</button>
                <button className={menuItem} onClick={() => { exec("justifyRight"); close(); }}>Align right</button>
              </>)}
            </Dropdown>
            <ToolButton title="Bold" onClick={() => exec("bold")}><Bold size={16} /></ToolButton>
          </>
        ) : <ToolButton title="Text formatting" active={showFormat} onClick={() => setShowFormat((v) => !v)}><Type size={16} /></ToolButton>}
        <div className="relative" ref={linkRef}>
          <ToolButton title="Insert link" active={linkOpen} onClick={openLink}><LinkIcon size={16} /></ToolButton>
          {linkOpen && (
            <div className="absolute left-0 bottom-full mb-1 z-30 w-72 card overflow-hidden text-sm">
              <label className="flex items-center gap-3 px-4 py-3 border-b border-ink-100"><LinkIcon size={16} className="text-ink-500 shrink-0" />
                <input autoFocus className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-ink-400" placeholder="Paste or type Link here" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveLink()} />
              </label>
              <label className="flex items-center gap-3 px-4 py-3 border-b border-ink-100"><Type size={16} className="text-ink-500 shrink-0" />
                <input className="flex-1 min-w-0 bg-transparent focus:outline-none placeholder:text-ink-400" placeholder="Text to display" value={linkText} onChange={(e) => setLinkText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveLink()} />
              </label>
              <button type="button" className="w-full text-left px-4 py-3 font-medium text-ink-600 hover:bg-ink-50 disabled:text-ink-400" disabled={!linkUrl.trim()} onClick={saveLink}>Save Link</button>
            </div>
          )}
        </div>
        <ToolButton title="Insert picture from your computer" onClick={() => imageRef.current?.click()}><ImageIcon size={16} /></ToolButton>
        <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 2 * 1024 * 1024) return toast("Pictures can be up to 2 MB", "error");
          const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
          exec("insertHTML", `<img src="${data}" alt="${f.name.replace(/[&<>"]/g, "")}" style="max-width:100%;height:auto">`);
        }} />
        {replyBar && (
          <>
            <Pop button={(toggle, open) => <ToolButton title="Insert a GIF by link" active={open} onClick={toggle}><span className="text-[10px] font-bold leading-none">GIF</span></ToolButton>}>
              {(close) => <GifBox onInsert={(url) => { exec("insertHTML", `<img src="${url.replace(/"/g, "%22")}" alt="GIF" style="max-width:100%;height:auto">`); close(); }} />}
            </Pop>
            <Pop button={(toggle, open) => <ToolButton title="Insert an emoji" active={open} onClick={toggle}><Smile size={16} /></ToolButton>}>
              {(close) => (
                <div className="grid grid-cols-8 gap-0.5 p-2 w-72">
                  {EMOJIS.map((e) => <button key={e} type="button" className="h-8 w-8 rounded hover:bg-ink-100 text-lg" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { exec("insertText", e); close(); }}>{e}</button>)}
                </div>
              )}
            </Pop>
          </>
        )}
        {onAttach && <ToolButton title="Attach files" onClick={onAttach}><Paperclip size={16} /></ToolButton>}
        <ToolButton title="Edit HTML" active={source} onClick={() => setSource((s) => !s)}><Code size={16} /></ToolButton>
        <span className="w-px h-5 bg-ink-200 mx-1" />
        <ToolButton title="Undo" onClick={() => exec("undo")}><Undo2 size={16} /></ToolButton>
        <ToolButton title="Redo" onClick={() => exec("redo")}><Redo2 size={16} /></ToolButton>
      </div>
      {showFormat && !source && (
        <div className={cx("flex flex-wrap items-center gap-1 px-3 py-1.5 border-ink-100", atBottom ? "order-2 border-t" : "border-b")}>
          <select aria-label="Font" className="h-8 rounded-md bg-transparent px-2 text-sm text-ink-700 hover:bg-ink-100 focus:outline-none" value={font}
            onChange={(e) => { setFont(e.target.value); exec("fontName", e.target.value); }}>
            {FONTS.map(([label, stack]) => <option key={label} value={stack} style={{ fontFamily: stack }}>{label}</option>)}
          </select>
          <select aria-label="Size" className="h-8 rounded-md bg-transparent px-2 text-sm text-ink-700 hover:bg-ink-100 focus:outline-none" value={size}
            onChange={(e) => { setSize(e.target.value); setPt(e.target.value); }}>
            {SIZES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <ToolButton title="Bold" onClick={() => exec("bold")}><Bold size={16} /></ToolButton>
          <ToolButton title="Italic" onClick={() => exec("italic")}><Italic size={16} /></ToolButton>
          <ToolButton title="Underline" onClick={() => exec("underline")}><Underline size={16} /></ToolButton>
          <ToolButton title="Strikethrough" onClick={() => exec("strikeThrough")}><Strikethrough size={16} /></ToolButton>
          <label title="Text colour" className="relative grid place-items-center w-8 h-8 rounded-md hover:bg-ink-100 cursor-pointer text-ink-600">
            <span className="flex flex-col items-center leading-none"><span className="text-sm font-semibold underline decoration-2" style={{ textDecorationColor: color }}>A</span></span>
            <input type="color" aria-label="Text colour" className="absolute inset-0 opacity-0 cursor-pointer" value={color} onChange={(e) => { setColor(e.target.value); exec("foreColor", e.target.value); }} />
          </label>
        </div>
      )}
      <div className={cx("relative", atBottom && "flex-1 order-1")}>
        {source ? (
          <textarea className="w-full p-5 font-mono text-xs bg-transparent focus:outline-none" style={{ minHeight }} value={html} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            className="p-5 pb-10 leading-relaxed focus:outline-none prose-mail empty:before:content-[attr(data-placeholder)] empty:before:text-ink-400"
            style={{ minHeight, fontFamily: "Calibri, Candara, sans-serif", fontSize: "10.5pt" }}
            data-placeholder={placeholder}
            onInput={() => { sync(); if (pic) setPic(null); }}
            onBlur={sync}
            onClick={(e) => { const t = e.target as HTMLElement; setPic(t.tagName === "IMG" ? (t as HTMLImageElement) : null); }}
            onPaste={(e) => {
              // Paste as plain text so formatting from other apps doesn't bloat the email.
              e.preventDefault();
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              sync();
            }}
          />
        )}
        {pic && !source && ref.current?.contains(pic) && (() => {
          const full = (ref.current?.clientWidth ?? 600) - 40;
          const cur = pic.offsetWidth;
          const btn = "grid place-items-center h-7 min-w-7 px-1.5 rounded-md text-xs font-medium text-ink-700 hover:bg-ink-100";
          return (
            <div ref={picBar} className="absolute z-20 flex items-center gap-0.5 card px-1 py-1 shadow-lg" style={{ top: Math.max(4, pic.offsetTop - 42), left: Math.max(4, pic.offsetLeft) }} onMouseDown={(e) => e.preventDefault()}>
              <button type="button" className={btn} title="Smaller" aria-label="Make smaller" onClick={() => resizePic(cur - full * 0.1)}>−</button>
              <span className="px-1 text-xs text-ink-600 tabular-nums">{Math.round((cur / full) * 100)}%</span>
              <button type="button" className={btn} title="Bigger" aria-label="Make bigger" onClick={() => resizePic(cur + full * 0.1)}>+</button>
              <span className="w-px h-4 bg-ink-200 mx-0.5" />
              {([["S", 0.25], ["M", 0.5], ["L", 0.75], ["Full", 1]] as const).map(([l, f]) => <button key={l} type="button" className={btn} onClick={() => resizePic(full * f)}>{l}</button>)}
              <span className="w-px h-4 bg-ink-200 mx-0.5" />
              <button type="button" className={btn} title="Align left" aria-label="Align left" onClick={() => alignPic("left")}><AlignLeft size={14} /></button>
              <button type="button" className={btn} title="Align centre" aria-label="Align centre" onClick={() => alignPic("center")}><AlignCenter size={14} /></button>
              <button type="button" className={btn} title="Align right" aria-label="Align right" onClick={() => alignPic("right")}><AlignRight size={14} /></button>
              <span className="w-px h-4 bg-ink-200 mx-0.5" />
              <button type="button" className={cx(btn, "text-red-600 hover:bg-red-50")} title="Delete picture" aria-label="Delete picture" onClick={removePic}><Trash2 size={14} /></button>
            </div>
          );
        })()}
        <span className="absolute right-4 bottom-3 chip bg-ink-100 text-ink-600 pointer-events-none">{words} words</span>
      </div>
    </div>
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
  // How this step is threaded. Saved with the step; when it was never set, "reply" is assumed for an empty subject and "new" otherwise.
  threadMode?: ThreadMode | null;
  onThreadMode?: (m: ThreadMode) => void;
  editorKey: string;
  // Inside a step card: no card frame or name header of its own (the step card provides them).
  embedded?: boolean;
  // Follow-up emails may reply in the previous thread (an empty subject); the first email always starts a new thread.
  canReply?: boolean;
  stats?: { sent: number; waiting: number };
  // Files sent with this email (10 MB in total).
  // Subject of the email this one replies to, shown as "Re: ..." when the type is "Reply in same thread".
  replySubject?: string;
  // The drafts of the steps before this one (oldest first); the preview shows them below this email as the thread history.
  earlier?: { subject: string; bodyHtml: string }[];
  attachments?: Attachment[];
  onAttachments?: (files: Attachment[]) => void;
}

const ATTACH_MAX = 10 * 1024 * 1024;
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const readBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

// Subject + rich-text body editor with variables, templates, spam check, preview send and save-as-template.
export function EmailEditor({ stepName, onStepName, subject, onSubject, bodyHtml, onBody, subjectPlaceholder, editorKey, embedded, canReply, stats, attachments, onAttachments, replySubject, earlier, threadMode: savedMode, onThreadMode }: EmailEditorProps) {
  const ws = useWs();
  const toast = useToast();
  const qc = useQueryClient();
  const subjectRef = useRef<HTMLInputElement>(null);
  // A follow-up with no subject is sent as a reply in the same thread, so that is what the Type box shows for it.
  // Pick "New thread" to give it its own subject instead.
  const [threadMode, setThreadMode] = useState<ThreadMode>(canReply ? (savedMode ?? (!subject.trim() ? "reply" : "new")) : "new");
  useEffect(() => {
    // The saved choice wins. The subject only decides for a step where no Type was ever chosen.
    setThreadMode(canReply ? (savedMode ?? (!subject.trim() ? "reply" : "new")) : "new");
    // Only when a different step or test is opened, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey, canReply]);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = async (list: FileList | null) => {
    if (!list || !onAttachments) return;
    const next = [...(attachments ?? [])];
    for (const f of Array.from(list)) {
      if (next.length >= 5) { toast("Up to 5 files per email", "error"); break; }
      if (next.reduce((t, a) => t + a.size, 0) + f.size > ATTACH_MAX) { toast(`${f.name} would take attachments over 10 MB`, "error"); continue; }
      next.push({ name: f.name, type: f.type || "application/octet-stream", size: f.size, data: await readBase64(f) });
    }
    onAttachments(next);
    if (fileRef.current) fileRef.current.value = "";
  };
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
    <div className={embedded ? undefined : "card overflow-hidden"}>
      {!embedded && (
        <div className="flex items-center gap-4 px-5 py-4 border-b border-ink-100">
          <span className="grid place-items-center w-12 h-12 rounded-xl border border-ink-200"><Mail size={20} /></span>
          <input className="flex-1 min-w-0 bg-transparent text-lg font-semibold focus:outline-none" value={stepName} onChange={(e) => onStepName(e.target.value)} placeholder="Step name" />
        </div>
      )}

      <div className={cx("grid xl:divide-x divide-ink-100", showSpam ? "xl:grid-cols-[1fr_1fr_15rem]" : "xl:grid-cols-2")}>
      <div className="min-w-0 flex flex-col">
      <div className="flex items-end gap-3 px-5 pt-4 pb-4 border-b border-ink-100">
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-ink-500 mb-1.5" htmlFor="step-subject">Subject</label>
          <div className="flex flex-nowrap items-center gap-1 rounded-lg border border-ink-200 bg-surface pr-1 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500">
            {threadMode === "reply_new_subject" && <span className="pl-3 text-[15px] text-ink-500 select-none" aria-hidden="true">RE:</span>}
            <input id="step-subject" ref={subjectRef} className={cx("flex-1 min-w-0 h-10 bg-transparent text-[15px] focus:outline-none placeholder:text-ink-400 disabled:text-ink-400", threadMode === "reply_new_subject" ? "pl-1.5 pr-3" : "px-3")}
              disabled={threadMode === "reply"} value={threadMode === "reply" ? `RE: ${replySubject ?? ""}`.trimEnd() : subject} onChange={(e) => onSubject(e.target.value)}
              placeholder={threadMode === "reply" ? "Replies in the same thread" : threadMode === "reply_new_subject" ? "New subject for this reply" : (subjectPlaceholder ?? "Enter your subject here (Tip: 2 words are the best for deliverability)")} />
            {threadMode !== "reply" && (
              <Dropdown className="shrink-0" label={<span className="whitespace-nowrap">Subject variables</span>} icon={<Braces size={15} />} align="right">
                {(close) => SUBJECT_VARIABLES.map((v) => <button key={v} className={menuItem} onClick={() => { insertSubjectVar(v); close(); }}>{`{{${v}}}`}</button>)}
              </Dropdown>
            )}
          </div>
        </div>
        <div className="w-72 max-w-[45%] shrink-0">
          <label className="block text-xs text-ink-500 mb-1.5" htmlFor="step-type">Type</label>
          <div className="relative">
            <select id="step-type" className="input appearance-none pr-8 !h-10" disabled={!canReply} value={threadMode}
              onChange={(e) => {
                const next = e.target.value as ThreadMode;
                setThreadMode(next);
                onThreadMode?.(next);
                // For "reply" the parent clears the subject in the same change as the Type, so neither overwrites the other.
                if (next !== "reply") requestAnimationFrame(() => subjectRef.current?.focus());
              }}>
              <option value="new">New thread</option>
              {canReply && <option value="reply">Reply in same thread</option>}
              {canReply && <option value="reply_new_subject">Reply in same thread with new subject</option>}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
          </div>
        </div>
      </div>

      <RichBody
        html={bodyHtml}
        onChange={onBody}
        editorKey={`${editorKey}:${templateLoads}`}
        variables={["Hi|Hello|Hey|Dear", ...SUBJECT_VARIABLES, "icebreaker"].map((v) => ({ v, l: "" }))}
        placeholder="Write your email… use Variables to personalise it."
        toolbarPosition={embedded ? "bottom" : "top"}
        onAttach={onAttachments ? () => fileRef.current?.click() : undefined}
        toolbarStart={
          <Dropdown up label="Templates" icon={<LayoutTemplate size={15} />}>
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
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
      {!!attachments?.length && (
        <div className="flex flex-wrap gap-2 px-4 py-2.5 border-t border-ink-100">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 pl-2.5 pr-1.5 py-1 text-xs text-ink-700">
              <Paperclip size={12} /> <span className="max-w-[12rem] truncate">{a.name}</span> <span className="text-ink-500">{fmtSize(a.size)}</span>
              <button type="button" aria-label={`Remove ${a.name}`} className="text-ink-500 hover:text-ink-900" onClick={() => onAttachments?.(attachments.filter((_, j) => j !== i))}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      </div>
      <PreviewPane ws={ws} subject={canReply && threadMode === "reply" ? "" : canReply && threadMode === "reply_new_subject" && subject.trim() && !/^re:/i.test(subject.trim()) ? `RE: ${subject.trim()}` : subject} bodyHtml={bodyHtml} replySubject={canReply && threadMode === "reply" ? (replySubject ?? "") : undefined} threaded={canReply && threadMode !== "new"} earlier={canReply ? earlier : undefined} />
      {showSpam && (
        <aside className="relative min-w-0 p-4 border-t border-ink-100 xl:border-t-0" aria-label="Spam check">
          <button className="absolute right-2 top-2 text-ink-500 hover:text-ink-800" aria-label="Close spam check" onClick={() => setShowSpam(false)}><X size={16} /></button>
          <SpamPanel spam={spam} />
        </aside>
      )}
      </div>

      <div className="flex flex-wrap gap-3 px-5 py-4 border-t border-ink-100">
        <button className="btn-secondary h-11 px-4" onClick={() => setShowSpam((v) => !v)}>
          <AlertTriangle size={17} /> Spam check
          <span className="w-12 h-1.5 rounded-full bg-ink-100 overflow-hidden"><span className={cx("block h-full", meter)} style={{ width: `${spam?.score ?? 0}%` }} /></span>
        </button>
        <button className="btn-secondary h-11 px-4" onClick={() => setPreview(true)}><Send size={17} /> Send preview email</button>
        <button className="btn-secondary h-11 px-4" onClick={() => setSaveTpl(true)} disabled={!bodyHtml.trim()}><TableProperties size={17} /> Save as template</button>
        {stats && (
          <div className="ml-auto flex items-center gap-4 text-xs text-ink-500 self-center">
            <span title="Contacts waiting to receive this step">Waiting <b className="text-ink-700">{stats.waiting.toLocaleString()}</b></span>
            <span title="Emails sent for this step">Sent <b className="text-ink-700">{stats.sent.toLocaleString()}</b></span>
          </div>
        )}
      </div>

      {preview && <PreviewModal ws={ws} subject={canReply && threadMode === "reply" ? "" : subject} bodyHtml={bodyHtml} threaded={canReply && threadMode !== "new"} earlier={canReply && threadMode !== "new" ? earlier : undefined} onClose={() => setPreview(false)} />}
      {saveTpl && <SaveTemplateModal ws={ws} subject={subject} bodyHtml={bodyHtml} onClose={() => setSaveTpl(false)} onSaved={() => qc.invalidateQueries({ queryKey: ["templates", ws] })} />}
    </div>
  );
}

// Live preview beside the draft: the email as one contact would receive it, with their details filled in.
function PreviewPane({ ws, subject, bodyHtml, replySubject, earlier, threaded }: { ws: string; subject: string; bodyHtml: string; replySubject?: string; threaded?: boolean; earlier?: { subject: string; bodyHtml: string }[] }) {
  // Inside the sequence builder the preview uses that sequence's saved opt-out setting.
  const { id: sequenceId } = useParams();
  const contacts = useQuery({ queryKey: ["contacts", ws, "preview-picker"], queryFn: () => api<Paged<Contact>>(`/v1/workspaces/${ws}/contacts?pageSize=100`) });
  const [contactId, setContactId] = useState("");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [nonce, setNonce] = useState(0);
  // On by default: the recipient of a follow-up gets the earlier emails underneath.
  const [showThread, setShowThread] = useState(true);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ subject: string; replySubject?: string; html: string; contact: { id: string; email: string } | null } | null>(null);

  // Re-render shortly after typing stops. Refresh runs it again, which also re-rolls any spintax like {Hi|Hello}.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ subject: string; replySubject?: string; html: string; contact: { id: string; email: string } | null }>(`/v1/workspaces/${ws}/preview`, { body: { subject, bodyHtml, replySubject, threaded, earlier: showThread ? earlier : undefined, contactId: contactId || undefined, sequenceId } })
        .then((r) => { if (live) setData(r); })
        .catch(() => { if (live) setData(null); })
        .finally(() => { if (live) setLoading(false); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [ws, subject, bodyHtml, replySubject, threaded, JSON.stringify(earlier ?? []), showThread, contactId, nonce]);

  const list = contacts.data?.items ?? [];
  const nameOf = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.email;
  const shown = data?.contact ? list.find((c) => c.id === data.contact!.id) : undefined;
  const segment = (on: boolean) => cx("grid place-items-center w-9 h-9 rounded-lg", on ? "bg-ink-900 text-ink-50" : "text-ink-600 hover:bg-ink-100");

  return (
    <div className="min-w-0 bg-ink-50/60 p-5 border-t border-ink-100 xl:border-t-0">
      <div className="text-sm font-semibold text-ink-800">Generate preview for contact</div>
      <div className="mt-3 text-xs text-ink-500">Select contact</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <select className="input appearance-none pr-14" value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Select contact">
            <option value="">{list.length ? "Latest contact" : "Sample contact (no contacts yet)"}</option>
            {list.map((c) => <option key={c.id} value={c.id}>{nameOf(c)}</option>)}
          </select>
          {contactId && <button type="button" className="absolute right-8 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-800" aria-label="Clear contact" onClick={() => setContactId("")}><X size={15} /></button>}
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
        </div>
        <button className="btn-secondary h-9" onClick={() => setNonce((n) => n + 1)}><RefreshCw size={14} className={cx(loading && "animate-spin")} /> Refresh</button>
        {!!earlier?.length && (
          <label className={cx("flex items-center gap-2 h-9 px-3 rounded-xl border border-ink-200 bg-surface text-sm select-none", threaded ? "text-ink-700 cursor-pointer" : "text-ink-400 cursor-not-allowed")}
            title={threaded ? undefined : 'Set the Type to "Reply in same thread" to preview the thread'}>
            <input type="checkbox" disabled={!threaded} checked={!!threaded && showThread} onChange={(e) => setShowThread(e.target.checked)} /> Show email thread
          </label>
        )}
        <div className="flex items-center rounded-xl border border-ink-200 bg-surface p-0.5">
          <button className={segment(device === "desktop")} aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={16} /></button>
          <button className={segment(device === "mobile")} aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone size={16} /></button>
        </div>
      </div>

      <div className={cx("mt-5 mx-auto transition-all", device === "mobile" ? "max-w-[375px]" : "max-w-none")}>
        <div className="rounded-xl border border-ink-200 bg-surface p-5 text-sm">
          {!data ? (
            <div className="text-ink-500 py-8 text-center">{loading ? "Loading preview…" : "Preview isn't available right now."}</div>
          ) : (
            <>
              <div><span className="font-semibold">To:</span> {data.contact ? <>{shown ? `${nameOf(shown)} ` : ""}&lt;{data.contact.email}&gt;</> : "Sample contact"}</div>
              <div className="mt-1"><span className="font-semibold">Subject:</span> {data.subject || (replySubject !== undefined ? `RE: ${data.replySubject ?? ""}`.trimEnd() : <span className="text-ink-400">(no subject)</span>)}</div>
              <div className="mt-4">{data.html.trim() ? <SafeHtml html={data.html} minHeight={140} /> : <div className="text-ink-400 py-6 text-center">Start writing and your email shows up here.</div>}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ ws, subject, bodyHtml, threaded, earlier, onClose }: { ws: string; subject: string; bodyHtml: string; threaded?: boolean; earlier?: { subject: string; bodyHtml: string }[]; onClose: () => void }) {
  const { id: sequenceId } = useParams();
  const toast = useToast();
  const mailboxes = useQuery({ queryKey: ["mailboxes", ws], queryFn: () => api<Mailbox[]>(`/v1/workspaces/${ws}/mailboxes`) });
  const [to, setTo] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/send-test`, { body: { mailboxId: mailboxId || mailboxes.data?.[0]?.id, to, subject, bodyHtml, threaded, earlier, sequenceId } }),
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
          <p className="text-xs text-ink-500">Variables are filled from the contact with this email if one exists, otherwise with sample values. It is sent exactly like a real email (same subject, signature, unsubscribe line{earlier?.length ? " and, for this follow-up, the earlier emails of the thread underneath" : ""}) so you see what the recipient sees.</p>
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


// Spam-potential panel: a gauge for the overall risk and one zoned meter per signal (green good, yellow borderline, red risky).
const G = "#d6f5dd", Y = "#fdeec0", R = "#fde2e0";
type Zone = [number, string]; // [width, colour]
function Meter({ label, help, shown, value, max, zones }: { label: string; help: string; shown: string; value: number; max: number; zones: Zone[] }) {
  const pos = Math.max(0, Math.min(1, value / max)) * 100;
  const at = zones.reduce<{ acc: number; color: string; done: boolean }>((o, [w, c]) => (o.done ? o : o.acc + w >= (pos / 100) * zones.reduce((t, z) => t + z[0], 0) ? { ...o, color: c, done: true } : { ...o, acc: o.acc + w }), { acc: 0, color: zones[0]![1], done: false }).color;
  const dot = at === G ? "#16a34a" : at === Y ? "#f59e0b" : "#ef4444";
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-700">{label}<span title={help} className="grid place-items-center w-4 h-4 rounded-full border border-ink-400 text-[10px] text-ink-500 cursor-help">?</span></span>
        <span className="text-xs font-semibold text-ink-900">{shown}</span>
      </div>
      <div className="relative mt-1.5 flex gap-0.5 h-1.5">
        {zones.map(([w, c], i) => <span key={i} className="h-full rounded-full" style={{ flex: w, background: c }} />)}
        <span className="absolute top-1/2 w-2 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: `${pos}%`, background: dot }} />
      </div>
    </div>
  );
}

function SpamPanel({ spam }: { spam: SpamReport | null }) {
  if (!spam) return <p className="text-sm text-ink-500">Checking…</p>;
  const m = spam.metrics;
  const potential = 100 - spam.score;
  const arc = 251.3; // half-circle length for r=80
  const tone = potential >= 40 ? "#ef4444" : potential >= 20 ? "#f59e0b" : "#16a34a";
  return (
    <div className="mx-auto">
      <div className="relative mx-auto w-32">
        <svg viewBox="0 0 200 110" className="w-full" aria-hidden="true">
          <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#eceef1" strokeWidth="16" strokeLinecap="round" />
          <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={tone} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(arc * Math.max(potential, 2)) / 100} ${arc}`} />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center text-lg font-semibold text-ink-800">{potential}%</div>
      </div>
      <div className="mt-1 text-center text-sm font-semibold text-ink-800">Spam potential</div>
      <div className="mt-2 border-t border-ink-100 pt-1">
        {m ? (
          <>
            <Meter label="Spam words" help="Trigger phrases like 'free trial' or 'act now'." shown={String(m.spamWords)} value={m.spamWords} max={6} zones={[[1, G], [2, Y], [6, R]]} />
            <Meter label="Spintax & Variables" help="Share of your text that is personalised with variables or spintax. Higher is better." shown={`${m.personalisationPct}%`} value={m.personalisationPct} max={60} zones={[[10, R], [20, Y], [30, G]]} />
            <Meter label="Links" help="Cold emails do best with one link or none." shown={String(m.links)} value={m.links} max={6} zones={[[1, G], [1, Y], [4, R]]} />
            <Meter label="Images" help="Images hurt cold-email deliverability." shown={String(m.images)} value={m.images} max={6} zones={[[1, G], [1, Y], [4, R]]} />
            <Meter label="Emojis" help="Emojis can look promotional." shown={String(m.emojis)} value={m.emojis} max={6} zones={[[1, G], [2, Y], [6, R]]} />
            <Meter label="Words in total" help="Aim for roughly 50 to 125 words." shown={`~${m.words}`} value={m.words} max={300} zones={[[50, Y], [75, G], [75, Y], [100, R]]} />
          </>
        ) : null}
      </div>
      {spam.issues.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs text-ink-600">{spam.issues.map((i) => <li key={i.code} className="flex gap-2"><AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />{i.message}</li>)}</ul>
      )}
      <p className="mt-2 text-center text-xs text-ink-500">* We recommend using plain text</p>
    </div>
  );
}
