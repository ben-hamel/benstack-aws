CREATE TABLE "product_research_admission_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_id" uuid NOT NULL,
	"source_request_id" uuid NOT NULL,
	"result_request_id" uuid NOT NULL,
	"actor_user_id" text,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_research_admission_action_key" UNIQUE("identity_id","idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "product_research_admission_action" ADD CONSTRAINT "product_research_admission_action_identity_id_product_identity_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."product_identity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_admission_action" ADD CONSTRAINT "product_research_admission_action_source_request_id_product_research_request_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."product_research_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_admission_action" ADD CONSTRAINT "product_research_admission_action_result_request_id_product_research_request_id_fk" FOREIGN KEY ("result_request_id") REFERENCES "public"."product_research_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_research_admission_action" ADD CONSTRAINT "product_research_admission_action_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;