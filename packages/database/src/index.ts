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

export {
  OutboxRepository,
  type OutboxJob,
  type OutboxJobInput,
  type OutboxJobStatus,
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
  ProviderCredentialsRepository,
  type ProviderCredentialInput,
  type ProviderCredentialLookup,
  type ProviderCredentialRow,
  type CredentialScope,
  type CredentialStatus,
  PublicationsRepository,
} from './repositories/index.js';
