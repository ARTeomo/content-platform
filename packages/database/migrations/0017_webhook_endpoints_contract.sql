-- ---------------------------------------------------------------------------
-- v1.3 CONTRACT: backfill external_interactions.provider before the
-- NOT NULL constraint. This is the only data-carrying statement in the
-- v1.3 migration set; it is included here because the constraint swap
-- and the backfill must be atomic.
-- ---------------------------------------------------------------------------
UPDATE "external_interactions" SET "provider" = 'META' WHERE "provider" IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "external_interactions" WHERE "provider" IS NULL) THEN
    RAISE EXCEPTION 'v1.3 backfill incomplete: external_interactions.provider is still NULL for some rows';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" DROP CONSTRAINT "webhook_subscriptions_key_version_check";--> statement-breakpoint
DROP INDEX "external_interactions_type_external_id_uq";--> statement-breakpoint
DROP INDEX "external_interactions_provider_external_id_idx";--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ALTER COLUMN "endpoint_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "external_interactions" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_interactions_provider_external_id_uq" ON "external_interactions" USING btree ("provider","external_interaction_id");--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" DROP COLUMN "verify_token_encrypted";--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" DROP COLUMN "verify_token_key_version";