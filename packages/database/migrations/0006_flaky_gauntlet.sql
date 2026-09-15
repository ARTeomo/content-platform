CREATE TABLE "story_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"relevance_score" real NOT NULL,
	"membership_type" varchar(32) NOT NULL,
	"assignment_method" varchar(32) NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_members_relevance_check" CHECK ("story_members"."relevance_score" >= 0 AND "story_members"."relevance_score" <= 1),
	CONSTRAINT "story_members_membership_check" CHECK ("story_members"."membership_type" IN ('PRIMARY', 'MENTIONED')),
	CONSTRAINT "story_members_assignment_check" CHECK ("story_members"."assignment_method" IN ('AUTOMATIC', 'MANUAL'))
);
--> statement-breakpoint
CREATE TABLE "content_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_value" text NOT NULL,
	"normalized_value" text,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_entities_confidence_check" CHECK ("content_entities"."confidence" IS NULL OR ("content_entities"."confidence" >= 0 AND "content_entities"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "content_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"category" text NOT NULL,
	"confidence" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_categories_confidence_check" CHECK ("content_categories"."confidence" IS NULL OR ("content_categories"."confidence" >= 0 AND "content_categories"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "content_fingerprints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"algorithm" varchar(64) NOT NULL,
	"fingerprint_value" varchar(512) NOT NULL,
	"normalized_length" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_item_id" uuid NOT NULL,
	"duplicate_item_id" uuid NOT NULL,
	"similarity_score" real NOT NULL,
	"detection_method" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_matches_similarity_check" CHECK ("duplicate_matches"."similarity_score" >= 0 AND "duplicate_matches"."similarity_score" <= 1),
	CONSTRAINT "duplicate_matches_distinct_check" CHECK ("duplicate_matches"."canonical_item_id" <> "duplicate_matches"."duplicate_item_id")
);
--> statement-breakpoint
CREATE TABLE "content_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"url" text NOT NULL,
	"url_kind" varchar(32) NOT NULL,
	CONSTRAINT "content_urls_kind_check" CHECK ("content_urls"."url_kind" IN ('ALIAS', 'AMP', 'TRACKING_VARIANT'))
);
--> statement-breakpoint
ALTER TABLE "story_members" ADD CONSTRAINT "story_members_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_members" ADD CONSTRAINT "story_members_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entities" ADD CONSTRAINT "content_entities_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_categories" ADD CONSTRAINT "content_categories_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_fingerprints" ADD CONSTRAINT "content_fingerprints_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_matches" ADD CONSTRAINT "duplicate_matches_canonical_item_id_content_items_id_fk" FOREIGN KEY ("canonical_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_matches" ADD CONSTRAINT "duplicate_matches_duplicate_item_id_content_items_id_fk" FOREIGN KEY ("duplicate_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_urls" ADD CONSTRAINT "content_urls_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_members_story_content_uq" ON "story_members" USING btree ("story_id","content_item_id");--> statement-breakpoint
CREATE INDEX "story_members_story_added_at_idx" ON "story_members" USING btree ("story_id","added_at");--> statement-breakpoint
CREATE INDEX "story_members_content_item_id_idx" ON "story_members" USING btree ("content_item_id");--> statement-breakpoint
CREATE INDEX "content_entities_content_id_idx" ON "content_entities" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "content_categories_content_id_idx" ON "content_categories" USING btree ("content_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_fingerprints_item_alg_value_uq" ON "content_fingerprints" USING btree ("content_item_id","algorithm","fingerprint_value");--> statement-breakpoint
CREATE INDEX "content_fingerprints_alg_value_idx" ON "content_fingerprints" USING btree ("algorithm","fingerprint_value");--> statement-breakpoint
CREATE INDEX "content_fingerprints_content_id_idx" ON "content_fingerprints" USING btree ("content_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_matches_canonical_duplicate_method_uq" ON "duplicate_matches" USING btree ("canonical_item_id","duplicate_item_id","detection_method");--> statement-breakpoint
CREATE INDEX "duplicate_matches_canonical_idx" ON "duplicate_matches" USING btree ("canonical_item_id");--> statement-breakpoint
CREATE INDEX "duplicate_matches_duplicate_idx" ON "duplicate_matches" USING btree ("duplicate_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_urls_url_uq" ON "content_urls" USING btree ("url");--> statement-breakpoint
CREATE INDEX "content_urls_content_item_id_idx" ON "content_urls" USING btree ("content_item_id");