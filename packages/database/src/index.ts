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
