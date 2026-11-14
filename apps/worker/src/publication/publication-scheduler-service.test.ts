import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabaseClient,
  NotificationsRepository,
  OutboxRepository,
  PublicationAttemptsRepository,
  PublicationsRepository,
  TransactionManager,
  type DatabaseClient,
} from '@content-platform/database';
import type {
  CredentialHealthReport,
  MetaCredentialService,
} from '@content-platform/authentication';
import { PublicationSchedulerService } from './publication-scheduler-service.js';
import type { AlertingService } from '../observability/index.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('PublicationSchedulerService', () => {
  let client: DatabaseClient;
  let txManager: TransactionManager;
  let publicationsRepo: PublicationsRepository;
  let publicationAttemptsRepo: PublicationAttemptsRepository;
  let notificationsRepo: NotificationsRepository;
  let outboxRepo: OutboxRepository;

  let destinationId: string;
  let destinationId2: string;
  let contentItemId: string;
  let storyId: string;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    txManager = new TransactionManager(client.db);
    publicationsRepo = new PublicationsRepository(client.db);
    publicationAttemptsRepo = new PublicationAttemptsRepository(client.db);
    notificationsRepo = new NotificationsRepository(client.db);
    outboxRepo = new OutboxRepository(client.db);

    destinationId = await ensureDestination(client, 'test-scheduler-dest');
    destinationId2 = await ensureDestination(client, 'test-scheduler-dest-2');
    contentItemId = await ensureContentItem(client, 'https://scheduler.test/item');
    storyId = await ensureStory(client, 'Scheduler Test Story');
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await client.sql`TRUNCATE outbox_jobs, notifications, publication_attempts, publications, publication_candidates CASCADE`;
  });

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function buildScheduler(options: {
    credentialService: MetaCredentialService;
    alerting?: AlertingService;
    notificationDedupWindowMs?: number;
    retry?: { maxAttempts?: number; baseDelaySeconds?: number; maxDelaySeconds?: number };
  }): PublicationSchedulerService {
    return new PublicationSchedulerService({
      txManager,
      publicationsRepo,
      publicationAttemptsRepo,
      notificationsRepo,
      outboxRepo,
      batchSize: 10,
      staleThresholdSeconds: 300,
      retryMaxAttempts: options.retry?.maxAttempts ?? 5,
      retryBaseDelaySeconds: options.retry?.baseDelaySeconds ?? 60,
      retryMaxDelaySeconds: options.retry?.maxDelaySeconds ?? 3600,
      credentialService: options.credentialService,
      ...(options.alerting !== undefined && { alerting: options.alerting }),
      ...(options.notificationDedupWindowMs !== undefined && {
        notificationDedupWindowMs: options.notificationDedupWindowMs,
      }),
    });
  }

  function permissiveCredentialService(): MetaCredentialService {
    return makeCredentialService({ [destinationId]: 'VALID', [destinationId2]: 'VALID' });
  }

  function makeCredentialService(
    outcomes: Record<string, 'VALID' | 'EXPIRING' | 'INVALID' | 'UNKNOWN'>,
    throwForDestinations: string[] = [],
  ): MetaCredentialService {
    return {
      async healthCheck(destId: string): Promise<CredentialHealthReport> {
        if (throwForDestinations.includes(destId)) {
          throw new Error('health check failed');
        }
        const overall = outcomes[destId] ?? 'VALID';
        return { destinationId: destId, overall, credentials: [] };
      },
    } as unknown as MetaCredentialService;
  }

  function makeAlertingSpy(): {
    service: AlertingService;
    blockedSpy: ReturnType<typeof vi.fn>;
  } {
    const blockedSpy = vi.fn(
      async (_publicationId: string, _destinationId: string, _reason: string) => {},
    );
    const service = {
      async publicationBlocked(publicationId: string, destId: string, reason: string) {
        await blockedSpy(publicationId, destId, reason);
      },
      async publicationFailed() {},
      async publicationPublished() {},
      async credentialInvalidated() {},
    } as unknown as AlertingService;
    return { service, blockedSpy };
  }

  async function createPublication(input: {
    status: 'SCHEDULED' | 'RECONCILIATION' | 'IN_PROGRESS';
    destinationId?: string;
    scheduledAt?: Date;
    updatedAtAgoSeconds?: number;
  }): Promise<string> {
    const candidate = await client.sql<{ id: string }[]>`
      INSERT INTO publication_candidates
        (content_id, story_id, version, title, caption, summary, source_url, validation_status)
      VALUES
        (${contentItemId}, ${storyId}, 1, 't', 'c', 's', 'https://scheduler.test/item', 'PASS')
      RETURNING id
    `;
    const scheduledAtLiteral =
      input.scheduledAt !== undefined ? input.scheduledAt.toISOString() : null;
    const created = await client.sql<{ id: string }[]>`
      INSERT INTO publications
        (publication_candidate_id, destination_id, status, scheduled_at)
      VALUES
        (${candidate[0]!.id}, ${input.destinationId ?? destinationId}, ${input.status},
         ${scheduledAtLiteral}::timestamptz)
      RETURNING id
    `;
    const id = created[0]!.id;
    if (input.updatedAtAgoSeconds !== undefined) {
      await client.sql`
        UPDATE publications
        SET updated_at = now() - (${input.updatedAtAgoSeconds} * interval '1 second')
        WHERE id = ${id}
      `;
    }
    return id;
  }

  async function getPublicationStatus(id: string): Promise<string> {
    const [row] = await client.sql<{ status: string }[]>`
      SELECT status FROM publications WHERE id = ${id}
    `;
    return row!.status;
  }

  async function getPublicationFailureCategory(id: string): Promise<string | null> {
    const [row] = await client.sql<{ failure_category: string | null }[]>`
      SELECT failure_category FROM publications WHERE id = ${id}
    `;
    return row!.failure_category;
  }

  async function createPendingAttempt(publicationId: string): Promise<string> {
    const attempt = await client.sql<{ id: string }[]>`
      INSERT INTO publication_attempts (publication_id, attempt_number, status, started_at)
      VALUES (${publicationId}, 1, 'PENDING', now())
      RETURNING id
    `;
    return attempt[0]!.id;
  }

  async function getLatestAttempt(
    publicationId: string,
  ): Promise<{ status: string; error_category: string | null; finished_at: string | null }> {
    const [row] = await client.sql<
      { status: string; error_category: string | null; finished_at: string | null }[]
    >`
      SELECT status, error_category, finished_at
      FROM publication_attempts
      WHERE publication_id = ${publicationId}
      ORDER BY attempt_number DESC
      LIMIT 1
    `;
    return row!;
  }

  async function countNotifications(publicationId: string): Promise<number> {
    const [row] = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM notifications WHERE publication_id = ${publicationId}
    `;
    return row!.c;
  }

  async function getContentItemSnapshot(): Promise<{
    status: string;
    published_at: string | null;
  }> {
    const [row] = await client.sql<{ status: string; published_at: string | null }[]>`
      SELECT status, published_at FROM content_items WHERE id = ${contentItemId}
    `;
    return row!;
  }

  async function countOutbox(): Promise<number> {
    const [row] = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs
    `;
    return row!.c;
  }

  // ---------------------------------------------------------------------
  // Core scheduler behavior (5 tests)
  // ---------------------------------------------------------------------

  it('claims a due SCHEDULED publication and enqueues content.publish', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('RESERVED');
    const jobs = await client.sql<{ queue_name: string; job_id: string }[]>`
      SELECT queue_name, job_id FROM outbox_jobs
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.queue_name).toBe('content.publish');
    expect(jobs[0]!.job_id).toBe(`content.publish:${id}:1`);
  });

  it('does not claim a SCHEDULED publication whose time has not yet arrived', async () => {
    await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 60_000),
    });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
  });

  it('touches a stale RECONCILIATION publication and enqueues publication.reconcile', async () => {
    const id = await createPublication({ status: 'RECONCILIATION', updatedAtAgoSeconds: 3_600 });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(1);
    const jobs = await client.sql<{ queue_name: string; job_id: string }[]>`
      SELECT queue_name, job_id FROM outbox_jobs
    `;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.queue_name).toBe('publication.reconcile');
    expect(jobs[0]!.job_id.startsWith(`publication.reconcile:${id}:`)).toBe(true);
    expect(await getPublicationStatus(id)).toBe('RECONCILIATION');
  });

  it('does not touch a fresh RECONCILIATION publication', async () => {
    await createPublication({ status: 'RECONCILIATION', updatedAtAgoSeconds: 10 });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();
    expect(result.reconciledCount).toBe(0);
  });

  it('is idempotent across consecutive runs for the same SCHEDULED row', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await scheduler.runOnce()).scheduledCount).toBe(1);
    expect((await scheduler.runOnce()).scheduledCount).toBe(0);
    const [row] = await client.sql<{ c: number }[]>`
      SELECT COUNT(*)::int AS c FROM outbox_jobs WHERE job_id = ${'content.publish:' + id + ':1'}
    `;
    expect(row!.c).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Credential-gate tests (11 tests)
  // ---------------------------------------------------------------------

  it('gate: blocks publication when credential health is INVALID', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
    expect(result.blockedByCredentialCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CREDENTIAL_GATE');
    expect(await countOutbox()).toBe(0);
  });

  it('gate: blocks publication when credential health is UNKNOWN', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'UNKNOWN' }),
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
    expect(result.blockedByCredentialCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CREDENTIAL_GATE');
    expect(await countOutbox()).toBe(0);
  });

  it('gate: blocks publication when the health check throws (treated as UNKNOWN)', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({}, [destinationId]),
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(0);
    expect(result.blockedByCredentialCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await countOutbox()).toBe(0);
  });

  it('gate: allows publication when credential health is VALID', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'VALID' }),
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(result.blockedByCredentialCount).toBe(0);
    expect(await getPublicationStatus(id)).toBe('RESERVED');
    expect(await countOutbox()).toBe(1);
  });

  it('gate: allows publication when credential health is EXPIRING', async () => {
    await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'EXPIRING' }),
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(result.blockedByCredentialCount).toBe(0);
  });

  it('gate: alerting is called with credential_invalid for an INVALID block', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
      alerting,
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(1);
    expect(blockedSpy).toHaveBeenCalledWith(id, destinationId, 'credential_invalid');
  });

  it('gate: alerting is called with credential_unknown for a UNKNOWN block', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'UNKNOWN' }),
      alerting,
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(1);
    expect(blockedSpy).toHaveBeenCalledWith(id, destinationId, 'credential_unknown');
  });

  it('gate: one health check per unique destination across a batch', async () => {
    await createPublication({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 60_000) });
    await createPublication({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 60_000) });
    await createPublication({ status: 'SCHEDULED', scheduledAt: new Date(Date.now() - 60_000) });
    let healthCheckCount = 0;
    const credentialService = {
      async healthCheck(destId: string): Promise<CredentialHealthReport> {
        healthCheckCount++;
        return { destinationId: destId, overall: 'VALID', credentials: [] };
      },
    } as unknown as MetaCredentialService;
    const scheduler = buildScheduler({ credentialService });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(3);
    expect(healthCheckCount).toBe(1);
  });

  it('gate: mixed batch — one blocked, one enqueued', async () => {
    const blockedId = await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const allowedId = await createPublication({
      status: 'SCHEDULED',
      destinationId: destinationId2,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({
        [destinationId]: 'INVALID',
        [destinationId2]: 'VALID',
      }),
      alerting,
    });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(result.blockedByCredentialCount).toBe(1);
    expect(await getPublicationStatus(blockedId)).toBe('FAILED');
    expect(await getPublicationStatus(allowedId)).toBe('RESERVED');
    expect(blockedSpy).toHaveBeenCalledTimes(1);
    expect(blockedSpy).toHaveBeenCalledWith(blockedId, destinationId, 'credential_invalid');
  });

  it('gate: dedup — two blocked publications to the same destination produce one alert', async () => {
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
      alerting,
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(1);
  });

  it('gate: dedup — a second alert within the window is suppressed across ticks', async () => {
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
      alerting,
      notificationDedupWindowMs: 60_000,
    });
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(1);
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(1);
  });

  it('gate: dedup — notificationDedupWindowMs=0 disables dedup', async () => {
    const { service: alerting, blockedSpy } = makeAlertingSpy();
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
      alerting,
      notificationDedupWindowMs: 0,
    });
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await scheduler.runOnce();
    await createPublication({
      status: 'SCHEDULED',
      destinationId,
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await scheduler.runOnce();
    expect(blockedSpy).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------
  // Crash recovery (C-D5) tests
  // ---------------------------------------------------------------------

  it('recovers a stale IN_PROGRESS publication: FAILED/CRASH_RECOVERY, attempt finalized, one notification, no publish enqueued, parent untouched', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3_600 });
    const attemptId = await createPendingAttempt(id);
    const parentBefore = await getContentItemSnapshot();

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();

    expect(result.recoveredCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CRASH_RECOVERY');

    const attempt = await getLatestAttempt(id);
    expect(attempt.status).toBe('FAILED');
    expect(attempt.error_category).toBe('PROCESSING_TIMEOUT');
    expect(attempt.finished_at).not.toBeNull();

    const [notification] = await client.sql<
      { type: string; severity: string; resolved_at: string | null; is_read: boolean }[]
    >`
      SELECT type, severity, resolved_at, is_read FROM notifications WHERE publication_id = ${id}
    `;
    expect(notification!.type).toBe('publication_failure');
    expect(notification!.severity).toBe('ERROR');
    expect(notification!.resolved_at).toBeNull();
    expect(notification!.is_read).toBe(false);
    expect(await countNotifications(id)).toBe(1);

    // No retry/re-publish is initiated for an uncertain external outcome.
    expect(await countOutbox()).toBe(0);
    // The parent content item is a J.2 success-path concern only.
    expect(await getContentItemSnapshot()).toEqual(parentBefore);
    void attemptId;
  });

  it('recovery: does not touch a fresh IN_PROGRESS publication', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 10 });
    await createPendingAttempt(id);

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();

    expect(result.recoveredCount).toBe(0);
    expect(await getPublicationStatus(id)).toBe('IN_PROGRESS');
    expect(await countNotifications(id)).toBe(0);
  });

  it('recovery: second run is a no-op (idempotent by construction)', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3_600 });
    await createPendingAttempt(id);

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await scheduler.runOnce()).recoveredCount).toBe(1);
    expect((await scheduler.runOnce()).recoveredCount).toBe(0);

    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await countNotifications(id)).toBe(1);
  });

  it('recovery: a publication that completed before the claim is not overwritten (no notification, no FAILED)', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3_600 });
    await createPendingAttempt(id);
    // Simulate the executing worker winning the race: it persisted the
    // success between candidate selection and the atomic claim.
    await client.sql`
      UPDATE publications SET status = 'PUBLISHED', published_at = now() WHERE id = ${id}
    `;

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();

    expect(result.recoveredCount).toBe(0);
    expect(await getPublicationStatus(id)).toBe('PUBLISHED');
    expect(await getPublicationFailureCategory(id)).toBeNull();
    expect(await countNotifications(id)).toBe(0);
  });

  it('recovery: concurrent executions claim a stale publication exactly once', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3_600 });
    await createPendingAttempt(id);

    const [first, second] = await Promise.all([
      buildScheduler({ credentialService: permissiveCredentialService() }).runOnce(),
      buildScheduler({ credentialService: permissiveCredentialService() }).runOnce(),
    ]);

    expect(first.recoveredCount + second.recoveredCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CRASH_RECOVERY');
    expect(await countNotifications(id)).toBe(1);
  });

  it('recovery: a failure inside the recovery transaction rolls the claim back; the next scan succeeds', async () => {
    const id = await createPublication({ status: 'IN_PROGRESS', updatedAtAgoSeconds: 3_600 });
    await createPendingAttempt(id);

    // Notification writer that fails once, then delegates to the real
    // repository — the claim, attempt finalization, and notification are
    // one transaction, so the injected failure must roll everything back.
    let injected = true;
    const failingNotificationsRepo = {
      create: async (
        ...args: Parameters<NotificationsRepository['create']>
      ): ReturnType<NotificationsRepository['create']> => {
        if (injected) {
          injected = false;
          throw new Error('injected notification failure');
        }
        return notificationsRepo.create(...args);
      },
    } as NotificationsRepository;

    const failingScheduler = new PublicationSchedulerService({
      txManager,
      publicationsRepo,
      publicationAttemptsRepo,
      notificationsRepo: failingNotificationsRepo,
      outboxRepo,
      batchSize: 10,
      staleThresholdSeconds: 300,
      retryMaxAttempts: 5,
      retryBaseDelaySeconds: 60,
      retryMaxDelaySeconds: 3600,
      credentialService: permissiveCredentialService(),
    });

    await expect(failingScheduler.runOnce()).rejects.toThrow('injected notification failure');

    // Rolled back completely: the row is still a stale IN_PROGRESS
    // candidate with its PENDING attempt and no notification.
    expect(await getPublicationStatus(id)).toBe('IN_PROGRESS');
    const attempt = await getLatestAttempt(id);
    expect(attempt.status).toBe('PENDING');
    expect(attempt.finished_at).toBeNull();
    expect(await countNotifications(id)).toBe(0);

    // Next scan recovers it cleanly.
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await scheduler.runOnce()).recoveredCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CRASH_RECOVERY');
    expect(await countNotifications(id)).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Retry requeue (C-D6) tests
  // ---------------------------------------------------------------------

  async function createRetryPublication(input: {
    maxAttempt: number;
    updatedAtAgoSeconds: number;
  }): Promise<string> {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    for (let n = 1; n <= input.maxAttempt; n++) {
      await client.sql`
        INSERT INTO publication_attempts
          (publication_id, attempt_number, status, started_at, finished_at)
        VALUES (${id}, ${n}, 'FAILED', now(), now())
      `;
    }
    await client.sql`
      UPDATE publications SET status = 'RETRY', updated_at = now() WHERE id = ${id}
    `;
    await client.sql`
      UPDATE publications
      SET updated_at = now() - (${input.updatedAtAgoSeconds} * interval '1 second')
      WHERE id = ${id}
    `;
    return id;
  }

  async function listOutboxJobIds(): Promise<string[]> {
    const rows = await client.sql<{ job_id: string }[]>`
      SELECT job_id FROM outbox_jobs ORDER BY job_id
    `;
    return rows.map((r) => r.job_id);
  }

  it('retry: due RETRY flips to SCHEDULED, next tick enqueues content.publish:{id}:2 without colliding with the retained :1 row', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 120 });
    // The first attempt's DISPATCHED outbox row survives the 7-day
    // cleanup retention — requeue must not collide with it.
    await client.sql`
      INSERT INTO outbox_jobs (job_id, queue_name, payload, status, dispatched_at)
      VALUES (${`content.publish:${id}:1`}, 'content.publish', '{}'::jsonb, 'DISPATCHED', now())
    `;
    const parentBefore = await getContentItemSnapshot();

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const first = await scheduler.runOnce();
    expect(first.retriedCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('SCHEDULED');
    expect(await listOutboxJobIds()).toEqual([`content.publish:${id}:1`]);

    const second = await scheduler.runOnce();
    expect(second.scheduledCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('RESERVED');
    expect(await listOutboxJobIds()).toEqual([
      `content.publish:${id}:1`,
      `content.publish:${id}:2`,
    ]);

    // jobId number == the attempt the worker will actually start.
    const attempt = await txManager.run(async (tx) => publicationAttemptsRepo.startAttempt(tx, id));
    expect(attempt.attemptNumber).toBe(2);
    expect(await getContentItemSnapshot()).toEqual(parentBefore);
  });

  it('retry: exhaustion boundary — maxAttempt=4 is eligible, maxAttempt=5 is FAILED/RETRY_EXHAUSTED with exactly one notification and no outbox row', async () => {
    // maxAttempt=4 → backoff 60 * 2^3 = 480s; backdate past it.
    const eligible = await createRetryPublication({ maxAttempt: 4, updatedAtAgoSeconds: 600 });
    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await scheduler.runOnce()).retriedCount).toBe(1);
    expect(await getPublicationStatus(eligible)).toBe('SCHEDULED');
    expect((await scheduler.runOnce()).scheduledCount).toBe(1);
    expect((await listOutboxJobIds()).sort()).toEqual([`content.publish:${eligible}:5`]);

    const exhausted = await createRetryPublication({ maxAttempt: 5, updatedAtAgoSeconds: 400 });
    const secondScheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await secondScheduler.runOnce()).retriedCount).toBe(0);
    expect(await getPublicationStatus(exhausted)).toBe('FAILED');
    expect(await getPublicationFailureCategory(exhausted)).toBe('RETRY_EXHAUSTED');
    expect(await listOutboxJobIds()).toEqual([`content.publish:${eligible}:5`]);

    const [note] = await client.sql<
      { type: string; message: string; resolved_at: string | null }[]
    >`
      SELECT type, message, resolved_at FROM notifications WHERE publication_id = ${exhausted}
    `;
    expect(note!.type).toBe('publication_failure');
    expect(note!.message).toContain('RETRY_EXHAUSTED');
    expect(note!.message).toContain('5 attempt(s)');
    expect(note!.resolved_at).toBeNull();
    expect(await countNotifications(exhausted)).toBe(1);
  });

  it('retry: a re-enqueued row blocked by the credential gate becomes FAILED/CREDENTIAL_GATE with no enqueue', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 120 });
    const scheduler = buildScheduler({
      credentialService: makeCredentialService({ [destinationId]: 'INVALID' }),
    });

    expect((await scheduler.runOnce()).retriedCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('SCHEDULED');

    const second = await scheduler.runOnce();
    expect(second.blockedByCredentialCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CREDENTIAL_GATE');
    expect(await listOutboxJobIds()).toEqual([]);
  });

  it('retry: J.3 credential-gate requeue feeds scan 1 with the attempt-scoped jobId', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 120 });
    await client.sql`
      UPDATE publications SET status = 'FAILED', failure_category = 'CREDENTIAL_GATE'
      WHERE id = ${id}
    `;

    const requeued = await txManager.run(async (tx) =>
      publicationsRepo.requeueCredentialGateFailures(tx, destinationId),
    );
    expect(requeued).toEqual([id]);

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();
    expect(result.scheduledCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('RESERVED');
    expect(await listOutboxJobIds()).toEqual([`content.publish:${id}:2`]);
  });

  it('retry: FAILED + CRASH_RECOVERY rows are untouched by the retry scan', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 120 });
    await client.sql`
      UPDATE publications SET status = 'FAILED', failure_category = 'CRASH_RECOVERY', updated_at = now()
      WHERE id = ${id}
    `;

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();

    expect(result.retriedCount).toBe(0);
    expect(await getPublicationStatus(id)).toBe('FAILED');
    expect(await getPublicationFailureCategory(id)).toBe('CRASH_RECOVERY');
    expect(await listOutboxJobIds()).toEqual([]);
  });

  it('retry: a not-yet-due row stays RETRY (backoff boundary)', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 30 });

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    const result = await scheduler.runOnce();

    expect(result.retriedCount).toBe(0);
    expect(await getPublicationStatus(id)).toBe('RETRY');
    expect(await listOutboxJobIds()).toEqual([]);
  });

  it('retry: concurrent executions flip a due retry exactly once', async () => {
    const id = await createRetryPublication({ maxAttempt: 1, updatedAtAgoSeconds: 120 });

    const [first, second] = await Promise.all([
      buildScheduler({ credentialService: permissiveCredentialService() }).runOnce(),
      buildScheduler({ credentialService: permissiveCredentialService() }).runOnce(),
    ]);

    expect(first.retriedCount + second.retriedCount).toBe(1);
    expect(await getPublicationStatus(id)).toBe('SCHEDULED');
  });

  it('retry: a zero-attempt RETRY row is eligible and enqueues :1', async () => {
    const id = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });
    await client.sql`
      UPDATE publications SET status = 'RETRY', updated_at = now() - (120 * interval '1 second')
      WHERE id = ${id}
    `;

    const scheduler = buildScheduler({ credentialService: permissiveCredentialService() });
    expect((await scheduler.runOnce()).retriedCount).toBe(1);
    expect((await scheduler.runOnce()).scheduledCount).toBe(1);
    expect(await listOutboxJobIds()).toEqual([`content.publish:${id}:1`]);
  });

  it('retry: batch max-attempt helper maps ids and omits attempt-less publications', async () => {
    const withAttempts = await createRetryPublication({ maxAttempt: 3, updatedAtAgoSeconds: 10 });
    const attemptLess = await createPublication({
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() - 60_000),
    });

    const map = await txManager.run(async (tx) =>
      publicationAttemptsRepo.findMaxAttemptsByIds(tx, [withAttempts, attemptLess]),
    );

    expect(map.get(withAttempts)).toBe(3);
    expect(map.has(attemptLess)).toBe(false);
    expect((map.get(attemptLess) ?? 0) + 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

async function ensureDestination(client: DatabaseClient, marker: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM destinations WHERE external_id = ${marker}
  `;
  if (existing[0]) return existing[0].id;
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO destinations (name, type, external_id)
    VALUES ('Scheduler Test', 'META', ${marker})
    RETURNING id
  `;
  return created[0]!.id;
}

async function ensureContentItem(client: DatabaseClient, url: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM content_items WHERE canonical_url = ${url} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO content_items (canonical_url, status)
    VALUES (${url}, 'PUBLISHED')
    RETURNING id
  `;
  return created[0]!.id;
}

async function ensureStory(client: DatabaseClient, title: string): Promise<string> {
  const existing = await client.sql<{ id: string }[]>`
    SELECT id FROM stories WHERE title = ${title} LIMIT 1
  `;
  if (existing[0]) return existing[0].id;
  const created = await client.sql<{ id: string }[]>`
    INSERT INTO stories (title, status)
    VALUES (${title}, 'ACTIVE')
    RETURNING id
  `;
  return created[0]!.id;
}
