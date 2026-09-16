/**
 * Meta webhook envelope types.
 *
 * One HTTP POST corresponds to one envelope with N entries, each
 * containing M changes. `webhook.process` extracts each change
 * independently and materializes it as an `external_interactions` row.
 */
export interface MetaWebhookEnvelope {
  object: string;
  entry: MetaWebhookEntry[];
}

export interface MetaWebhookEntry {
  /** Page ID. */
  id: string;
  /** Unix seconds. */
  time: number;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  /** `feed` | `mention` | ... */
  field: string;
  value: Record<string, unknown>;
}
