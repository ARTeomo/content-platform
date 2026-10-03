import { eq } from 'drizzle-orm';
import { systemConfig } from '../schema/config/system-config.js';
import type { Database, Transaction } from '../transaction/transaction-manager.js';

type SystemConfigRow = typeof systemConfig.$inferSelect;

/**
 * Repository for database-backed runtime configuration.
 *
 * Values are stored as JSONB under a text primary key. Consumers
 * cast the raw JSON to their expected shape; the repository returns
 * `unknown` to force the caller to be explicit about the type.
 *
 * The repository never writes to `config_audit_log`. That is the
 * responsibility of the service layer that performs administrative
 * configuration changes (Phase 14+). Runtime reads from the worker
 * only need `get` / `getMany`.
 */
export class SystemConfigRepository {
  constructor(private readonly db: Database) {}

  /**
   * Read a single configuration value by key.
   *
   * Returns `undefined` when the key is absent. Callers must supply
   * their own fallback default; the repository does not know the
   * shape of any particular configuration domain.
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const [row] = await this.db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    return row?.value as T | undefined;
  }

  /**
   * Read multiple configuration values in one round-trip.
   *
   * The result map contains only the keys that were actually present
   * in the database. Absent keys are not present in the map, so the
   * caller can distinguish "not configured" from "configured to a
   * falsy value".
   */
  async getMany<T = unknown>(keys: readonly string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    if (keys.length === 0) return result;

    const rows = await this.db.select().from(systemConfig);
    const wanted = new Set(keys);
    for (const row of rows) {
      if (wanted.has(row.key)) {
        result.set(row.key, row.value as T);
      }
    }
    return result;
  }

  /**
   * Insert or update a configuration value inside a caller-controlled
   * transaction.
   *
   * Used by administrative tooling. The runtime worker never calls
   * this method.
   */
  async set<T = unknown>(
    tx: Transaction,
    key: string,
    value: T,
    updatedBy?: string,
  ): Promise<void> {
    await tx
      .insert(systemConfig)
      .values({
        key,
        value: value as unknown,
        ...(updatedBy !== undefined && { updatedBy }),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: {
          value: value as unknown,
          ...(updatedBy !== undefined && { updatedBy }),
          updatedAt: new Date(),
        },
      });
  }

  /**
   * List all configuration rows. Intended for the admin UI and for
   * diagnostics.
   */
  async list(): Promise<SystemConfigRow[]> {
    return await this.db.select().from(systemConfig);
  }
}
