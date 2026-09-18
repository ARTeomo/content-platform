import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(__dirname, '..', 'package.json'));
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  console.log('=== webhook_deliveries (last 5) ===');
  const deliveries = await sql`
    SELECT id, webhook_event_id, attempt_number, status, error_category, error_message, worker_id, created_at
    FROM webhook_deliveries
    ORDER BY created_at DESC
    LIMIT 5
  `;
  console.table(deliveries);

  console.log('\n=== raw_payload of FAILED event ===');
  const events = await sql`
    SELECT id, raw_payload
    FROM webhook_events
    WHERE status = 'FAILED'
    ORDER BY received_at DESC
    LIMIT 1
  `;
  for (const e of events) {
    console.log('event id:', e.id);
    console.log(JSON.stringify(e.raw_payload, null, 2));
  }
} finally {
  await sql.end({ timeout: 5 });
}
