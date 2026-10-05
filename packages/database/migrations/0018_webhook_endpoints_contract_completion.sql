ALTER TABLE "webhook_subscriptions" DROP COLUMN "last_rotated_at";--> statement-breakpoint
DROP INDEX "provider_credentials_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_app_uq" ON "provider_credentials" USING btree ("provider","credential_type") WHERE "scope" = 'APP' AND "destination_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_destination_uq" ON "provider_credentials" USING btree ("provider","credential_type","destination_id") WHERE "scope" = 'DESTINATION' AND "destination_id" IS NOT NULL;
