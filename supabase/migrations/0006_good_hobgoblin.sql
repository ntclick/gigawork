CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_id" bigint,
	"owner_address" text NOT NULL,
	"agent_type" text,
	"name" text,
	"description" text,
	"capabilities" text[],
	"wallet_id" text,
	"wallet_address" text,
	"metadata_uri" text,
	"reputation_score" numeric DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agents_onchain_id_unique" UNIQUE("onchain_id")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"onchain_job_id" bigint,
	"client_agent_id" uuid,
	"provider_agent_id" uuid,
	"status" text,
	"budget_usdc" numeric,
	"description" text,
	"deliverable_hash" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"funded_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_onchain_job_id_unique" UNIQUE("onchain_job_id")
);
--> statement-breakpoint
CREATE TABLE "nanopayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" uuid,
	"to_agent_id" uuid,
	"amount_usdc" numeric,
	"purpose" text,
	"status" text,
	"authorization" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"agent_id" uuid,
	"role" text,
	"message" text,
	"price_offer" numeric,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"node_id" uuid,
	"skill_name" text,
	"agent_id" text,
	"type" text NOT NULL,
	"status" text,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quote_id" text,
	"payment_id" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_agent_id_agents_id_fk" FOREIGN KEY ("client_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_provider_agent_id_agents_id_fk" FOREIGN KEY ("provider_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanopayments" ADD CONSTRAINT "nanopayments_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanopayments" ADD CONSTRAINT "nanopayments_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_events_workflow_id_idx" ON "workflow_events" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_events_node_id_idx" ON "workflow_events" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "workflow_events_created_at_idx" ON "workflow_events" USING btree ("created_at");