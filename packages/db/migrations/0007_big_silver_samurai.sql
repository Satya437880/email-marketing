CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'generic' NOT NULL,
	"events" text[] NOT NULL,
	"secret" text NOT NULL,
	"last_status" integer,
	"last_error" text,
	"last_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;