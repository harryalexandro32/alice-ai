CREATE TABLE "orders" (
	"project" text NOT NULL,
	"order_id" text NOT NULL,
	"shop_id" text NOT NULL,
	"platform" text,
	"status" text NOT NULL,
	"create_time" bigint,
	"update_time" bigint,
	"paid_time" bigint,
	"cancel_time" bigint,
	"total_amount" text,
	"currency" text,
	"payment_method" text,
	"is_cod" boolean DEFAULT false NOT NULL,
	"buyer_user_id" text,
	"recipient_name" text,
	"recipient_phone" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tracking_number" text,
	"shipping_provider" text,
	"fulfillment_type" text,
	"shipping_type" text,
	"cancel_reason" text,
	"contact_phone" text,
	"synced_at" bigint NOT NULL,
	CONSTRAINT "orders_project_order_id_pk" PRIMARY KEY("project","order_id")
);
--> statement-breakpoint
CREATE TABLE "shop_links" (
	"project" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"shop_cipher" text NOT NULL,
	"shop_name" text,
	"region" text,
	"seller_name" text,
	"open_id" text,
	"access_token" text NOT NULL,
	"access_expires_at" bigint NOT NULL,
	"refresh_token" text NOT NULL,
	"refresh_expires_at" bigint NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_at" bigint NOT NULL,
	"last_sync_at" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"error" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"project" text NOT NULL,
	"type" integer NOT NULL,
	"at" bigint NOT NULL,
	"pending" jsonb,
	"tries" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "orders_update_time" ON "orders" USING btree ("project","update_time");--> statement-breakpoint
CREATE INDEX "shop_links_shop" ON "shop_links" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "webhook_events_at" ON "webhook_events" USING btree ("at");