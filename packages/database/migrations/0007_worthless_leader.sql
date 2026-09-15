CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid,
	"source_url" text NOT NULL,
	"resolved_url" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"file_size_bytes" bigint,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_width_check" CHECK ("images"."width" IS NULL OR "images"."width" > 0),
	CONSTRAINT "images_height_check" CHECK ("images"."height" IS NULL OR "images"."height" > 0),
	CONSTRAINT "images_file_size_bytes_check" CHECK ("images"."file_size_bytes" IS NULL OR "images"."file_size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "image_rights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"rights_status" text NOT NULL,
	"source_domain" text,
	"attribution_required" boolean DEFAULT false NOT NULL,
	"attribution_text" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_content_id_content_items_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_rights" ADD CONSTRAINT "image_rights_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_content_id_idx" ON "images" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "images_status_idx" ON "images" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "image_rights_image_id_uq" ON "image_rights" USING btree ("image_id");