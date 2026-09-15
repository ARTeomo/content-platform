CREATE TABLE "discovered_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"external_id" text,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discovered_resource_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"external_id" text,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_entity_type" varchar(64) NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"endpoint_id" uuid,
	"phase" varchar(32) NOT NULL,
	"method" varchar(64) NOT NULL,
	"artifact_hash" varchar(128),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provenance_events_phase_check" CHECK ("provenance_events"."phase" IN ('DISCOVERY', 'ACQUISITION', 'EXTRACTION')),
	CONSTRAINT "provenance_events_target_type_check" CHECK ("provenance_events"."target_entity_type" IN ('DISCOVERED_RESOURCE', 'RAW_RESOURCE', 'SOURCE_ITEM', 'CONTENT_ITEM', 'CONTENT_VERSION'))
);
--> statement-breakpoint
CREATE TABLE "raw_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discovered_resource_id" uuid NOT NULL,
	"url" text NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"body" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovery_observations" ADD CONSTRAINT "discovery_observations_discovered_resource_id_discovered_resources_id_fk" FOREIGN KEY ("discovered_resource_id") REFERENCES "public"."discovered_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_observations" ADD CONSTRAINT "discovery_observations_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_events" ADD CONSTRAINT "provenance_events_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_resources" ADD CONSTRAINT "raw_resources_discovered_resource_id_discovered_resources_id_fk" FOREIGN KEY ("discovered_resource_id") REFERENCES "public"."discovered_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_resources_canonical_url_uq" ON "discovered_resources" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "discovered_resources_published_at_idx" ON "discovered_resources" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "discovery_observations_resource_idx" ON "discovery_observations" USING btree ("discovered_resource_id");--> statement-breakpoint
CREATE INDEX "discovery_observations_endpoint_observed_at_idx" ON "discovery_observations" USING btree ("endpoint_id","observed_at");--> statement-breakpoint
CREATE INDEX "provenance_events_target_idx" ON "provenance_events" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX "provenance_events_endpoint_observed_at_idx" ON "provenance_events" USING btree ("endpoint_id","observed_at");--> statement-breakpoint
CREATE INDEX "raw_resources_resource_fetched_at_idx" ON "raw_resources" USING btree ("discovered_resource_id","fetched_at");