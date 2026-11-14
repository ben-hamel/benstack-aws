-- Compatibility baseline: these schemas existed via db:push before migrations
-- tracked them. Add missing objects without deleting or rewriting existing data.
-- Existing installations must pass the documented schema preflight before use.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "reference";
--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."receipt_item_type" AS ENUM('item', 'deposit', 'discount', 'eco_fee', 'fuel'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."receipt_job_status" AS ENUM('pending', 'processing', 'done', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."receipt_source" AS ENUM('json', 'pdf'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."receipt_type" AS ENUM('warehouse', 'gas_station'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference"."costco_item_category_map" (
	"item_number" text PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference"."spending_category" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_thread_id_unique" UNIQUE("thread_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"type" "receipt_item_type" DEFAULT 'item' NOT NULL,
	"description" text NOT NULL,
	"item_number" text,
	"department_number" integer,
	"unit_price" numeric(10, 2),
	"quantity" integer DEFAULT 1 NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"tax_flag" text,
	"fuel_quantity_litres" numeric(10, 3),
	"fuel_price_per_litre" numeric(10, 3),
	"parent_item_number" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"status" "receipt_job_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text NOT NULL,
	"imported" integer,
	"skipped" integer,
	"total" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_tax" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"legend" text NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"amount" numeric(10, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_tender" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"description" text,
	"tender_type_code" text,
	"amount" numeric(10, 2) NOT NULL,
	"card_last4" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"source" "receipt_source" NOT NULL,
	"receipt_type" "receipt_type" NOT NULL,
	"transaction_date" date NOT NULL,
	"transaction_date_time_local" timestamp,
	"transaction_date_time_utc" timestamp with time zone,
	"transaction_barcode" text NOT NULL,
	"subtotal" numeric(10, 2),
	"taxes" numeric(10, 2),
	"total" numeric(10, 2) NOT NULL,
	"instant_savings" numeric(10, 2),
	"store_name" text,
	"store_number" integer,
	"store_city" text,
	"store_province" text,
	"membership_number" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_barcode_unique" UNIQUE("organization_id","transaction_barcode")
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "reference"."costco_item_category_map" ADD CONSTRAINT "costco_item_category_map_category_id_spending_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "reference"."spending_category"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "chat" ADD CONSTRAINT "chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "chat" ADD CONSTRAINT "chat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "receipt_item" ADD CONSTRAINT "receipt_item_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "receipt_job" ADD CONSTRAINT "receipt_job_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "receipt_tax" ADD CONSTRAINT "receipt_tax_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "receipt_tender" ADD CONSTRAINT "receipt_tender_receipt_id_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipt"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "receipt" ADD CONSTRAINT "receipt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "spending_category_parent_id_idx" ON "reference"."spending_category" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_user_id_idx" ON "chat" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_org_id_idx" ON "chat" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_item_receipt_id_idx" ON "receipt_item" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_item_number_idx" ON "receipt_item" USING btree ("item_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_item_description_trgm_idx" ON "receipt_item" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_job_org_id_idx" ON "receipt_job" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_tax_receipt_id_idx" ON "receipt_tax" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_tender_receipt_id_idx" ON "receipt_tender" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_org_id_idx" ON "receipt" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_date_idx" ON "receipt" USING btree ("organization_id","transaction_date");