import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabaseClient,
  DestinationsRepository,
  ExternalInteractionsRepository,
  InteractionResponsesRepository,
  PublicationsRepository,
  TransactionManager,
  WebhookDeliveriesRepository,
  WebhookEventsRepository,
  type DatabaseClient,
} from '@content-platform/database';
import type { InteractionResponseService } from '../interaction-response/interaction-response-service.js';
import type {
  DecideOutcome,
  InteractionResponseConfig,
  TemplateMap,
} from '../interaction-response/types.js';
import { ChangeExtractorRegistry } from './change-extractor.js';
import { FeedChangeExtractor } from './feed-extractor.js';
import { MentionChangeExtractor } from './mention-extractor.js';
import { WebhookProcessService } from './webhook-process-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const DEFAULT_CONFIG: InteractionResponseConfig = {
  rules: [],
  maxResponsesPerHour: 20,
  minIntervalSeconds: 30,
};

const DEFAULT_TEMPLATES: TemplateMap = {};

describe.skipIf(!TEST_DB_URL)('WebhookProcessService', () => {
  let client: DatabaseClient;
  let service: WebhookProcessService;
  let eventsRepo: WebhookEventsRepository;
  let decideSpy: ReturnType<typeof vi.fn>;
  let destinationId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    const txManager = new TransactionManager(client.db);

    eventsRepo = new WebhookEventsRepository(client.db);
    const deliveriesRepo = new WebhookDeliveriesRepository(client.db);
    const interactionsRepo = new ExternalInteractionsRepository(client.db);
    const publicationsRepo = new PublicationsRepository(client.db);
    const destinationsRepo = new DestinationsRepository(client.db);
    const responsesRepo = new InteractionResponsesRepository(client.db);

    const registry = new ChangeExtractorRegistry()
      .register(new FeedChangeExtractor())
      .register(new MentionChangeExtractor());

    // The DB-backed test focuses on extraction and materialization.
    // The interaction response decision is exercised by
    // webhook-process-service-policy.test.ts. Here the service is
    // stubbed so the test does not enqueue real outbox jobs.
    decideSpy = vi.fn(async (): Promise<DecideOutcome> => ({
      kind: 'IGNORED',
      reason: 'test stub',
    }));
    const interactionResponseService = {
      decide: decideSpy,
    } as unknown as InteractionResponseService;

    service = new WebhookProcessService({
      txManager,
      eventsRepo,
      deliveriesRepo,
      interactionsRepo,
      publicationsRepo,
      destinationsRepo,
      responsesRepo,
      extractorRegistry: registry,
      interactionResponseService,
      interactionResponseConfig: DEFAULT_CONFIG,
      templates: DEFAULT_TEMPLATES,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    destinationId = await ensureDestination(client, 'test-webhook-process-destination');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    decideSpy.mockClear();
    await client.sql`TRUNCATE webhook_deliveries, external_interactions, webhook_events RESTART IDENTITY CASCADE`;
  });

  it('processes a feed comment event and creates an external interaction', async () => {
    const [event] = await client.sql<{ id: string }[]>`
      INSERT INTO webhook_events (
        provider, destination_id, object_type, external_object_id,
        field, idempotency_key, raw_payload, raw_body_hash, signature_verified
      ) VALUES (
        'META', ${destinationId}, 'page', 'page-1',
        'feed', 'hash-comment', ${JSON.stringify({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              time: 1_700_000_000,
              changes: [
                {
                  field: 'feed',
                  value: {
                    item: 'comment',
                    verb: 'add',
                    comment_id: 'comment-100',
                    post_id: 'post-abc',
                    parent_id: null,
                    from: { id: 'user-7', name: 'Alice' },
                    message: 'Nice post!',
                    created_time: 1_700_000_000,
                  },
                },
              ],
            },
          ],
        })}::jsonb, 'hash-comment', true
      ) RETURNING id
    `;
    expect(event).toBeDefined();

    const outcome = await service.processEvent(event!.id);
    expect(outcome.status).toBe('PROCESSED');
    if (outcome.status === 'PROCESSED') {
      expect(outcome.interactionsCreated).toBe(1);
    }

    const interactions = await client.sql<
      { interaction_type: string; content: string; actor_external_id: string }[]
    >`
      SELECT interaction_type, content, actor_external_id FROM external_interactions
    `;
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.interaction_type).toBe('COMMENT');
    expect(interactions[0]!.content).toBe('Nice post!');
    expect(interactions[0]!.actor_external_id).toBe('user-7');

    const [status] = await client.sql<{ status: string }[]>`
      SELECT status FROM webhook_events WHERE id = ${event!.id}
    `;
    expect(status!.status).toBe('PROCESSED');

    const deliveries = await client.sql<{ status: string }[]>`
      SELECT status FROM webhook_deliveries WHERE webhook_event_id = ${event!.id}
    `;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe('SUCCESS');

    // The policy decision is invoked for the newly created interaction.
    expect(decideSpy).toHaveBeenCalledTimes(1);
  });

  it('processes a mention event', async () => {
    const [event] = await client.sql<{ id: string }[]>`
      INSERT INTO webhook_events (
        provider, destination_id, object_type, external_object_id,
        field, idempotency_key, raw_payload, raw_body_hash, signature_verified
      ) VALUES (
        'META', ${destinationId}, 'page', 'page-1',
        'mention', 'hash-mention', ${JSON.stringify({
          object: 'page',
          entry: [
            {
              id: 'page-1',
              time: 1_700_000_100,
              changes: [
                {
                  field: 'mention',
                  value: {
                    post_id: 'post-mention',
                    sender_id: 'page-999',
                    message: 'Hey @us!',
                    created_time: 1_700_000_100,
                  },
                },
              ],
            },
          ],
        })}::jsonb, 'hash-mention', true
      ) RETURNING id
    `;

    const outcome = await service.processEvent(event!.id);
    expect(outcome.status).toBe('PROCESSED');

    const [interaction] = await client.sql<{ interaction_type: string; content: string }[]>`
      SELECT interaction_type, content FROM external_interactions
    `;
    expect(interaction!.interaction_type).toBe('MENTION');
    expect(interaction!.content).toBe('Hey @us!');
  });

  it('skips an already processed event', async () => {
    const [event] = await client.sql<{ id: string }[]>`
      INSERT INTO webhook_events (
        provider, destination_id, object_type, external_object_id,
        field, idempotency_key, raw_payload, raw_body_hash, signature_verified,
        status, processed_at
      ) VALUES (
        'META', ${destinationId}, 'page', 'page-1',
        'feed', 'hash-skip', '{"object":"page","entry":[]}'::jsonb,
        'hash-skip', true, 'PROCESSED', now()
      ) RETURNING id
    `;

    const outcome = await service.processEvent(event!.id);
    expect(outcome.status).toBe('SKIPPED');
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('handles unknown fields gracefully (no extractor)', async () => {
    const [event] = await client.sql<{ id: string }[]>`
      INSERT INTO webhook_events (
        provider, destination_id, object_type, external_object_id,
        field, idempotency_key, raw_payload, raw_body_hash, signature_verified
      ) VALUES (
        'META', ${destinationId}, 'page', 'page-1',
        'unknown_field', 'hash-unknown', ${JSON.stringify({
          object: 'page',
          entry: [{ id: 'page-1', time: 1, changes: [{ field: 'unknown_field', value: {} }] }],
        })}::jsonb, 'hash-unknown', true
      ) RETURNING id
    `;

    const outcome = await service.processEvent(event!.id);
    expect(outcome.status).toBe('PROCESSED');
    if (outcome.status === 'PROCESSED') {
      expect(outcome.interactionsCreated).toBe(0);
    }
    expect(decideSpy).not.toHaveBeenCalled();
  });

  it('returns SKIPPED for a non-existent event', async () => {
    const outcome = await service.processEvent('00000000-0000-0000-0000-000000000000');
    expect(outcome.status).toBe('SKIPPED');
    expect(decideSpy).not.toHaveBeenCalled();
  });
});

async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) return existing[0].id;

  const [destination] = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Test Webhook Process Destination', 'META', ${marker})
    RETURNING id
  `;
  if (!destination) throw new Error('scaffolding: destination insert failed');
  return destination.id;
}
