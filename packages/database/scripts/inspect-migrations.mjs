import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  console.log('\n=== Applied migrations (drizzle.__drizzle_migrations) ===');
  const applied = await sql`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at
  `;
  console.table(applied);

  console.log('\n=== Public tables ===');
  const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  console.table(tables);

  console.log('\n=== webhook_endpoints columns (if exists) ===');
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhook_endpoints'
    ORDER BY ordinal_position
  `;
  if (cols.length === 0) {
    console.log('  (webhook_endpoints table does NOT exist)');
  } else {
    console.table(cols);
  }

  console.log('\n=== webhook_subscriptions columns ===');
  const subCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhook_subscriptions'
    ORDER BY ordinal_position
  `;
  console.table(subCols);

  console.log('\n=== external_interactions columns ===');
  const eCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'external_interactions'
    ORDER BY ordinal_position
  `;
  console.table(eCols);

  console.log('\n=== indexes on external_interactions ===');
  const idx = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'external_interactions'
  `;
  console.table(idx);

  console.log('\n=== indexes on provider_credentials ===');
  const idx2 = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'provider_credentials'
  `;
  console.table(idx2);
} finally {
  await sql.end();
}
