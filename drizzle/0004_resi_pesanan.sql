CREATE TABLE "track_usage" (
	"project" text NOT NULL,
	"day" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "track_usage_project_day_pk" PRIMARY KEY("project","day")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "order_ref" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "awb" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "courier" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "awb_at" bigint;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ship_status" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ship_history" jsonb;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ship_checked_at" bigint;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ship_error" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "ship_phase" text;