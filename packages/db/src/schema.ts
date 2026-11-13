import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ws = () => uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

// member = "Standard" in the UI; primebox = can only read and answer replies in Primebox.
export const roleEnum = pgEnum("role", ["owner", "admin", "member", "viewer", "primebox"]);
export const providerEnum = pgEnum("mailbox_provider", ["google", "microsoft", "smtp"]);
export const mailboxStatusEnum = pgEnum("mailbox_status", ["active", "paused", "disconnected", "error"]);
export const sequenceStatusEnum = pgEnum("sequence_status", ["draft", "active", "paused", "completed"]);
export const stepTypeEnum = pgEnum("step_type", ["delay", "email"]);
export const scStateEnum = pgEnum("sequence_contact_state", [
  "queued", "active", "sending", "replied", "ooo", "bounced", "opted_out", "finished", "error",
]);
export const directionEnum = pgEnum("message_direction", ["out", "in"]);
export const dncTypeEnum = pgEnum("dnc_type", ["email", "domain"]);
export const eventTypeEnum = pgEnum("event_type", [
  "sent", "opened", "clicked", "replied", "bounced", "opted_out", "labeled", "ooo",
]);
export const importStatusEnum = pgEnum("import_status", ["pending", "running", "done", "failed"]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  // When on, a DNC entry in any of this account's workspaces blocks sending in all of them.
  mergeDnc: boolean("merge_dnc").notNull().default(false),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  autoLabel: boolean("auto_label").notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  googleSub: text("google_sub").unique(),
  microsoftSub: text("microsoft_sub").unique(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const memberships = pgTable("memberships", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: ws(),
  role: roleEnum("role").notNull().default("member"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const apiKeys = pgTable("api_keys", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const domains = pgTable("domains", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  spfOk: boolean("spf_ok"),
  dkimOk: boolean("dkim_ok"),
  dmarcOk: boolean("dmarc_ok"),
  mxOk: boolean("mx_ok"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("domains_ws_name").on(t.workspaceId, t.name)]);

export const mailboxes = pgTable("mailboxes", {
  id: id(),
  workspaceId: ws(),
  domainId: uuid("domain_id").references(() => domains.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  fromName: text("from_name").notNull().default(""),
  provider: providerEnum("provider").notNull(),
  // AES-GCM encrypted JSON: { auth, server }
  credentials: text("credentials").notNull(),
  status: mailboxStatusEnum("status").notNull().default("active"),
  statusError: text("status_error"),
  dailyLimit: integer("daily_limit").notNull().default(50),
  minGapSeconds: integer("min_gap_seconds").notNull().default(180),
  maxGapSeconds: integer("max_gap_seconds").notNull().default(480),
  timezone: text("timezone").notNull().default("UTC"),
  signatureHtml: text("signature_html").notNull().default(""),
  // Custom tracking domain (CNAME to the tracking host); only used once verified.
  trackingDomain: text("tracking_domain"),
  trackingDomainVerified: boolean("tracking_domain_verified").notNull().default(false),
  nextAvailableAt: timestamp("next_available_at", { withTimezone: true }),
  imapLastUid: bigint("imap_last_uid", { mode: "number" }).notNull().default(0),
  imapUidValidity: text("imap_uid_validity"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mailboxes_ws_email").on(t.workspaceId, t.email)]);

export const mailboxDailyStats = pgTable("mailbox_daily_stats", {
  mailboxId: uuid("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  sent: integer("sent").notNull().default(0),
  bounced: integer("bounced").notNull().default(0),
  replies: integer("replies").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.mailboxId, t.day] })]);

export const senderProfiles = pgTable("sender_profiles", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  signatureHtml: text("signature_html").notNull().default(""),
  // Set when the profile only holds mailboxes picked directly inside one sequence.
  ownerSequenceId: uuid("owner_sequence_id"),
  createdAt: createdAt(),
});

export const senderProfileMailboxes = pgTable("sender_profile_mailboxes", {
  senderProfileId: uuid("sender_profile_id").notNull().references(() => senderProfiles.id, { onDelete: "cascade" }),
  mailboxId: uuid("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.senderProfileId, t.mailboxId] })]);

export const companies = pgTable("companies", {
  id: id(),
  workspaceId: ws(),
  domain: text("domain").notNull(),
  name: text("name"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
}, (t) => [uniqueIndex("companies_ws_domain").on(t.workspaceId, t.domain)]);

export const contacts = pgTable("contacts", {
  id: id(),
  workspaceId: ws(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  title: text("title").notNull().default(""),
  companyName: text("company_name").notNull().default(""),
  linkedinUrl: text("linkedin_url").notNull().default(""),
  esp: text("esp").notNull().default("unknown"),
  validationStatus: text("validation_status").notNull().default("unverified"),
  variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("contacts_ws_email").on(t.workspaceId, t.email),
  index("contacts_company").on(t.companyId),
  index("contacts_variables").using("gin", t.variables),
]);

export const tags = pgTable("tags", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("tags_ws_name").on(t.workspaceId, t.name)]);

export const contactTags = pgTable("contact_tags", {
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.contactId, t.tagId] }), index("contact_tags_tag").on(t.tagId)]);

export const importJobs = pgTable("import_jobs", {
  id: id(),
  workspaceId: ws(),
  source: text("source").notNull(),
  status: importStatusEnum("status").notNull().default("pending"),
  total: integer("total").notNull().default(0),
  inserted: integer("inserted").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: jsonb("errors").$type<{ row: number; error: string }[]>().notNull().default([]),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const dncEntries = pgTable("dnc_entries", {
  id: id(),
  workspaceId: ws(),
  type: dncTypeEnum("type").notNull(),
  value: text("value").notNull(),
  source: text("source").notNull().default("manual"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("dnc_ws_type_value").on(t.workspaceId, t.type, t.value)]);

export interface SequenceSettings {
  schedule: { timezone: string; days: number[]; start: string; end: string; hours?: Record<string, { start: string; end: string }> };
  inSequencePriority: "new_first" | "followups_first";
  stopOnCompanyReply: boolean;
  sequentialWithinCompany: boolean;
  companyLimit: number | null;
  oooAutoResume: boolean;
  oooBufferDays: number;
  plainText: boolean;
  espMatching: boolean;
  optOut: { enabled: boolean; text: string };
  trackOpens: boolean;
  trackClicks: boolean;
  cc: string[];
  bcc: string[];
  // Added later: older sequences may not have these, so read them with the defaults below as fallback.
  language?: string;
  productId?: string | null;
  pauseOnClick?: boolean;
  pauseOnOpen?: boolean;
  bounceShield?: boolean;
  trackOpportunities?: boolean;
}

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  schedule: { timezone: "UTC", days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" },
  inSequencePriority: "followups_first",
  stopOnCompanyReply: true,
  sequentialWithinCompany: false,
  companyLimit: null,
  oooAutoResume: true,
  oooBufferDays: 2,
  plainText: false,
  espMatching: true,
  optOut: { enabled: true, text: "If you'd rather not hear from me, let me know" },
  trackOpens: false,
  trackClicks: false,
  cc: [],
  bcc: [],
  pauseOnClick: false,
  pauseOnOpen: false,
  bounceShield: true,
  trackOpportunities: true,
};

export const sequences = pgTable("sequences", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  status: sequenceStatusEnum("status").notNull().default("draft"),
  priority: text("priority").$type<"high" | "regular">().notNull().default("regular"),
  settings: jsonb("settings").$type<SequenceSettings>().notNull().$defaultFn(() => structuredClone(DEFAULT_SEQUENCE_SETTINGS)),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: id(),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  type: stepTypeEnum("type").notNull(),
  name: text("name").notNull().default(""),
  delayDays: integer("delay_days").notNull().default(0),
  // Waits shorter than a day (or not a whole number of days). The wait before a step is delay_days + delay_minutes.
  delayMinutes: integer("delay_minutes").notNull().default(0),
},(t) => [index("sequence_steps_seq").on(t.sequenceId, t.position)]);

// A file attached to an email step. Content is stored base64-encoded.
export interface StepAttachment { name: string; type: string; size: number; data: string }

export const stepVariants = pgTable("step_variants", {
  id: id(),
  stepId: uuid("step_id").notNull().references(() => sequenceSteps.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  subject: text("subject").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  weight: integer("weight").notNull().default(1),
  attachments: jsonb("attachments").$type<StepAttachment[]>().notNull().default([]),
});

export const sequenceSenders = pgTable("sequence_senders", {
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  senderProfileId: uuid("sender_profile_id").notNull().references(() => senderProfiles.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.sequenceId, t.senderProfileId] })]);

export const sequenceContacts = pgTable("sequence_contacts", {
  id: id(),
  workspaceId: ws(),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  state: scStateEnum("state").notNull().default("queued"),
  // Index of the last completed step; -1 before the first send.
  currentStep: integer("current_step").notNull().default(-1),
  nextStep: integer("next_step"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  assignedMailboxId: uuid("assigned_mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
  threadId: uuid("thread_id"),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sc_seq_contact").on(t.sequenceId, t.contactId),
  index("sc_due").on(t.state, t.nextRunAt),
  index("sc_contact").on(t.contactId),
]);

export const labels = pgTable("labels", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#64748b"),
  system: boolean("system").notNull().default(false),
  countsAs: text("counts_as").$type<"positive" | "negative" | "meeting" | "closed" | "neutral">().notNull().default("neutral"),
  position: integer("position").notNull().default(0),
}, (t) => [uniqueIndex("labels_ws_name").on(t.workspaceId, t.name)]);

export const threads = pgTable("threads", {
  id: id(),
  workspaceId: ws(),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  mailboxId: uuid("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id").references(() => sequences.id, { onDelete: "set null" }),
  subject: text("subject").notNull().default(""),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  // True once the contact has replied; Primebox only lists threads with inbound mail.
  hasInbound: boolean("has_inbound").notNull().default(false),
  unread: boolean("unread").notNull().default(false),
  labelId: uuid("label_id").references(() => labels.id, { onDelete: "set null" }),
  reminderAt: timestamp("reminder_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("threads_inbox").on(t.workspaceId, t.hasInbound, t.lastMessageAt),
  index("threads_contact").on(t.contactId),
]);

export const messages = pgTable("messages", {
  id: id(),
  workspaceId: ws(),
  threadId: uuid("thread_id").notNull().references(() => threads.id, { onDelete: "cascade" }),
  mailboxId: uuid("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  sequenceId: uuid("sequence_id").references(() => sequences.id, { onDelete: "set null" }),
  stepId: uuid("step_id").references(() => sequenceSteps.id, { onDelete: "set null" }),
  variantId: uuid("variant_id").references(() => stepVariants.id, { onDelete: "set null" }),
  direction: directionEnum("direction").notNull(),
  messageIdHeader: text("message_id_header").notNull(),
  inReplyTo: text("in_reply_to"),
  references: text("references").array().notNull().default(sql`'{}'::text[]`),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name").notNull().default(""),
  toAddress: text("to_address").notNull(),
  subject: text("subject").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  trackingToken: text("tracking_token").unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("messages_msgid").on(t.workspaceId, t.messageIdHeader),
  index("messages_thread").on(t.threadId, t.sentAt),
]);

export const WEBHOOK_EVENTS = ["reply.received", "label.changed", "email.sent", "contact.bounced", "contact.unsubscribed", "sequence.completed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhooks = pgTable("webhooks", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  // slack = Slack incoming webhook (posts a readable message); generic = signed JSON for your own server, Zapier, Make…
  kind: text("kind").$type<"generic" | "slack">().notNull().default("generic"),
  events: text("events").array().$type<WebhookEvent[]>().notNull(),
  secret: text("secret").notNull(),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  lastAt: timestamp("last_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// What the user sells; used as context for writing emails.
export const products = pgTable("products", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
});

export const templates = pgTable("templates", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  kind: text("kind").$type<"sequence" | "reply">().notNull().default("sequence"),
  createdAt: createdAt(),
});

export const events = pgTable("events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: ws(),
  type: eventTypeEnum("type").notNull(),
  contactId: uuid("contact_id"),
  sequenceId: uuid("sequence_id"),
  stepId: uuid("step_id"),
  variantId: uuid("variant_id"),
  mailboxId: uuid("mailbox_id"),
  messageId: uuid("message_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("events_ws_time").on(t.workspaceId, t.occurredAt),
  index("events_seq_type").on(t.sequenceId, t.type, t.occurredAt),
]);

export const SYSTEM_LABELS: { name: string; color: string; countsAs: "positive" | "negative" | "meeting" | "closed" | "neutral" }[] = [
  { name: "Positive", color: "#16a34a", countsAs: "positive" },
  { name: "Meeting booked", color: "#2563eb", countsAs: "meeting" },
  { name: "Meeting completed", color: "#0891b2", countsAs: "meeting" },
  { name: "Closed", color: "#7c3aed", countsAs: "closed" },
  { name: "Negative", color: "#dc2626", countsAs: "negative" },
  { name: "Wrong contact", color: "#ea580c", countsAs: "negative" },
  { name: "Not at this time", color: "#ca8a04", countsAs: "neutral" },
  { name: "Automatic", color: "#64748b", countsAs: "neutral" },
  { name: "Out of office", color: "#94a3b8", countsAs: "neutral" },
  { name: "Unsubscribed", color: "#991b1b", countsAs: "negative" },
];
