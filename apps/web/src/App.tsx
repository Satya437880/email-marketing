import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { api, type Me } from "./api";
import { AuthPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/Auth";
import { AnalyticsPage } from "./pages/Analytics";
import { ContactsPage } from "./pages/Contacts";
import { MailboxesPage } from "./pages/Mailboxes";
import { PrimeboxPage } from "./pages/Primebox";
import { SequenceBuilder } from "./pages/SequenceBuilder";
import { ComposePage } from "./pages/Compose";
import { InvitePage } from "./pages/Invite";
import { EmailsPage } from "./pages/Emails";
import { SequencesPage } from "./pages/Sequences";
import { SettingsPage } from "./pages/Settings";
import { Shell } from "./Shell";
import { Spinner } from "./ui";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/v1/me"), retry: false });
}

export function useWs() {
  const { ws } = useParams();
  return ws!;
}

function Home() {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Navigate to="/login" replace />;
  const first = me.data.workspaces[0];
  return first ? <Navigate to={`/${first.slug}/inbox`} replace /> : <Navigate to="/login" replace />;
}

function Protected() {
  const me = useMe();
  const { ws } = useParams();
  if (me.isLoading) return <div className="h-full grid place-items-center"><Spinner /></div>;
  if (!me.data) return <Navigate to="/login" replace />;
  const workspace = me.data.workspaces.find((w) => w.slug === ws);
  if (!workspace) return <Navigate to="/" replace />;
  if (workspace.role === "primebox") {
    return (
      <Shell me={me.data} workspace={workspace}>
        <Routes>
          <Route path="inbox/*" element={<PrimeboxPage />} />
          <Route path="*" element={<Navigate to="inbox" replace />} />
        </Routes>
      </Shell>
    );
  }
  return (
    <Shell me={me.data} workspace={workspace}>
      <Routes>
        <Route path="inbox/*" element={<PrimeboxPage />} />
        <Route path="emails" element={<EmailsPage />} />
        <Route path="emails/compose" element={<ComposePage />} />
        <Route path="sequences" element={<SequencesPage />} />
        <Route path="sequences/:id/*" element={<SequenceBuilder />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="senders/*" element={<MailboxesPage />} />
        <Route path="contacts/*" element={<ContactsPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="inbox" replace />} />
      </Routes>
    </Shell>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/signup" element={<AuthPage mode="signup" />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/:ws/*" element={<Protected />} />
    </Routes>
  );
}
