CREATE TABLE "interaction_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"template_id" text,
	"template_version" integer DEFAULT 1 NOT NULL,
	"body" text,
	"status" varchar(32) DEFAULT 'DRAFT' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"external_response_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_responses_status_check" CHECK ("interaction_responses"."status" IN ('DRAFT', 'AUTO_RESPOND', 'MODERATION_REQUIRED', 'APPROVED', 'REJECTED', 'EDITED', 'SCHEDULED', 'QUEUED', 'IN_PROGRESS', 'RESPONDED', 'RETRY', 'FAILED', 'CANCELLED', 'UNKNOWN', 'RECONCILIATION')),
	CONSTRAINT "interaction_responses_template_version_check" CHECK ("interaction_responses"."template_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "interaction_response_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_category" varchar(64),
	"error_message" text,
	"external_response_id" text,
	"request_payload_hash" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_response_attempts_attempt_number_check" CHECK ("interaction_response_attempts"."attempt_number" > 0),
	CONSTRAINT "interaction_response_attempts_status_check" CHECK ("interaction_response_attempts"."status" IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "interaction_moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"reason" text,
	"previous_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_moderation_actions_action_check" CHECK ("interaction_moderation_actions"."action" IN ('APPROVE', 'REJECT', 'EDIT', 'ESCALATE'))
);
--> statement-breakpoint
CREATE TABLE "interaction_response_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"attempt_id" uuid,
	"status" varchar(32) NOT NULL,
	"checked_at" timestamp with time zone,
	"external_response_id" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_response_reconciliations_status_check" CHECK ("interaction_response_reconciliations"."status" IN ('RESPONDED', 'RETRY_ELIGIBLE', 'UNKNOWN'))
);
--> statement-breakpoint
ALTER TABLE "interaction_responses" ADD CONSTRAINT "interaction_responses_interaction_id_external_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."external_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_responses" ADD CONSTRAINT "interaction_responses_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_response_attempts" ADD CONSTRAINT "interaction_response_attempts_response_id_interaction_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."interaction_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_moderation_actions" ADD CONSTRAINT "interaction_moderation_actions_response_id_interaction_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."interaction_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_moderation_actions" ADD CONSTRAINT "interaction_moderation_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_response_reconciliations" ADD CONSTRAINT "interaction_response_reconciliations_response_id_interaction_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."interaction_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_response_reconciliations" ADD CONSTRAINT "interaction_response_reconciliations_attempt_id_interaction_response_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."interaction_response_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interaction_responses_interaction_id_uq" ON "interaction_responses" USING btree ("interaction_id");--> statement-breakpoint
CREATE INDEX "interaction_responses_status_scheduled_at_idx" ON "interaction_responses" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "interaction_responses_destination_status_idx" ON "interaction_responses" USING btree ("destination_id","status");--> statement-breakpoint
CREATE INDEX "interaction_responses_external_response_id_idx" ON "interaction_responses" USING btree ("external_response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interaction_response_attempts_response_attempt_uq" ON "interaction_response_attempts" USING btree ("response_id","attempt_number");--> statement-breakpoint
CREATE INDEX "interaction_response_attempts_status_idx" ON "interaction_response_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "interaction_moderation_actions_response_created_at_idx" ON "interaction_moderation_actions" USING btree ("response_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_moderation_actions_user_created_at_idx" ON "interaction_moderation_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "interaction_response_reconciliations_response_id_idx" ON "interaction_response_reconciliations" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "interaction_response_reconciliations_status_idx" ON "interaction_response_reconciliations" USING btree ("status");