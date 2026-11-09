ALTER TABLE "sequence_contacts" ADD COLUMN "no_reply_fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subsequences" ADD COLUMN "wait_days" integer DEFAULT 3 NOT NULL;