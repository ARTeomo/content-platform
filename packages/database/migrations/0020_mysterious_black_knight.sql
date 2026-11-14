ALTER TABLE "publications" ADD COLUMN "failure_category" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp with time zone;