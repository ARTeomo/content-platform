import { createDatabaseClient } from '@content-platform/database';
import { loadApiConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const client = createDatabaseClient({
    url: config.databaseUrl,
    applicationName: 'content-platform-api',
  });

  const app = await buildApp({ config, client });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await client.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error('[api] fatal error:', err);
  process.exit(1);
});
