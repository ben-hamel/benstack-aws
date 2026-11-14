CREATE TYPE "public"."product_research_state" AS ENUM('queued', 'paused', 'running', 'awaiting_review', 'approved', 'rejected', 'unresolved', 'failed');--> statement-breakpoint
CREATE TABLE "approved_product" (
	"identity_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"variant" text,
	"size_text" text,
	"pack_text" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approved_product_name_nonempty" CHECK (length(trim("approved_product"."name")) > 0),
	CONSTRAINT "approved_product_version_positive" CHECK ("approved_product"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"merchant" text DEFAULT 'costco' NOT NULL,
	"market" text DEFAULT 'CA' NOT NULL,
	"sku" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_identity_key_unique" UNIQUE("organization_id","merchant","market","sku"),
	CONSTRAINT "product_identity_supported_key" CHECK ("product_identity"."merchant" = 'costco' AND "product_identity"."market" = 'CA' AND "product_identity"."sku" ~ '^[0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "product_research_daily_usage" (
	"scope_key" text NOT NULL,
	"day" date NOT NULL,
	"organization_id" text,
	"admitted_jobs" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_research_daily_scope_unique" UNIQUE("scope_key","day"),
	CONSTRAINT "product_research_daily_nonnegative" CHECK ("product_research_daily_usage"."admitted_jobs" >= 0),
	CONSTRAINT "product_research_daily_scope_valid" CHECK (("product_research_daily_usage"."scope_key" = 'global' AND "product_research_daily_usage"."organization_id" IS NULL) OR ("product_research_daily_usage"."organization_id" IS NOT NULL AND "product_research_daily_usage"."scope_key" = 'org:' || "product_research_daily_usage"."organization_id"))
);
--> statement-breakpoint
CREATE TABLE "product_research_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" "product_research_state" NOT NULL,
	"reason" text,
	"cooldown_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_research_generation_unique" UNIQUE("identity_id","generation"),
	CONSTRAINT "product_research_request_identity_unique" UNIQUE("id","identity_id"),
	CONSTRAINT "product_research_generation_positive" CHECK ("product_research_request"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "product_research_receipt_item" (
	"receipt_item_id" uuid PRIMARY KEY NOT NULL,
	"identity_id" uuid,
	"request_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_research_link_identity_required" CHECK ("product_research_receipt_item"."request_id" IS NULL OR "product_research_receipt_item"."identity_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "approved_product" ADD CONSTRAINT "approved_product_identity_id_product_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."product_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_identity" ADD CONSTRAINT "product_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_daily_usage" ADD CONSTRAINT "product_research_daily_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD CONSTRAINT "product_research_request_identity_id_product_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."product_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_receipt_item" ADD CONSTRAINT "product_research_receipt_item_receipt_item_id_receipt_item_id_fk" FOREIGN KEY ("receipt_item_id") REFERENCES "public"."receipt_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_receipt_item" ADD CONSTRAINT "product_research_receipt_item_identity_id_product_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."product_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_receipt_item" ADD CONSTRAINT "product_research_receipt_item_request_id_identity_id_product_research_request_id_identity_id_fk" FOREIGN KEY ("request_id","identity_id") REFERENCES "public"."product_research_request"("id","identity_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_research_one_active_identity" ON "product_research_request" USING btree ("identity_id") WHERE "product_research_request"."state" IN ('queued', 'paused', 'running', 'awaiting_review');--> statement-breakpoint
CREATE INDEX "product_research_queue_idx" ON "product_research_request" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "product_research_receipt_request_idx" ON "product_research_receipt_item" USING btree ("request_id");