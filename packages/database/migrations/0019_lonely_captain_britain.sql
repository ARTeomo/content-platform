ALTER TABLE "interaction_responses" DROP CONSTRAINT "interaction_responses_destination_id_destinations_id_fk";
--> statement-breakpoint
ALTER TABLE "interaction_responses" ADD CONSTRAINT "interaction_responses_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."destinations"("id") ON DELETE restrict ON UPDATE no action;