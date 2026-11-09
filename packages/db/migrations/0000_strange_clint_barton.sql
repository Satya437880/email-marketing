CREATE TYPE "public"."message_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."dnc_type" AS ENUM('email', 'domain');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('sent', 'opened', 'clicked', 'replied', 'bounced', 'opted_out', 'labeled', 'ooo');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mailbox_status" AS ENUM('active', 'paused', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."mailbox_provider" AS ENUM('google', 'microsoft', 'smtp');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sequence_contact_state" AS ENUM('queued', 'active', 'sending', 'replied', 'ooo', 'bounced', 'opted_out', 'finished', 'error');--> statement-breakpoint
CREATE TYPE "public"."sequence_status" AS ENUM('draft', 'active', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('delay', 'email');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid,
	"email" text NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"linkedin_url" text DEFAULT '' NOT NULL,
	"esp" text DEFAULT 'unknown' NOT NULL,
	"validation_status" text DEFAULT 'unverified' NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dnc_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "dnc_type" NOT NULL,
	"value" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"spf_ok" boolean,
	"dkim_ok" boolean,
	"dmarc_ok" boolean,
	"mx_ok" boolean,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"contact_id" uuid,
	"sequence_id" uuid,
	"step_id" uuid,
	"variant_id" uuid,
	"mailbox_id" uuid,
	"message_id" uuid,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"counts_as" text DEFAULT 'neutral' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_daily_stats" (
	"mailbox_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"bounced" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mailbox_daily_stats_mailbox_id_day_pk" PRIMARY KEY("mailbox_id","day")
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain_id" uuid,
	"email" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"provider" "mailbox_provider" NOT NULL,
	"credentials" text NOT NULL,
	"status" "mailbox_status" DEFAULT 'active' NOT NULL,
	"status_error" text,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"min_gap_seconds" integer DEFAULT 180 NOT NULL,
	"max_gap_seconds" integer DEFAULT 480 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"signature_html" text DEFAULT '' NOT NULL,
	"next_available_at" timestamp with time zone,
	"imap_last_uid" bigint DEFAULT 0 NOT NULL,
	"imap_uid_validity" text,
	"last_sync_at" timestamp with time zone,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_workspace_id_pk" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"contact_id" uuid,
	"sequence_id" uuid,
	"step_id" uuid,
	"variant_id" uuid,
	"direction" "message_direction" NOT NULL,
	"message_id_header" text NOT NULL,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"to_address" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"tracking_token" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tracking_token_unique" UNIQUE("tracking_token")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_profile_mailboxes" (
	"sender_profile_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	CONSTRAINT "sender_profile_mailboxes_sender_profile_id_mailbox_id_pk" PRIMARY KEY("sender_profile_id","mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "sender_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"signature_html" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"state" "sequence_contact_state" DEFAULT 'queued' NOT NULL,
	"current_step" integer DEFAULT -1 NOT NULL,
	"next_step" integer,
	"next_run_at" timestamp with time zone,
	"assigned_mailbox_id" uuid,
	"thread_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_senders" (
	"sequence_id" uuid NOT NULL,
	"sender_profile_id" uuid NOT NULL,
	CONSTRAINT "sequence_senders_sequence_id_sender_profile_id_pk" PRIMARY KEY("sequence_id","sender_profile_id")
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" "step_type" NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "sequence_status" DEFAULT 'draft' NOT NULL,
	"priority" text DEFAULT 'regular' NOT NULL,
	"settings" jsonb NOT NULL,
	"launched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL,
	"label" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'sequence' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"mailbox_id" uuid NOT NULL,
	"sequence_id" uuid,
	"subject" text DEFAULT '' NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"has_inbound" boolean DEFAULT false NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"label_id" uuid,
	"reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"auto_label" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dnc_entries" ADD CONSTRAINT "dnc_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_daily_stats" ADD CONSTRAINT "mailbox_daily_stats_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_variant_id_step_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."step_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_profile_mailboxes" ADD CONSTRAINT "sender_profile_mailboxes_sender_profile_id_sender_profiles_id_fk" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."sender_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_profile_mailboxes" ADD CONSTRAINT "sender_profile_mailboxes_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_profiles" ADD CONSTRAINT "sender_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_contacts" ADD CONSTRAINT "sequence_contacts_assigned_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("assigned_mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_senders" ADD CONSTRAINT "sequence_senders_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_senders" ADD CONSTRAINT "sequence_senders_sender_profile_id_sender_profiles_id_fk" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."sender_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_variants" ADD CONSTRAINT "step_variants_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_ws_domain" ON "companies" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE INDEX "contact_tags_tag" ON "contact_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_ws_email" ON "contacts" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_variables" ON "contacts" USING gin ("variables");--> statement-breakpoint
CREATE UNIQUE INDEX "dnc_ws_type_value" ON "dnc_entries" USING btree ("workspace_id","type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_ws_name" ON "domains" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "events_ws_time" ON "events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_seq_type" ON "events" USING btree ("sequence_id","type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_ws_name" ON "labels" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_ws_email" ON "mailboxes" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "messages_msgid" ON "messages" USING btree ("workspace_id","message_id_header");--> statement-breakpoint
CREATE INDEX "messages_thread" ON "messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_seq_contact" ON "sequence_contacts" USING btree ("sequence_id","contact_id");--> statement-breakpoint
CREATE INDEX "sc_due" ON "sequence_contacts" USING btree ("state","next_run_at");--> statement-breakpoint
CREATE INDEX "sc_contact" ON "sequence_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "sequence_steps_seq" ON "sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_ws_name" ON "tags" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "threads_inbox" ON "threads" USING btree ("workspace_id","has_inbound","last_message_at");--> statement-breakpoint
CREATE INDEX "threads_contact" ON "threads" USING btree ("contact_id");