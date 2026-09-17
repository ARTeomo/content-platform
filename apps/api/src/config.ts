export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
  metaAppSecret: string;
  webhookTokenEncryptionKey: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export function loadApiConfig(): ApiConfig {
  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    databaseUrl: requireEnv('DATABASE_URL'),
    metaAppSecret: requireEnv('META_APP_SECRET'),
    webhookTokenEncryptionKey: requireEnv('WEBHOOK_TOKEN_ENCRYPTION_KEY'),
  };
}
