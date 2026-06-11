CREATE TABLE "agent_liveness" (
	"agent_address" text PRIMARY KEY NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'INACTIVE' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"avg_response_ms" integer DEFAULT 0 NOT NULL,
	"uptime_30d_pct" integer DEFAULT 100 NOT NULL,
	"consecutive_job_failures" integer DEFAULT 0 NOT NULL,
	"skill_tags_active" text[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "heartbeat_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_address" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"avg_response_ms" integer NOT NULL,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "nanopayment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"step_id" text,
	"skill_name" text NOT NULL,
	"amount_usdc" text NOT NULL,
	"buyer_address" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "timing" jsonb;--> statement-breakpoint
ALTER TABLE "raffles" ADD COLUMN "cosmic_proof" jsonb;--> statement-breakpoint
ALTER TABLE "chain_jobs" ADD CONSTRAINT "chain_jobs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nanopayment_events" ADD CONSTRAINT "nanopayment_events_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nanopayment_events_workflow_id_idx" ON "nanopayment_events" USING btree ("workflow_id");