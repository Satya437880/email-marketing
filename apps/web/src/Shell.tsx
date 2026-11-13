import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Check, ChevronsLeft, ChevronsRight, Inbox, LogOut, Mail, Menu, Moon, Send, Settings, Sun, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, type Me, type Workspace } from "./api";
import { useTheme, type ThemePref } from "./theme";
import { Avatar, cx } from "./ui";

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {/* multiply blends the image's white background into whatever surface it sits on */}
      <img src="/logo.png" alt="Maple MPSS" width={32} height={32} className="w-8 h-8 shrink-0 mix-blend-multiply dark:mix-blend-normal dark:rounded-md" />
      {!collapsed && <span className="font-semibold tracking-tight" style={{ color: "rgb(var(--logo-text))" }}>Maple MPSS</span>}
    </div>
  );
}

const THEMES: { k: ThemePref; label: string; icon: ReactNode }[] = [
  { k: "light", label: "Light", icon: <Sun size={16} /> },
  { k: "dark", label: "Dark", icon: <Moon size={16} /> },
];

function ThemeMenu({ collapsed }: { collapsed: boolean }) {
  const [pref, setPref] = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const current = THEMES.find((t) => t.k === pref)!;
  return (
    <div className="relative" ref={ref}>
      <button
        className="w-full flex items-center gap-3 rounded-lg px-2.5 h-9 text-sm font-medium text-ink-600 hover:bg-ink-100"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? `Theme: ${current.label}` : undefined}
      >
        {pref === "dark" ? <Moon size={18} /> : <Sun size={18} />}
        {!collapsed && <><span className="flex-1 text-left">Theme</span><span className="text-xs font-normal text-ink-500">{current.label}</span></>}
      </button>
      {open && (
        <div className={cx("absolute z-40 bottom-full mb-1 w-44 card p-1", collapsed ? "left-full ml-2 bottom-0 mb-0" : "right-0")}>
          {THEMES.map((t) => (
            <button key={t.k} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-ink-50" onClick={() => { setPref(t.k); setOpen(false); }}>
              <span className="text-ink-500">{t.icon}</span>
              <span className="flex-1 text-left">{t.label}</span>
              {pref === t.k && <Check size={15} className="text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ me, workspace, children }: { me: Me; workspace: Workspace; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const base = `/${workspace.slug}`;
  const counts = useQuery({
    queryKey: ["thread-counts", workspace.slug],
    queryFn: () => api<{ unread: number }>(`/v1/workspaces/${workspace.slug}/threads/counts`),
    refetchInterval: 60_000,
  });

  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    const unread = counts.data?.unread;
    if (unread === undefined) return;
    const prev = lastUnread.current;
    lastUnread.current = unread;
    if (prev === null || unread <= prev) return;
    let on = false;
    try { on = localStorage.getItem("notify-replies") === "1"; } catch { /* storage blocked */ }
    if (on && "Notification" in window && Notification.permission === "granted") {
      const n = new Notification("New reply in Primebox", { body: `${unread - prev} new ${unread - prev === 1 ? "reply" : "replies"} · ${workspace.name}`, icon: "/favicon.png" });
      n.onclick = () => { window.focus(); nav(`${base}/inbox`); };
    }
  }, [counts.data?.unread, workspace.name, nav, base]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const inboxOnly = workspace.role === "primebox";
  const items = [
    { to: `${base}/inbox`, label: "Primebox", icon: <Inbox size={18} />, badge: counts.data?.unread },
    { to: `${base}/sequences`, label: "Sequences", icon: <Send size={18} /> },
    { to: `${base}/emails`, label: "Emails", icon: <Mail size={18} /> },
    { to: `${base}/analytics`, label: "Analytics", icon: <BarChart3 size={18} /> },
    { to: `${base}/senders`, label: "Senders & Mailboxes", icon: <Mail size={18} /> },
    { to: `${base}/contacts`, label: "Contacts", icon: <Users size={18} /> },
  ].slice(0, inboxOnly ? 1 : undefined);

  const logout = async () => {
    await api("/v1/auth/logout", { method: "POST", body: {} });
    qc.clear();
    nav("/login");
  };

  const sidebar = (
    <aside className={cx("flex flex-col h-full bg-surface border-r border-ink-200 transition-all", collapsed ? "w-[68px]" : "w-[248px]")}>
      <div className="flex items-center justify-between h-16 px-4">
        <Logo collapsed={collapsed} />
        <button className="btn-ghost btn-sm hidden md:inline-flex" onClick={() => setCollapsed((c) => !c)} title="Collapse (Ctrl+B)">
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
        <button className="btn-ghost btn-sm md:hidden" onClick={() => setMobileOpen(false)}><X size={16} /></button>
      </div>
      {!collapsed && (
        <div className="mx-3 mb-3 rounded-lg border border-ink-200 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-ink-400">Workspace</div>
          <select
            className="w-full bg-transparent text-sm font-medium text-ink-800 focus:outline-none"
            value={workspace.slug}
            onChange={(e) => nav(`/${e.target.value}/inbox`)}
          >
            {me.workspaces.map((w) => <option key={w.id} value={w.slug}>{w.name}</option>)}
          </select>
        </div>
      )}
      <nav className="flex-1 px-3 space-y-0.5">
        {items.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => cx(
              "flex items-center gap-3 rounded-lg px-2.5 h-9 text-sm font-medium",
              isActive ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100",
            )}
            title={collapsed ? i.label : undefined}
          >
            {i.icon}
            {!collapsed && <span className="flex-1 truncate">{i.label}</span>}
            {!collapsed && !!i.badge && <span className="chip bg-brand-600 text-white">{i.badge}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 pb-3 space-y-0.5">
        <NavLink
          hidden={inboxOnly}
          to={`${base}/settings`}
          className={({ isActive }) => cx("flex items-center gap-3 rounded-lg px-2.5 h-9 text-sm font-medium", isActive ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100")}
        >
          <Settings size={18} />{!collapsed && "Settings"}
        </NavLink>
        <ThemeMenu collapsed={collapsed} />
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 mt-2 border-t border-ink-100 pt-3">
          <Avatar name={me.user.name} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-800 truncate">{me.user.name}</div>
              <div className="text-xs text-ink-500 truncate">{me.user.email}</div>
            </div>
          )}
          {!collapsed && <button className="btn-ghost btn-sm" onClick={logout} title="Log out"><LogOut size={16} /></button>}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="hidden md:block shrink-0">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[248px]">{sidebar}</div>
        </div>
      )}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="md:hidden flex items-center gap-3 h-14 px-4 bg-surface border-b border-ink-200">
          <button className="btn-ghost btn-sm" onClick={() => setMobileOpen(true)}><Menu size={18} /></button>
          <Logo />
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
