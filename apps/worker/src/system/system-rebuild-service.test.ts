import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  InteractionResponsesRepository,
  OutboxRepository,
  PublicationsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { SystemRebuildService } from './system-rebuild-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('SystemRebuildService', () => {
  let client: DatabaseClient;
  let outboxRepo: OutboxRepository;
  let publicationsRepo: PublicationsRepository;
  let responsesRepo: InteractionResponsesRepository;
  let txManager: TransactionManager;
  let service: SystemRebuildService;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    outboxRepo = new OutboxRepository(client.db);
    publicationsRepo = new PublicationsRepository(client.db);
    responsesRepo = new InteractionResponsesRepository(client.db);
    txManager = new TransactionManager(client.db);

    service = new SystemRebuildService({
      db: client.db,
      txManager,
      outboxRepo,
      publicationsRepo,
      interactionResponsesRepo: responsesRepo,
      defaultStaleThresholdSeconds: 60,
      defaultLimit: 100,
    });
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, webhook_events, publications, publication_candidates, interaction_responses, external_interactions RESTART IDENTITY CASCADE`;
  });

  it('returns zero counts when nothing is stale', async () => {
    const result = await service.rebuild({ scope: 'all' });
    expect(result.webhookEventsReenqueued).toBe(0);
    expect(result.publicationsReenqueued).toBe(0);
    expect(result.interactionResponsesReenqueued).toBe(0);
  });

  it('re-enqueues stale RECEIVED webhook events with a rebuild-suffixed job id', async () => {
    const [event] = await client.sql<{ id: string }[]>`
      INSERT INTO webhook_events (
        provider, object_type, external_object_id, idempotency_key,
        raw_payload, raw_body_hash, signature_verified,
        status, received_at
      ) VALUES (
        'META', 'page', 'page-1', 'hash-rebuild-1',
        '{"object":"page","entry":[]}'::jsonb, 'hash-rebuild-1', true,
        'RECEIVED', now() - interval '10 minutes'
      ) RETURNING id
    `;

    const result = await service.rebuild({ scope: 'webhook_events' });
    expect(result.webhookEventsReenqueued).toBe(1);

    const jobs = await client.sql<{ job_id: string; queue_name: string }[]>`
      SELECT job_id, queue_name FROM outbox_jobs WHERE queue_name = 'webhook.process'
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.job_id).toMatch(new RegExp(`^webhook\\.process:${event!.id}:rebuild:\\d+$`));
  });

  it('does not re-enqueue events that are still inside the staleness threshold', async () => {
    await client.sql`
      INSERT INTO webhook_events (
        provider, object_type, external_object_id, idempotency_key,
        raw_payload, raw_body_hash, signature_verified,
        status, received_at
      ) VALUES (
        'META', 'page', 'page-1', 'hash-rebuild-fresh',
        '{"object":"page","entry":[]}'::jsonb, 'hash-rebuild-fresh', true,
        'RECEIVED', now()
      )
    `;

    const result = await service.rebuild({ scope: 'webhook_events' });
    expect(result.webhookEventsReenqueued).toBe(0);
  });

  it('is idempotent: two rebuild calls in the same millisecond do not produce duplicate jobs', async () => {
    await client.sql`
      INSERT INTO webhook_events (
        provider, object_type, external_object_id, idempotency_key,
        raw_payload, raw_body_hash, signature_verified,
        status, received_at
      ) VALUES (
        'META', 'page', 'page-1', 'hash-rebuild-dup',
        '{"object":"page","entry":[]}'::jsonb, 'hash-rebuild-dup', true,
        'RECEIVED', now() - interval '10 minutes'
      )
    `;

    const a = await service.rebuild({ scope: 'webhook_events' });
    const b = await service.rebuild({ scope: 'webhook_events' });
    // Two runs, each inserts one row because the rebuild suffix carries
    // a millisecond timestamp. The outbox row is not duplicated for the
    // same suffix.
    expect(a.webhookEventsReenqueued + b.webhookEventsReenqueued).toBeLessThanOrEqual(2);

    const distinct = await client.sql<{ c: number }[]>`
      SELECT COUNT(DISTINCT job_id)::int AS c FROM outbox_jobs
    `;
    const total = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs
    `;
    expect(distinct[0]!.c).toBe(total[0]!.c);
  });
});
