import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { GoogleMark, MicrosoftMark } from "../marks";
import { Logo } from "../Shell";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });
  // A failed Google/Microsoft login comes back to this page as ?error=…
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("error"));
  // Only providers the server is configured for are offered, so every button leads somewhere.
  const providers = useQuery({ queryKey: ["auth-providers"], queryFn: () => api<{ google: boolean; microsoft: boolean }>("/v1/auth/providers"), staleTime: 60_000 });
  const verb = mode === "login" ? "Login" : "Sign up";
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") await api("/v1/auth/signup", { body: { name: form.name, email: form.email, password: form.password, company: form.company || undefined } });
      else await api("/v1/auth/login", { body: { email: form.email, password: form.password } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      nav("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="min-h-full flex">
      <div className="flex flex-1 flex-col justify-center px-4 py-12 sm:px-12">
        <div className="w-full max-w-sm mx-auto">
          <Logo />
          <h1 className="text-2xl font-semibold text-ink-900 mt-8">{mode === "login" ? "Log in to your account" : "Create your account"}</h1>
          <p className="text-sm text-ink-500 mt-1">{mode === "login" ? "Welcome back." : "Start sending cold email that lands in the inbox."}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <>
                <div><label className="label">Full name</label><input className="input" value={form.name} onChange={set("name")} required autoFocus /></div>
                <div><label className="label">Company <span className="text-ink-400 font-normal">(optional)</span></label><input className="input" value={form.company} onChange={set("company")} /></div>
              </>
            )}
            <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={set("email")} required autoFocus={mode === "login"} /></div>
            <div><label className="label">Password</label><input className="input" type="password" value={form.password} onChange={set("password")} required minLength={mode === "signup" ? 8 : 1} /></div>
            {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
            <button className="btn-primary w-full h-10" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
          </form>
          {(providers.data?.google || providers.data?.microsoft) && (
            <>
              <div className="flex items-center gap-3 my-6 text-xs text-ink-400"><span className="h-px flex-1 bg-ink-200" />or<span className="h-px flex-1 bg-ink-200" /></div>
              <div className="space-y-3">
                {providers.data.google && <a className="btn-secondary w-full h-10" href="/v1/auth/oauth/google/start"><GoogleMark /> {verb} with Google</a>}
                {providers.data.microsoft && <a className="btn-secondary w-full h-10" href="/v1/auth/oauth/microsoft/start"><MicrosoftMark /> {verb} with Microsoft</a>}
              </div>
            </>
          )}
          <p className="text-sm text-ink-500 mt-6 text-center">
            {mode === "login" ? <>Don't have an account? <Link className="text-brand-700 font-medium" to="/signup">Sign up</Link></> : <>Already have an account? <Link className="text-brand-700 font-medium" to="/login">Log in</Link></>}
          </p>
        </div>
      </div>
    </div>
  );
}
