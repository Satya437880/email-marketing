ALTER TABLE "users" ADD COLUMN "microsoft_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_microsoft_sub_unique" UNIQUE("microsoft_sub");