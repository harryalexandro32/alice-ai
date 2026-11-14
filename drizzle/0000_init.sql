CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"at" bigint NOT NULL,
	"kind" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_off" (
	"project" text NOT NULL,
	"address" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "bot_off_project_address_pk" PRIMARY KEY("project","address")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"project" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"lead" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_sales" integer DEFAULT 0 NOT NULL,
	"first_seen_at" bigint NOT NULL,
	"last_inbound_at" bigint NOT NULL,
	"last_dir" text DEFAULT 'in' NOT NULL,
	"last_out_text" text,
	"followup_state" text DEFAULT 'idle' NOT NULL,
	"followup_total" integer DEFAULT 0 NOT NULL,
	"lead_sent_at" bigint,
	"handoff_sent_at" bigint,
	"summary" text,
	"wa_name" text,
	"handled_at" bigint,
	"imported" integer DEFAULT 0 NOT NULL,
	"pending_off" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "contacts_project_phone_pk" PRIMARY KEY("project","phone")
);
--> statement-breakpoint
CREATE TABLE "errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"at" bigint NOT NULL,
	"level" text NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "human_seen" (
	"project" text NOT NULL,
	"address" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "human_seen_project_address_pk" PRIMARY KEY("project","address")
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"project" text NOT NULL,
	"day" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "llm_usage_project_day_pk" PRIMARY KEY("project","day")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"phone" text NOT NULL,
	"dir" text NOT NULL,
	"text" text NOT NULL,
	"at" bigint NOT NULL,
	"wa_id" text,
	CONSTRAINT "messages_wa_id" UNIQUE("project","wa_id")
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"done_at" bigint
);
--> statement-breakpoint
CREATE TABLE "pauses" (
	"project" text NOT NULL,
	"address" text NOT NULL,
	"until" bigint NOT NULL,
	CONSTRAINT "pauses_project_address_pk" PRIMARY KEY("project","address")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"project" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_status" (
	"project" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'stopped' NOT NULL,
	"qr" text,
	"pairing_code" text,
	"self_phone" text,
	"detail" text,
	"usage_calls" integer,
	"usage_limit" integer,
	"guard" text,
	"transport" text,
	"effective" jsonb,
	"channels" jsonb,
	"version" text,
	"pid" integer,
	"started_at" bigint,
	"last_seen_at" bigint
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template" text DEFAULT 'generic' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"transport" text DEFAULT 'baileys' NOT NULL,
	"wa_number" text,
	"sales_number" text,
	"pairing_request" jsonb,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_project_projects_id_fk" FOREIGN KEY ("project") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_project" ON "alerts" USING btree ("project","id");--> statement-breakpoint
CREATE INDEX "contacts_address" ON "contacts" USING btree ("project","address");--> statement-breakpoint
CREATE INDEX "contacts_last_inbound" ON "contacts" USING btree ("project","last_inbound_at");--> statement-breakpoint
CREATE INDEX "errors_project" ON "errors" USING btree ("project","id");--> statement-breakpoint
CREATE INDEX "messages_phone" ON "messages" USING btree ("project","phone","id");--> statement-breakpoint
CREATE INDEX "outbox_project" ON "outbox" USING btree ("project","id");