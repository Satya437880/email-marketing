CREATE TABLE "pending_signups" (
	"email" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"password_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
