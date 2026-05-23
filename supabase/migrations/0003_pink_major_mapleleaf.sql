CREATE TABLE "raffle_winners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raffle_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"username" text NOT NULL,
	"merkle_proof" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raffles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"prize_description" text,
	"winner_count" integer NOT NULL,
	"total_entries" integer NOT NULL,
	"merkle_root" text NOT NULL,
	"commit_block" integer NOT NULL,
	"drawn" boolean DEFAULT false NOT NULL,
	"seed" text,
	"on_chain_raffle_id" integer,
	"tx_hash" text,
	"contract_address" text,
	"raw_entries" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raffle_winners" ADD CONSTRAINT "raffle_winners_raffle_id_raffles_id_fk" FOREIGN KEY ("raffle_id") REFERENCES "public"."raffles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raffles" ADD CONSTRAINT "raffles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raffle_winners_raffle_id_idx" ON "raffle_winners" USING btree ("raffle_id");--> statement-breakpoint
CREATE INDEX "raffles_user_id_idx" ON "raffles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deployments_workflow_id_idx" ON "deployments" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "deployments_user_id_idx" ON "deployments" USING btree ("user_id");