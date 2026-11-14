ALTER TYPE "public"."product_research_state" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "product_research_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"selected_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"weak_evidence_acknowledged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_research_decision_key_unique" UNIQUE("request_id","idempotency_key"),
	CONSTRAINT "product_research_one_decision" UNIQUE("request_id"),
	CONSTRAINT "product_research_decision_action" CHECK ("product_research_decision"."action" IN ('approve', 'reject'))
);
--> statement-breakpoint
CREATE TABLE "product_research_proposal" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"result" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "base_product_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "requested_by" text;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD COLUMN "admission_key" uuid;--> statement-breakpoint
ALTER TABLE "product_research_decision" ADD CONSTRAINT "product_research_decision_request_id_product_research_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."product_research_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_decision" ADD CONSTRAINT "product_research_decision_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_proposal" ADD CONSTRAINT "product_research_proposal_request_id_product_research_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."product_research_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD CONSTRAINT "product_research_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_request" ADD CONSTRAINT "product_research_admission_key_unique" UNIQUE("identity_id","admission_key");