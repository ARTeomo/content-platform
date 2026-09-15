CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"reputation_state" varchar(32) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"safety_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_status_check" CHECK ("sources"."status" IN ('ACTIVE', 'PAUSED', 'DISABLED')),
	CONSTRAINT "sources_reputation_state_check" CHECK ("sources"."reputation_state" IN ('VERIFIED', 'NEUTRAL', 'FLAGGED'))
);
--> statement-breakpoint
CREATE TABLE "source_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"representation" varchar(32) NOT NULL,
	"capabilities" text[] NOT NULL,
	"url" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"state" jsonb DEFAULT '{"kind":"STATELESS"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_endpoints_representation_check" CHECK ("source_endpoints"."representation" IN ('XML', 'HTML', 'JSON', 'UNKNOWN')),
	CONSTRAINT "source_endpoints_status_check" CHECK ("source_endpoints"."status" IN ('ACTIVE', 'PAUSED', 'DISABLED')),
	CONSTRAINT "source_endpoints_state_version_check" CHECK ("source_endpoints"."state_version" >= 0),
	CONSTRAINT "source_endpoints_capabilities_nonempty_check" CHECK (array_length("source_endpoints"."capabilities", 1) IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "source_endpoint_health" (
	"endpoint_id" uuid PRIMARY KEY NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error_category" varchar(64),
	"last_error_message" text,
	"items_today" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_endpoint_health_consecutive_failures_check" CHECK ("source_endpoint_health"."consecutive_failures" >= 0),
	CONSTRAINT "source_endpoint_health_items_today_check" CHECK ("source_endpoint_health"."items_today" >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_endpoints" ADD CONSTRAINT "source_endpoints_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_endpoint_health" ADD CONSTRAINT "source_endpoint_health_endpoint_id_source_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."source_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_name_uq" ON "sources" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "source_endpoints_source_url_uq" ON "source_endpoints" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "source_endpoints_status_next_poll_at_idx" ON "source_endpoints" USING btree ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "source_endpoint_health_last_failure_at_idx" ON "source_endpoint_health" USING btree ("last_failure_at");