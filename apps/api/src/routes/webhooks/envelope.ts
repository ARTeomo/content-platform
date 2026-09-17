import { z } from 'zod';

export const MetaWebhookEnvelopeSchema = z.object({
  object: z.literal('page'),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.record(z.unknown()),
        }),
      ),
    }),
  ),
});

export type MetaWebhookEnvelope = z.infer<typeof MetaWebhookEnvelopeSchema>;
