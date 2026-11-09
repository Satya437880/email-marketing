CREATE TABLE "subsequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_sequence_id" uuid NOT NULL,
	"child_sequence_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"label_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subsequences" ADD CONSTRAINT "subsequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subsequences" ADD CONSTRAINT "subsequences_parent_sequence_id_sequences_id_fk" FOREIGN KEY ("parent_sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subsequences" ADD CONSTRAINT "subsequences_child_sequence_id_sequences_id_fk" FOREIGN KEY ("child_sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subsequences" ADD CONSTRAINT "subsequences_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subsequences_parent" ON "subsequences" USING btree ("parent_sequence_id","trigger");