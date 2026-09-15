CREATE TABLE "source_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_item_id" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content" text NOT NULL,
	"author" text,
	"language" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_resource_id" uuid,
	"content_item_id" uuid
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stories_status_check" CHECK ("stories"."status" IN ('FORMING', 'ACTIVE', 'ARCHIVED', 'LOCKED'))
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"status" varchar(32) NOT NULL,
	"published_at" timestamp with time zone,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_status_check" CHECK ("content_items"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'TRASHED'))
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"processing_version" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_versions_version_number_check" CHECK ("content_versions"."version_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_raw_resource_id_raw_resources_id_fk" FOREIGN KEY ("raw_resource_id") REFERENCES "public"."raw_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_items" ADD CONSTRAINT "source_items_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_current_version_id_content_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."content_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_items_source_item_id_uq" ON "source_items" USING btree ("source_id","source_item_id");--> statement-breakpoint
CREATE INDEX "source_items_source_discovered_at_idx" ON "source_items" USING btree ("source_id","discovered_at");--> statement-breakpoint
CREATE INDEX "source_items_content_item_id_idx" ON "source_items" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "stories_status_updated_at_idx" ON "stories" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_canonical_url_uq" ON "content_items" USING btree ("canonical_url");--> statement-breakpoint
CREATE INDEX "content_items_status_published_at_idx" ON "content_items" USING btree ("status","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_versions_item_version_uq" ON "content_versions" USING btree ("content_item_id","version_number");--> statement-breakpoint
CREATE INDEX "content_versions_item_version_desc_idx" ON "content_versions" USING btree ("content_item_id","version_number" DESC NULLS LAST);