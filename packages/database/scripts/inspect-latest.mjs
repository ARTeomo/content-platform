import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  const events = await sql`
    SELECT id, status, external_object_id, field, received_at, raw_payload
    FROM webhook_events
    ORDER BY received_at DESC
    LIMIT 1
  `;
  for (const e of events) {
    console.log('=== event ===');
    console.log('id:', e.id);
    console.log('status:', e.status);
    console.log('external_object_id:', e.external_object_id);
    console.log('field:', e.field);
    console.log('received_at:', e.received_at);
    console.log('=== raw_payload ===');
    console.log(JSON.stringify(e.raw_payload, null, 2));
  }
} finally {
  await sql.end({ timeout: 5 });
}
