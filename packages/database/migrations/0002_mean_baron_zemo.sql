CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"fields" text[] NOT NULL,
	"verify_token_encrypted" text NOT NULL,
	"verify_token_key_version" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_subscriptions_status_check" CHECK ("webhook_subscriptions"."status" IN ('ACTIVE', 'PAUSED', 'DISABLED')),
	CONSTRAINT "webhook_subscriptions_key_version_check" CHECK ("webhook_subscriptions"."verify_token_key_version" > 0),
	CONSTRAINT "webhook_subscriptions_fields_nonempty_check" CHECK (array_length("webhook_subscriptions"."fields", 1) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "webhook_subscription_health" (
	"subscription_id" uuid PRIMARY KEY NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"consecutive_successes" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error_category" varchar(64),
	"last_error_message" text,
	"events_today" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_subscription_health_failures_check" CHECK ("webhook_subscription_health"."consecutive_failures" >= 0),
	CONSTRAINT "webhook_subscription_health_successes_check" CHECK ("webhook_subscription_health"."consecutive_successes" >= 0),
	CONSTRAINT "webhook_subscription_health_events_today_check" CHECK ("webhook_subscription_health"."events_today" >= 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"destination_id" uuid,
	"object_type" varchar(32) NOT NULL,
	"external_object_id" text NOT NULL,
	"field" varchar(64),
	"idempotency_key" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"raw_body_hash" varchar(128) NOT NULL,
	"signature_verified" boolean NOT NULL,
	"trace_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(32) DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_status_check" CHECK ("webhook_events"."status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_category" varchar(64),
	"error_message" text,
	"worker_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_attempt_number_check" CHECK ("webhook_deliveries"."attempt_number" > 0),
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER'))
);
--> statement-breakpoint
CREATE TABLE "external_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" uuid,
	"destination_id" uuid,
	"publication_id" uuid,
	"interaction_type" varchar(32) NOT NULL,
	"external_interaction_id" text NOT NULL,
	"parent_external_id" text,
	"actor_external_id" text,
	"actor_display_name" text,
	"content" text,
	"permalink" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_interactions_type_check" CHECK ("external_interactions"."interaction_type" IN ('COMMENT', 'REACTION', 'MENTION'))
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_subscription_health" ADD CONSTRAINT "webhook_subscription_health_subscription_id_webhook_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."webhook_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_interactions" ADD CONSTRAINT "external_interactions_webhook_event_id_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_interactions" ADD CONSTRAINT "external_interactions_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_subscriptions_destination_provider_uq" ON "webhook_subscriptions" USING btree ("destination_id","provider");--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_status_idx" ON "webhook_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "webhook_subscription_health_last_failure_at_idx" ON "webhook_subscription_health" USING btree ("last_failure_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_idempotency_key_uq" ON "webhook_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_destination_received_at_idx" ON "webhook_events" USING btree ("destination_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_field_received_at_idx" ON "webhook_events" USING btree ("field","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_trace_id_idx" ON "webhook_events" USING btree ("trace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_attempt_uq" ON "webhook_deliveries" USING btree ("webhook_event_id","attempt_number");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_idx" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_interactions_type_external_id_uq" ON "external_interactions" USING btree ("interaction_type","external_interaction_id");--> statement-breakpoint
CREATE INDEX "external_interactions_publication_occurred_at_idx" ON "external_interactions" USING btree ("publication_id","occurred_at");--> statement-breakpoint
CREATE INDEX "external_interactions_destination_occurred_at_idx" ON "external_interactions" USING btree ("destination_id","occurred_at");--> statement-breakpoint
CREATE INDEX "external_interactions_type_occurred_at_idx" ON "external_interactions" USING btree ("interaction_type","occurred_at");