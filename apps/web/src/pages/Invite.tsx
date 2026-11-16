import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Logo } from "../Shell";
import { Spinner } from "../ui";

interface InviteInfo { email: string; role: string; roleName: string; workspaceName: string; inviterName: string | null; hasAccount: boolean }

// The page behind the emailed invitation link: accept and you are in, with no separate sign-up or login step.
export function InvitePage() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api<InviteInfo>(`/v1/invites/${encodeURIComponent(token)}`), retry: false });

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ workspaceSlug: string | null }>(`/v1/invites/${encodeURIComponent(token)}/accept`, { body: info.data?.hasAccount ? {} : { name, password, confirmPassword: confirm } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav(r.workspaceSlug ? `/${r.workspaceSlug}/inbox` : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const i = info.data;
  return (
    <div className="min-h-full flex">
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-12">
        <div className="w-full max-w-sm mx-auto">
          <Logo />
          {info.isLoading ? <div className="mt-10"><Spinner /></div> : !i ? (
            <>
              <h1 className="text-2xl font-semibold text-ink-900 mt-8">Invitation not available</h1>
              <p className="text-sm text-ink-500 mt-2">{info.error instanceof ApiError ? info.error.message : "This invitation link is not valid."}</p>
              <Link className="btn-secondary mt-6 inline-flex" to="/login">Go to log in</Link>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold text-ink-900 mt-8">Join {i.workspaceName}</h1>
              <p className="text-sm text-ink-500 mt-1">{i.inviterName ? `${i.inviterName} invited` : "You are invited"} <b className="text-ink-700">{i.email}</b> as <b className="text-ink-700">{i.roleName}</b>.</p>
              <form onSubmit={accept} className="mt-8 space-y-4">
                {!i.hasAccount && (
                  <>
                    <div><label className="label">Your name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></div>
                    <div>
                      <label className="label" htmlFor="invite-password">Choose a password</label>
                      <div className="relative">
                        <input id="invite-password" className="input pr-11" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
                        <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8 rounded-md text-ink-500 hover:bg-ink-100" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
                          {show ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                      </div>
                      <p className="text-xs text-ink-500 mt-1">At least 8 characters. You will use it next time you log in.</p>
                    </div>
                    <div>
                      <label className="label" htmlFor="invite-confirm">Confirm password</label>
                      <input id="invite-confirm" className={`input ${confirm && confirm !== password ? "border-red-500" : ""}`} type={show ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
                      {confirm && (confirm === password ? <p className="text-xs text-emerald-700 mt-1">Passwords match</p> : <p className="text-xs text-red-600 mt-1">Passwords do not match</p>)}
                    </div>
                  </>
                )}
                {i.hasAccount && <p className="text-sm text-ink-600">You already have an account with this email. Accepting adds this workspace to it and signs you in.</p>}
                {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
                <button className="btn-primary w-full h-10" disabled={busy || (!i.hasAccount && (!name.trim() || password.length < 8 || password !== confirm))}>{busy ? "Please wait…" : "Accept invitation"}</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
