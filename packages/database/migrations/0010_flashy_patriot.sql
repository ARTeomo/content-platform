CREATE TABLE "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(32) NOT NULL,
	"destination_id" uuid,
	"provider" varchar(32) NOT NULL,
	"credential_type" varchar(64) NOT NULL,
	"encrypted_value" text NOT NULL,
	"encryption_key_version" integer NOT NULL,
	"status" varchar(32) DEFAULT 'UNKNOWN' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"last_rotation_at" timestamp with time zone,
	"rotation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_scope_check" CHECK ("provider_credentials"."scope" IN ('APP', 'DESTINATION')),
	CONSTRAINT "provider_credentials_status_check" CHECK ("provider_credentials"."status" IN ('VALID', 'EXPIRING', 'INVALID', 'UNKNOWN')),
	CONSTRAINT "provider_credentials_key_version_check" CHECK ("provider_credentials"."encryption_key_version" > 0),
	CONSTRAINT "provider_credentials_scope_destination_check" CHECK (("provider_credentials"."scope" = 'APP' AND "provider_credentials"."destination_id" IS NULL) OR ("provider_credentials"."scope" = 'DESTINATION' AND "provider_credentials"."destination_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_unique" ON "provider_credentials" USING btree ("provider","credential_type","scope",COALESCE("destination_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "provider_credentials_status_idx" ON "provider_credentials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_credentials_expires_at_idx" ON "provider_credentials" USING btree ("expires_at");