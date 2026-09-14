CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" varchar(64) NOT NULL,
	"job_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"dispatched_at" timestamp with time zone,
	"trace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jobs_status_check" CHECK ("outbox_jobs"."status" IN ('PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED')),
	CONSTRAINT "outbox_jobs_attempts_check" CHECK ("outbox_jobs"."attempts" >= 0),
	CONSTRAINT "outbox_jobs_dispatched_consistency" CHECK (("outbox_jobs"."status" = 'DISPATCHED' AND "outbox_jobs"."dispatched_at" IS NOT NULL) OR ("outbox_jobs"."status" <> 'DISPATCHED' AND "outbox_jobs"."dispatched_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_jobs_job_id_uq" ON "outbox_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "outbox_jobs_status_created_at_idx" ON "outbox_jobs" USING btree ("status","created_at") WHERE "outbox_jobs"."status" IN ('PENDING', 'DISPATCHING');