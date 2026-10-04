import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  InteractionResponsesRepository,
  OutboxRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import { InteractionResponseSchedulerService } from './interaction-response-scheduler-service.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('InteractionResponseSchedulerService', () => {
  let client: DatabaseClient;
  let txManager: TransactionManager;
  let responsesRepo: InteractionResponsesRepository;
  let outboxRepo: OutboxRepository;
  let scheduler: InteractionResponseSchedulerService;
  let destinationId: string;
  let externalCounter = 0;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    txManager = new TransactionManager(client.db);
    responsesRepo = new InteractionResponsesRepository(client.db);
    outboxRepo = new OutboxRepository(client.db);

    scheduler = new InteractionResponseSchedulerService({
      txManager,
      responsesRepo,
      outboxRepo,
      batchSize: 10,
      staleThresholdSeconds: 300,
    });

    destinationId = await ensureDestination(client, 'test-ir-scheduler-dest');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, interaction_responses, external_interactions RESTART IDENTITY CASCADE`;
    externalCounter = 0;
  });

  async function createResponse(input: {
    status: 'SCHEDULED' | 'IN_PROGRESS' | 'UNKNOWN';
    scheduledAt?: Date;
    updatedAtAgoSeconds?: number;
  }): Promise<string> {
    externalCounter++;
    const externalId = `scheduler-ext-${Date.now()}-${externalCounter}`;

    const [interaction] = await client.sql<{ id: string }[]>`
      INSERT INTO external_interactions (
        provider, interaction_type, external_interaction_id, occurred_at
      ) VALUES ('META', 'COMMENT', ${externalId}, now())
      RETURNING id
    `;

    const scheduledAtLiteral = input.scheduledAt ? input.scheduledAt.toISOString() : null;

    const [response] = await client.sql<{ id: string }[]>`
      INSERT INTO interaction_responses (
        interaction_id, destination_id, status, scheduled_at
      ) VALUES (
        ${interaction!.id}, ${destinationId}, ${input.status},
        ${scheduledAtLiteral}::timestamptz
      )
      RETURNING id
    `;

    if (input.updatedAtAgoSeconds !== undefined) {
      await client.sql`
        UPDATE interaction_responses
        SET updated_at = now() - (${input.updatedAtAgoSeconds} * interval '1 second')
        WHERE id = ${response!.id}
      `;
    }

    return response!.id;
  }

  async function countOutbox(queueName: string): Promise<number> {
    const [row] = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs WHERE queue_name = ${queueName}
    `;
    return row!.c;
  }

  // -------- SCHEDULED scan --------

  it('claims a due SCHEDULED response and enqueues webhook.respond', async () => {
    const id = await createResponse({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(result.reconciledCount).toBe(0);

    const [row] = await client.sql<{ status: string }[]>`
      SELECT status FROM interaction_responses WHERE id = ${id}
    `;
    expect(row!.status).toBe('QUEUED');

    const jobs = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs WHERE queue_name = 'webhook.respond'
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.job_id).toBe(`webhook.respond:${id}`);
  });

  it('does not claim a SCHEDULED response whose time has not yet arrived', async () => {
    await createResponse({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60_000),
    });

    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
  });

  // -------- stale unresolved scan --------

  it('touches a stale IN_PROGRESS response and enqueues webhook.respond.reconcile', async () => {
    const id = await createResponse({
      status: 'IN_PROGRESS',
      updatedAtAgoSeconds: 3600,
    });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(1);

    const jobs = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs WHERE queue_name = 'webhook.respond.reconcile'
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.job_id.startsWith(`webhook.respond.reconcile:${id}:`)).toBe(true);

    const [row] = await client.sql<{ status: string }[]>`
      SELECT status FROM interaction_responses WHERE id = ${id}
    `;
    expect(row!.status).toBe('IN_PROGRESS');
  });

  it('touches a stale UNKNOWN response and enqueues webhook.respond.reconcile', async () => {
    const id = await createResponse({
      status: 'UNKNOWN',
      updatedAtAgoSeconds: 3600,
    });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(1);

    const jobs = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs WHERE queue_name = 'webhook.respond.reconcile'
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.job_id.startsWith(`webhook.respond.reconcile:${id}:`)).toBe(true);

    const [row] = await client.sql<{ status: string }[]>`
      SELECT status FROM interaction_responses WHERE id = ${id}
    `;
    expect(row!.status).toBe('UNKNOWN');
  });

  it('does not touch fresh IN_PROGRESS or UNKNOWN responses', async () => {
    await createResponse({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 10 });
    await createResponse({ status: 'UNKNOWN', updatedAtAgoSeconds: 10 });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(0);

    expect(await countOutbox('webhook.respond.reconcile')).toBe(0);
  });

  it('handles a mix of stale IN_PROGRESS and stale UNKNOWN in one scan', async () => {
    await createResponse({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3600 });
    await createResponse({ status: 'UNKNOWN', updatedAtAgoSeconds: 3600 });
    await createResponse({ status: 'UNKNOWN', updatedAtAgoSeconds: 10 });

    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(2);

    expect(await countOutbox('webhook.respond.reconcile')).toBe(2);
  });

  it('is idempotent across consecutive runs for the same SCHEDULED row', async () => {
    const id = await createResponse({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const first = await scheduler.runOnce();
    expect(first.scheduledCount).toBe(1);

    const second = await scheduler.runOnce();
    expect(second.scheduledCount).toBe(0);

    const [row] = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs WHERE job_id = ${'webhook.respond:' + id}
    `;
    expect(row!.c).toBe(1);
  });
});

async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) return existing[0].id;

  const [destination] = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Test IR Scheduler', 'META', ${marker})
    RETURNING id
  `;
  if (!destination) throw new Error('scaffolding: destination insert failed');
  return destination.id;
}
