ALTER TABLE "mailboxes" ADD COLUMN "tracking_domain" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "tracking_domain_verified" boolean DEFAULT false NOT NULL;