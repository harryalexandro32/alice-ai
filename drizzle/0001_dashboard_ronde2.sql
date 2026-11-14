CREATE TABLE "handoffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"phone" text NOT NULL,
	"question" text NOT NULL,
	"at" bigint NOT NULL,
	"resolved_at" bigint,
	"answer" text,
	"resolution" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "stage" text DEFAULT 'baru' NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" text;--> statement-breakpoint
CREATE INDEX "handoffs_project" ON "handoffs" USING btree ("project","id");