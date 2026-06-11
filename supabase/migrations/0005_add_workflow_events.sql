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
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workflow_events_workflow_id_idx" ON "workflow_events" USING btree ("workflow_id");
--> statement-breakpoint
CREATE INDEX "workflow_events_node_id_idx" ON "workflow_events" USING btree ("node_id");
--> statement-breakpoint
CREATE INDEX "workflow_events_created_at_idx" ON "workflow_events" USING btree ("created_at");
