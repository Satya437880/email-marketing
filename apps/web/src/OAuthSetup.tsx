import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { api } from "./api";
import { useWs } from "./App";
import { Modal, useToast } from "./ui";

export type OAuthProviderKey = "google" | "microsoft";

export interface OAuthProviderStatus {
  configured: boolean;
  source: "workspace" | "server" | null;
  redirectUri: string;
  clientId: string | null;
  tenant: string | null;
}
export type OAuthStatus = Record<OAuthProviderKey, OAuthProviderStatus>;

export const oauthStatusKey = (ws: string) => ["oauth-status", ws];

const COPY = {
  google: {
    name: "Google",
    console: "Google Cloud Console",
    steps: [
      <>In <b>APIs &amp; Services → OAuth consent screen</b>, add the scope <code>https://mail.google.com/</code>. While the app is in Testing, add the Gmail addresses you'll connect as test users.</>,
      <>Go to <b>Credentials → Create credentials → OAuth client ID → Web application</b> and add the redirect URI shown above.</>,
      <>Copy the <b>Client ID</b> and <b>Client secret</b> into the boxes here.</>,
    ],
  },
  microsoft: {
    name: "Microsoft",
    console: "Azure portal",
    steps: [
      <>In <b>Microsoft Entra ID → App registrations → New registration</b>, choose platform <b>Web</b> and add the redirect URI shown above.</>,
      <>Under <b>API permissions</b>, add these Delegated permissions: <code>IMAP.AccessAsUser.All</code>, <code>SMTP.Send</code>, <code>offline_access</code>, <code>openid</code>, <code>email</code>, <code>profile</code>.</>,
      <>Under <b>Certificates &amp; secrets</b>, create a client secret and copy its <b>Value</b>.</>,
      <>Copy the <b>Application (client) ID</b> and the secret value into the boxes here.</>,
    ],
  },
} as const;

// Lets a workspace paste in its own Google/Microsoft app credentials. The secret is checked with the provider and stored encrypted.
export function OAuthSetupModal({ provider, status, onClose, onSaved, saveLabel = "Save", onUsePassword }: {
  provider: OAuthProviderKey;
  status?: OAuthProviderStatus;
  onClose: () => void;
  onSaved: () => void;
  saveLabel?: string;
  onUsePassword?: () => void;
}) {
  const ws = useWs();
  const qc = useQueryClient();
  const toast = useToast();
  const c = COPY[provider];
  const [clientId, setClientId] = useState(status?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [tenant, setTenant] = useState(status?.tenant ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api<{ ok: boolean; verified: boolean }>(`/v1/workspaces/${ws}/oauth/${provider}`, { method: "PUT", body: { clientId, clientSecret, ...(provider === "microsoft" && tenant.trim() ? { tenant } : {}) } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: oauthStatusKey(ws) });
      toast(`${c.name} sign-in saved`);
      onSaved();
    },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/v1/workspaces/${ws}/oauth/${provider}`, { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: oauthStatusKey(ws) });
      toast(`${c.name} credentials removed`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const editing = status?.source === "workspace";
  const ready = clientId.trim().length >= 10 && clientSecret.trim().length >= 6;

  return (
    <Modal open onClose={onClose} title={`Set up ${c.name} sign-in`} icon={<KeyRound size={20} />} subtitle="Paste the credentials from your app. Mailboxes then connect with one click." footer={<>
      {onUsePassword && <button className="btn-ghost mr-auto" onClick={onUsePassword}>Use a password instead</button>}
      {editing && !onUsePassword && <button className="btn-ghost mr-auto text-red-600" disabled={remove.isPending} onClick={() => confirm(`Remove the saved ${c.name} credentials? Mailboxes already connected will stop refreshing until you add them again.`) && remove.mutate()}>Remove</button>}
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!ready || save.isPending} onClick={() => { setError(null); save.mutate(); }}>{save.isPending ? "Checking…" : saveLabel}</button>
    </>}>
      <div className="space-y-4">
        {status?.source === "server" && <p className="text-sm rounded-lg bg-ink-100 px-3 py-2">This server already has {c.name} credentials in its <code>.env</code> file. Saving here replaces them for this workspace only.</p>}
        <div>
          <label className="label">Client ID</label>
          <input className="input h-10" value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus spellCheck={false} placeholder={provider === "google" ? "1234567890-abc….apps.googleusercontent.com" : "00000000-0000-0000-0000-000000000000"} />
        </div>
        <div>
          <label className="label">Client Secret</label>
          <div className="relative">
            <input className="input h-10 pr-10" type={showSecret ? "text" : "password"} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} autoComplete="off"
              placeholder={editing ? "Enter the secret again to save changes" : ""} />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" aria-label={showSecret ? "Hide secret" : "Show secret"} onClick={() => setShowSecret((x) => !x)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
        </div>
        {provider === "microsoft" && (
          <div>
            <label className="label">Directory (tenant) ID <span className="font-normal text-ink-400">(optional)</span></label>
            <input className="input h-10" value={tenant} onChange={(e) => setTenant(e.target.value)} spellCheck={false} placeholder="Leave blank to allow any Microsoft account" />
          </div>
        )}
        {error && <div className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

        <div>
          <div className="label">Redirect URI</div>
          <div className="flex gap-2">
            <input className="input h-10 font-mono text-xs" readOnly value={status?.redirectUri ?? ""} onFocus={(e) => e.target.select()} />
            <button className="btn-secondary h-10" onClick={() => { navigator.clipboard?.writeText(status?.redirectUri ?? ""); toast("Copied"); }}><Copy size={15} /> Copy</button>
          </div>
          <p className="text-xs text-ink-500 mt-1">Add this exactly as an authorised redirect URI in the {c.console}.</p>
        </div>

        <details className="rounded-lg border border-ink-200 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Where do I find these?</summary>
          <ol className="list-decimal pl-5 mt-2 space-y-1.5 text-ink-700">{c.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
        </details>
      </div>
    </Modal>
  );
}
