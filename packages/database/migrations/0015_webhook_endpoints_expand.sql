CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"verify_token_encrypted" text NOT NULL,
	"verify_token_key_version" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_status_check" CHECK ("webhook_endpoints"."status" IN ('ACTIVE', 'PAUSED', 'DISABLED')),
	CONSTRAINT "webhook_endpoints_key_version_check" CHECK ("webhook_endpoints"."verify_token_key_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD COLUMN "endpoint_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoints_provider_name_uq" ON "webhook_endpoints" USING btree ("provider","name");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints" USING btree ("status");--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_subscriptions_endpoint_id_idx" ON "webhook_subscriptions" USING btree ("endpoint_id");