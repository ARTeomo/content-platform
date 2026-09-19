/**
 * Package barrel for @content-platform/database.
 */

export {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  type DatabaseConfig,
} from './client.js';

export * as schema from './schema/index.js';
export { TransactionManager, type Transaction } from './transaction/index.js';

/**
 * Re-export the Drizzle SQL template tag.
 *
 * Consumers that need to build raw queries (e.g. the worker's
 * content-publish-service) can import `sql` from this package instead
 * of depending on `drizzle-orm` directly. This keeps the peer-resolution
 * boundary at the database package and avoids requiring `drizzle-orm` and
 * `postgres` to be declared by every consumer.
 */
export { sql } from 'drizzle-orm';

// Repositories (single re-export from the repository barrel)

export {
  // Outbox
  OutboxRepository,
  type OutboxJob,
  type OutboxJobInput,
  type OutboxJobStatus,

  // Webhook persistence
  WebhookSubscriptionsRepository,
  type WebhookSubscriptionInput,
  WebhookSubscriptionHealthRepository,
  WebhookEventsRepository,
  type WebhookEventInput,
  type WebhookEventInsertResult,
  WebhookDeliveriesRepository,
  type WebhookDeliveryStart,
  ExternalInteractionsRepository,
  type ExternalInteractionDraft,
  type InteractionType,
  type ExternalInteractionUpsertResult,

  // Provider credentials
  ProviderCredentialsRepository,
  type ProviderCredentialInput,
  type ProviderCredentialLookup,
  type ProviderCredentialRow,
  type CredentialScope,
  type CredentialStatus,

  // Destinations
  DestinationsRepository,

  // Publication lifecycle (Phase 19a)
  PublicationsRepository,
  type PublicationCreateInput,
  type PublicationStatus,
  PublicationAttemptsRepository,
  type PublicationAttemptStatus,
  PublicationReconciliationsRepository,
  type PublicationReconciliationInput,
  type ReconciliationResult,

  // Interaction response lifecycle (Phase 18b)
  InteractionResponsesRepository,
  type InteractionResponseInput,
  type InteractionResponseStatus,
  InteractionResponseAttemptsRepository,
  type AttemptStatus,
  InteractionModerationActionsRepository,
  type ModerationAction,
  type ModerationActionInput,
  InteractionResponseReconciliationsRepository,
  type ReconciliationInput,
  type ReconciliationStatus,
} from './repositories/index.js';
