import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../client.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

/**
 * Integration test for the interaction_responses.destination_id foreign key.
 *
 * DATABASE_SCHEMA_CONTRACT.md §5.41 mandates
 * FK -> destinations.id ON DELETE RESTRICT because the column is NOT NULL;
 * ON DELETE SET NULL would violate the NOT NULL declaration.
 *
 * These tests require a PostgreSQL database with migration 0019 applied.
 * They are skipped when TEST_DATABASE_URL is not set.
 *
 * To run:
 *   TEST_DATABASE_URL=postgresql://... pnpm test
 */
describe.skipIf(!TEST_DB_URL)('interaction_responses destination FK (CP-F-02)', () => {
  let client: DatabaseClient;

  beforeAll(async () => {
    client = createDatabaseClient({ url: TEST_DB_URL! });
    await client.sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  });

  afterAll(async () => {
    await client.close();
  });

  it('rejects destination deletion while interaction_responses reference it', async () => {
    const marker = `wp1-fk-${randomUUID()}`;
    const markerA = `${marker}-a`;
    const markerB = `${marker}-b`;

    const destinationRows = await client.sql`
      INSERT INTO destinations (name, type, external_id)
      VALUES ('WP-1 FK test destination', 'TEST', ${marker})
      RETURNING id
    `;
    const destinationId = String(destinationRows[0]!.id);

    const interactionRows = await client.sql`
      INSERT INTO external_interactions
        (destination_id, provider, interaction_type, external_interaction_id, occurred_at)
      VALUES
        (${destinationId}, 'TEST', 'COMMENT', ${markerA}, now()),
        (${destinationId}, 'TEST', 'COMMENT', ${markerB}, now())
      RETURNING id
    `;
    expect(interactionRows).toHaveLength(2);
    const interactionIds = interactionRows.map((row) => String(row.id));

    await client.sql`
      INSERT INTO interaction_responses (interaction_id, destination_id)
      VALUES (${interactionIds[0]!}, ${destinationId}), (${interactionIds[1]!}, ${destinationId})
    `;

    try {
      const before = await client.sql`
        SELECT * FROM interaction_responses WHERE destination_id = ${destinationId} ORDER BY id
      `;
      expect(before).toHaveLength(2);

      let fkViolation: { code?: string } | null = null;
      try {
        await client.sql`DELETE FROM destinations WHERE id = ${destinationId}`;
      } catch (err) {
        fkViolation = err as { code?: string };
      }

      expect(fkViolation).not.toBeNull();
      expect(fkViolation?.code).toBe('23001');

      const after = await client.sql`
        SELECT * FROM interaction_responses WHERE destination_id = ${destinationId} ORDER BY id
      `;
      expect(after).toHaveLength(before.length);
      expect(after).toEqual(before);
    } finally {
      await client.sql`DELETE FROM interaction_responses WHERE destination_id = ${destinationId}`;
      for (const interactionId of interactionIds) {
        await client.sql`DELETE FROM external_interactions WHERE id = ${interactionId}`;
      }
      await client.sql`DELETE FROM destinations WHERE id = ${destinationId}`;
    }
  });
});
