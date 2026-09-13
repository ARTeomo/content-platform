import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.js';

/**
 * Runtime configuration for the database client factory.
 */
export interface DatabaseConfig {
  /** PostgreSQL connection URL. */
  url: string;
  /** Maximum number of connections in the pool. Default: 10. */
  maxConnections?: number;
  /** Idle connection timeout in seconds. Default: 30. */
  idleTimeoutSeconds?: number;
  /** Connection attempt timeout in seconds. Default: 10. */
  connectionTimeoutSeconds?: number;
  /** Application name reported to PostgreSQL. Default: 'content-platform'. */
  applicationName?: string;
  /**
   * Enable prepared statements. Default: true.
   *
   * Must be `false` when the connection passes through PgBouncer in
   * transaction mode.
   */
  prepare?: boolean;
  /** Enable Drizzle query logging. Default: false. */
  logger?: boolean;
}

/**
 * A database client bundle: Drizzle instance, raw SQL client, health check,
 * and graceful shutdown.
 */
export interface DatabaseClient {
  /** Drizzle ORM instance, fully typed against the schema. */
  db: PostgresJsDatabase<typeof schema>;
  /** Raw postgres.js client, for health checks and administrative queries. */
  sql: Sql;
  /** Returns true if the connection pool can serve a trivial query. */
  healthCheck: () => Promise<boolean>;
  /** Gracefully close the connection pool. */
  close: () => Promise<void>;
}

/**
 * Create a database client. Call once per application process at startup
 * and share the returned instance across the process.
 *
 * The factory pattern is used instead of a module-level singleton so that
 * tests can create isolated clients and so that each process (apps/api,
 * apps/worker) owns its own pool.
 *
 * @param config - Runtime database configuration.
 * @returns A configured database client.
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const sql = postgres(config.url, {
    max: config.maxConnections ?? 10,
    idle_timeout: config.idleTimeoutSeconds ?? 30,
    connect_timeout: config.connectionTimeoutSeconds ?? 10,
    prepare: config.prepare ?? true,
    connection: {
      application_name: config.applicationName ?? 'content-platform',
    },
  });

  const db = drizzle(sql, {
    schema,
    logger: config.logger ?? false,
  });

  return {
    db,
    sql,
    async healthCheck(): Promise<boolean> {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * Convenience type alias for the Drizzle instance.
 */
export type Database = DatabaseClient['db'];
