CREATE TABLE "publication_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"caption" text NOT NULL,
	"summary" text NOT NULL,
	"source_url" text NOT NULL,
	"image_id" uuid,
	"validation_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_candidates_version_check" CHECK ("publication_candidates"."version" > 0),
	CONSTRAINT "publication_candidates_validation_status_check" CHECK ("publication_candidates"."validation_status" IN ('PASS', 'FAIL', 'REVIEW'))
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_candidate_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"external_post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_status_check" CHECK ("publications"."status" IN ('SCHEDULED', 'RESERVED', 'IN_PROGRESS', 'PUBLISHED', 'RETRY', 'FAILED', 'RECONCILIATION'))
);
--> statement-breakpoint
CREATE TABLE "publication_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_category" text,
	"error_message" text,
	"external_post_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_attempts_attempt_number_check" CHECK ("publication_attempts"."attempt_number" > 0),
	CONSTRAINT "publication_attempts_status_check" CHECK ("publication_attempts"."status" IN ('PENDING', 'SUCCESS', 'RETRY', 'FAILED', 'DEAD_LETTER', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "publication_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"attempt_id" uuid,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone,
	"external_post_id" text,
	"result" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_reconciliations_status_check" CHECK ("publication_reconciliations"."status" IN ('PUBLISHED', 'RETRY_ELIGIBLE', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"candidate_id" uuid,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_action_check" CHECK ("moderation_actions"."action" IN ('APPROVE', 'REJECT', 'EDIT', 'ARCHIVE'))
);
--> statement-breakpoint
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_candidates" ADD CONSTRAINT "publication_candidates_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_publication_candidate_id_publication_candidates_id_fk" FOREIGN KEY ("publication_candidate_id") REFERENCES "public"."publication_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliations" ADD CONSTRAINT "publication_reconciliations_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliations" ADD CONSTRAINT "publication_reconciliations_attempt_id_publication_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."publication_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_candidate_id_publication_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."publication_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_candidates_content_id_idx" ON "publication_candidates" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "publication_candidates_story_id_idx" ON "publication_candidates" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "publication_candidates_validation_status_idx" ON "publication_candidates" USING btree ("validation_status");--> statement-breakpoint
CREATE INDEX "publications_status_idx" ON "publications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publications_scheduled_at_idx" ON "publications" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "publications_external_post_id_idx" ON "publications" USING btree ("external_post_id") WHERE "publications"."external_post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "publication_attempts_pub_attempt_uq" ON "publication_attempts" USING btree ("publication_id","attempt_number");--> statement-breakpoint
CREATE INDEX "publication_attempts_status_idx" ON "publication_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publication_reconciliations_publication_id_idx" ON "publication_reconciliations" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "publication_reconciliations_status_idx" ON "publication_reconciliations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "moderation_actions_content_id_created_at_idx" ON "moderation_actions" USING btree ("content_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_candidate_id_idx" ON "moderation_actions" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_user_id_created_at_idx" ON "moderation_actions" USING btree ("user_id","created_at");