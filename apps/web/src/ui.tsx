import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// A dropdown rendered in a portal with fixed positioning, so tables and cards with overflow:hidden can't clip it.
// It opens upward when there isn't room below, and closes on outside click, Escape, scroll or resize.
export function PortalMenu({ trigger, children, className, align = "match", width = 224 }: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
  align?: "match" | "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (!r) return;
    const w = align === "match" ? Math.max(r.width, 200) : width;
    const left = Math.min(Math.max(8, align === "right" ? r.right - w : r.left), window.innerWidth - w - 8);
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below;
    setPos({ left, width: w, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !menu.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <div ref={wrap} className={className} onClick={() => { if (!open) place(); setOpen((o) => !o); }}>{trigger}</div>
      {open && pos && createPortal(
        <div ref={menu} className="fixed z-[70] card p-1.5 max-h-[70vh] overflow-y-auto" style={pos} onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}

export function PageHeader({ icon, title, actions, children }: { icon: ReactNode; title: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-4 md:px-8 pt-6 bg-surface border-b border-ink-200">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="flex items-center gap-2.5 text-lg font-semibold text-ink-900">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand-50 text-brand-700">{icon}</span>
          {title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children ? <div className="flex gap-6 overflow-x-auto">{children}</div> : <div className="h-2" />}
    </div>
  );
}

export function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button className={cx("tab", active && "tab-active")} onClick={onClick}>{children}</button>;
}

export function Modal({ open, onClose, title, subtitle, icon, children, footer, wide, flush }: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; icon?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; flush?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto" onMouseDown={onClose}>
      <div className={cx("card w-full my-10", wide ? "max-w-4xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-ink-100">
          {icon && <span className="grid place-items-center w-11 h-11 shrink-0 rounded-xl border border-ink-200 bg-surface">{icon}</span>}
          <div className="flex-1 min-w-0">
            <h2 className={cx("font-semibold text-ink-900", subtitle && "text-lg")}>{title}</h2>
            {subtitle && <p className="text-sm text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className={flush ? "" : "p-5"}>{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-ink-100 bg-ink-50/50 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; disabled?: boolean; title?: string }) {
  return (
    <label className={cx("flex items-start gap-3 select-none", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-ink-300")}
      >
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-[#fff] shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label && (
        <span>
          <span className="block text-sm text-ink-800">{label}</span>
          {hint && <span className="block text-xs text-ink-500 mt-0.5">{hint}</span>}
        </span>
      )}
    </label>
  );
}

const STATUS: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  completed: "bg-sky-50 text-sky-700",
  paused: "bg-amber-50 text-amber-700",
  draft: "bg-ink-100 text-ink-600",
  error: "bg-red-50 text-red-700",
  interrupted: "bg-red-50 text-red-700",
  disconnected: "bg-red-50 text-red-700",
  replied: "bg-violet-50 text-violet-700",
  bounced: "bg-red-50 text-red-700",
  opted_out: "bg-orange-50 text-orange-700",
  finished: "bg-sky-50 text-sky-700",
  queued: "bg-ink-100 text-ink-600",
  sending: "bg-emerald-50 text-emerald-700",
  ooo: "bg-amber-50 text-amber-700",
};

export function StatusPill({ status }: { status: string }) {
  return <span className={cx("chip capitalize", STATUS[status] ?? "bg-ink-100 text-ink-600")}>{status.replace("_", " ")}</span>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 flex-1 rounded-full bg-ink-100 overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="text-xs text-ink-500 w-8 text-right">{value}%</span>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-4">
      <div className="grid place-items-center w-12 h-12 rounded-full bg-brand-50 text-brand-600 mb-3">{icon}</div>
      <h3 className="font-semibold text-ink-900">{title}</h3>
      <p className="text-sm text-ink-500 mt-1 max-w-sm">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="text-xs text-ink-500">{label}</div>
      <div className="text-xl font-semibold text-ink-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-ink-500">
      <span>{total.toLocaleString()} total</span>
      <div className="flex items-center gap-2">
        <span>Page {page} of {pages}</span>
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="flex justify-center py-12"><div className="h-6 w-6 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" /></div>;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="inline-grid place-items-center rounded-full text-white text-xs font-semibold shrink-0" style={{ width: size, height: size, background: `hsl(${h} 45% 48%)` }}>
      {initials}
    </span>
  );
}

type ToastKind = "success" | "error";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx("rounded-lg px-4 py-2.5 text-sm shadow-lg text-white max-w-sm", t.kind === "error" ? "bg-red-600" : "bg-[#151820]")}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Renders untrusted email HTML in a sandboxed iframe: no scripts, no access to the app's cookies or DOM.
export function SafeHtml({ html, minHeight = 48 }: { html: string; minHeight?: number }) {
  const [height, setHeight] = useState(minHeight);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#000;background:#fff;padding:8px;border-radius:6px}p{margin:0 0 .6em}a{color:#6B2737}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title="Preview"
      sandbox="allow-same-origin allow-popups"
      srcDoc={doc}
      className="w-full border-0 block"
      style={{ height }}
      onLoad={(e) => {
        const b = e.currentTarget.contentDocument?.body;
        if (b) setHeight(Math.max(minHeight, b.scrollHeight + 4));
      }}
    />
  );
}

export function fmtDate(d: string | null | undefined, withTime = false) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

export function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
