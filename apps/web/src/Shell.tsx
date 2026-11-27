import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Building2, Check, ChevronDown, ChevronsLeft, ChevronsRight, Inbox, LogOut, Mail, Menu, Moon, Pencil, Send, Settings, Sun, Trash2, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, type Me, type Workspace } from "./api";
import { useTheme, type ThemePref } from "./theme";
import { Avatar, cx, Modal, useToast } from "./ui";

export function Logo({ collapsed }: { collapsed?: boolean }) {
  // The artwork is transparent maroon; on the dark theme it is drawn in white so it stays readable.
  return collapsed
    ? <img src="/logo-mark.png" alt="Outreach" width={32} height={32} className="w-8 h-8 shrink-0 dark:brightness-0 dark:invert" />
    : <img src="/logo.png" alt="Outreach" width={88} height={32} className="h-8 w-auto shrink-0 mx-auto dark:brightness-0 dark:invert" />;
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

  const [picker, setPicker] = useState(false);

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

  const pickerModal = picker && <WorkspaceSelector me={me} workspace={workspace} onClose={() => setPicker(false)} />;

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
          <div className="text-xs uppercase tracking-wide text-ink-400">Workspace</div>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800" title={workspace.name}>{workspace.name}</span>
              <button className="shrink-0 grid place-items-center w-7 h-7 rounded-md text-ink-500 hover:text-ink-800 hover:bg-ink-100" title="Switch, create or delete workspaces" aria-label="Workspace selector" onClick={() => setPicker(true)}>
                <ChevronDown size={16} />
              </button>
            </div>
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
      {pickerModal}
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

// Pick another workspace, rename the open one, create a new one, or delete the open one.
function WorkspaceSelector({ me, workspace, onClose }: { me: Me; workspace: Workspace; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = workspace.role === "owner";
  const canRename = isOwner || workspace.role === "admin";
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const create = useMutation({
    mutationFn: (n: string) => api<Workspace>("/v1/workspaces", { body: { name: n } }),
    onSuccess: async (w) => { await qc.invalidateQueries({ queryKey: ["me"] }); toast(`Workspace "${w.name}" created`); onClose(); nav(`/${w.slug}/inbox`); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const rename = useMutation({
    mutationFn: (n: string) => api(`/v1/workspaces/${workspace.slug}`, { method: "PATCH", body: { name: n } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["me"] }); toast("Workspace renamed"); setEditing(false); setName(""); },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: (confirmName: string) => api(`/v1/workspaces/${workspace.slug}`, { method: "DELETE", body: { confirmName } }),
    onSuccess: async () => {
      const next = me.workspaces.find((w) => w.id !== workspace.id);
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast(`Workspace "${workspace.name}" deleted`);
      onClose();
      nav(next ? `/${next.slug}/inbox` : "/");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const askDelete = () => {
    if (me.workspaces.length < 2) { toast("You can't delete your only workspace. Create another one first.", "error"); return; }
    const typed = window.prompt(`This deletes "${workspace.name}" and everything in it: mailboxes, contacts, sequences and emails. It cannot be undone.

Type the workspace name to confirm:`);
    if (typed === null) return;
    del.mutate(typed);
  };
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (editing) rename.mutate(n); else create.mutate(n);
  };
  const iconBtn = "grid place-items-center w-11 h-11 shrink-0 rounded-xl border border-ink-200 bg-surface text-ink-700 hover:bg-ink-50 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <Modal open onClose={onClose} title="Workspace selector" icon={<Building2 size={20} />}>
      <label className="label">Workspace</label>
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <select className="input appearance-none pr-10" value={workspace.slug} onChange={(e) => { onClose(); nav(`/${e.target.value}/inbox`); }}>
            {me.workspaces.map((w) => <option key={w.id} value={w.slug}>{w.name}</option>)}
          </select>
          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" />
        </div>
        <button className={iconBtn} title={canRename ? "Rename this workspace" : "Only owners and admins can rename"} aria-label="Rename workspace" disabled={!canRename} onClick={() => { setEditing(true); setName(workspace.name); }}><Pencil size={18} /></button>
        <button className={iconBtn} title={isOwner ? "Delete this workspace" : "Only the owner can delete a workspace"} aria-label="Delete workspace" disabled={!isOwner || del.isPending} onClick={askDelete}><Trash2 size={18} /></button>
      </div>

      <label className="label mt-4">{editing ? "Rename workspace" : "Workspace name"}</label>
      <input className="input" value={name} maxLength={100} placeholder="Enter new workspace name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="btn-primary w-full h-11 mt-4" disabled={!name.trim() || create.isPending || rename.isPending} onClick={submit}>
        {editing ? (rename.isPending ? "Saving…" : "Save name") : (create.isPending ? "Creating…" : "Create a new workspace")}
      </button>
      {editing && <button className="btn-ghost w-full mt-2" onClick={() => { setEditing(false); setName(""); }}>Cancel rename</button>}
    </Modal>
  );
}
