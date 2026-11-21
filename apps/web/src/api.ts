export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "include",
    headers: {
      "x-requested-with": "outreach",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "error", data?.message ?? res.statusText, data?.details);
  return data as T;
}

export interface Workspace { id: string; slug: string; name: string; timezone: string; autoLabel: boolean; role: string }
export interface Me { user: { id: string; name: string; email: string }; workspaces: Workspace[] }

export interface Mailbox {
  id: string; email: string; fromName: string; provider: "google" | "microsoft" | "smtp"; status: "active" | "paused" | "disconnected" | "error";
  statusError: string | null; dailyLimit: number; minGapSeconds: number; maxGapSeconds: number; timezone: string; signatureHtml: string;
  sentToday: number; sentYesterday: number; tags: string[]; lastSyncAt: string | null;
  trackingDomain: string | null; trackingDomainVerified: boolean;
  domain: { name: string; spfOk: boolean | null; dkimOk: boolean | null; dmarcOk: boolean | null } | null;
}

export interface SenderProfile {
  id: string; name: string; signatureHtml: string; mailboxes: { id: string; email: string; status: string }[]; dailyCap: number; sentToday: number;
}

export interface Contact {
  id: string; email: string; firstName: string; lastName: string; title: string; companyName: string; linkedinUrl: string;
  esp: string; validationStatus: string; variables: Record<string, string>; lastContactedAt: string | null; unsubscribedAt: string | null; createdAt?: string;
  tags: { id: string; name: string }[];
}

export interface Tag { id: string; name: string; contacts: number; sequences: { id: string; name: string; progress: number }[] }

export interface SequenceSettings {
  schedule: { timezone: string; days: number[]; start: string; end: string; hours?: Record<string, { start: string; end: string }> };
  inSequencePriority: "new_first" | "followups_first";
  stopOnCompanyReply: boolean; sequentialWithinCompany: boolean; companyLimit: number | null;
  oooAutoResume: boolean; oooBufferDays: number; plainText: boolean; espMatching: boolean;
  optOut: { enabled: boolean; text: string; replyOnly?: boolean }; trackOpens: boolean; trackClicks: boolean; cc: string[]; bcc: string[];
  language?: string; productId?: string | null; pauseOnClick?: boolean; pauseOnOpen?: boolean; bounceShield?: boolean; trackOpportunities?: boolean;
}

export interface SequenceRow {
  id: string; name: string; status: "draft" | "active" | "paused" | "completed"; priority: "high" | "regular"; createdAt: string; launchedAt: string | null;
  contacts: number; progress: number; contacted: number; emailsSent: number; replied: number; replyRate: number; positive: number;
  bounced: number; optedOut: number; opened: number; clicked: number;
  senders: { id: string; name: string }[];
}

export interface Attachment { name: string; type: string; size: number; data: string }
export interface Variant { id?: string; label: string; subject: string; bodyHtml: string; weight: number; attachments?: Attachment[] }
export interface Step { id?: string; type: "delay" | "email"; name: string; delayDays: number; delayMinutes: number; variants: Variant[]; sent?: number; waiting?: number }
export interface SequenceDetail extends Pick<SequenceRow, "id" | "name" | "status" | "priority" | "createdAt" | "launchedAt"> {
  settings: SequenceSettings; steps: Step[]; senderProfileIds: string[]; contactCount: number;
}

export interface Label { id: string; name: string; color: string; system: boolean; countsAs: string; count: number; unread?: number }

export interface ThreadRow {
  id: string; subject: string; unread: boolean; lastMessageAt: string; reminderAt: string | null; labelId: string | null;
  sequenceId: string | null; mailboxId: string; snippet: string | null;
  contact: { id: string; email: string; firstName: string; lastName: string; companyName: string } | null;
}

export interface Message {
  id: string; direction: "in" | "out"; fromAddress: string; fromName: string; toAddress: string; subject: string; bodyHtml: string; bodyText: string; sentAt: string;
}

export interface ThreadDetail extends Omit<ThreadRow, "snippet" | "contact"> {
  messages: Message[]; contact: Contact | null; mailbox: { id: string; email: string; fromName: string }; sequence: { id: string; name: string } | null;
}

export interface Paged<T> { items: T[]; total: number }
