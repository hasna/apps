import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Server-only deployment diagnostic. No database URL, rows, dump bytes or
// API-key material is written to stdout/stderr. The only output is a code.
const fail = (code) => { throw new Error(code); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function validateConfig(env) {
  const value = JSON.parse(env.KNOWLEDGE_DEPLOY_CONFIG ?? '{}');
  requireValue(value.schema === 'knowledge.database-deploy.v1', 'CONFIG_SCHEMA');
  requireValue(/^[0-9a-f]{40}$/.test(value.source ?? ''), 'SOURCE');
  requireValue(/^sha256:[0-9a-f]{64}$/.test(value.image_digest ?? ''), 'IMAGE_DIGEST');
  requireValue(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket ?? ''), 'BUCKET');
  requireValue(/^deployment-backups\/knowledge\/[0-9]+-[0-9]+\/[0-9a-f]{40}$/.test(value.prefix ?? ''), 'BACKUP_PREFIX');
  requireValue(value.legacy_owner_mode === 'disabled', 'LEGACY_OWNER_DISABLED');
  requireValue(!env.HASNA_KNOWLEDGE_LEGACY_OWNER_TENANT_ID, 'UNVERIFIED_LEGACY_OWNER');
  return value;
}

async function hashStream(body) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of body) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

async function fingerprint(client) {
  // Stable PG JSON text and deterministic row ordering also cover tables
  // without primary keys. All non-system schemas are included, not just notes.
  const tables = await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','m') AND n.nspname NOT LIKE 'pg_%'
      AND n.nspname <> 'information_schema' ORDER BY 1,2`);
  const results = [];
  for (const table of tables.rows) {
    const qualified = quote(table.schema) + '.' + quote(table.name);
    const hash = createHash('sha256');
    let count = 0;
    await client.query(`DECLARE deploy_rows NO SCROLL CURSOR FOR
      SELECT to_jsonb(t)::text AS row FROM ${qualified} t
      ORDER BY to_jsonb(t)::text COLLATE "C"`);
    try {
      while (true) {
        const batch = await client.query('FETCH 256 FROM deploy_rows');
        if (!batch.rows.length) break;
        for (const row of batch.rows) { hash.update(row.row); hash.update('\n'); count++; }
      }
    } finally { await client.query('CLOSE deploy_rows'); }
    results.push({ schema: table.schema, table: table.name, count, sha256: hash.digest('hex') });
  }
  const sequences = await client.query(`SELECT schemaname,sequencename,start_value,min_value,max_value,
    increment_by,cycle,cache_size,last_value FROM pg_sequences
    WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
    ORDER BY schemaname,sequencename`);
  const sequenceSha256 = digest(JSON.stringify(sequences.rows));
  return { tables: results, sequence_sha256: sequenceSha256,
    sha256: digest(JSON.stringify({ tables: results, sequence_sha256: sequenceSha256 })) };
}

export async function migration(dryRun) {
  const command = ['bun', 'scripts/apply-postgres-migrations.mjs', '--json'];
  if (dryRun) command.push('--dry-run');
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', env: process.env, cwd: process.cwd() });
  const [stdout, , exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  requireValue(exit === 0, 'MIGRATION_COMMAND_FAILED');
  let result;
  try { result = JSON.parse(stdout); } catch { fail('MIGRATION_RESPONSE'); }
  requireValue(result.ok === true && result.dryRun === dryRun && Array.isArray(result.pending), 'MIGRATION_RESPONSE');
  requireValue(result.pending.length === 0, 'PENDING_MIGRATIONS_REQUIRE_REVIEWED_EVOLUTION');
  return { total: result.total, already_applied: result.alreadyApplied, pending: 0 };
}

export async function runDatabasePhase(config, { database, s3, sourceUrl, runMigration = migration, dumpEnvironment, commands } ) {
  const versioning = await s3.send(new commands.GetBucketVersioningCommand({ Bucket: config.bucket }));
  requireValue(versioning.Status === 'Enabled', 'BACKUP_VERSIONING_REQUIRED');
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-deployment-'));
  await chmod(directory, 0o700);
  const dump = join(directory, 'database.dump');
  const client = await database.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL row_security=off");
    const exported = await client.query('SELECT pg_export_snapshot() AS snapshot');
    const pre = await fingerprint(client);
    const url = new URL(sourceUrl);
    const dumpEnv = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/etc/ssl/certs/rds-global-bundle.pem', ...dumpEnvironment };
    const child = Bun.spawn(['pg_dump', '--format=custom', '--snapshot=' + exported.rows[0].snapshot,
      '--file=' + dump], { env: dumpEnv, stdout: 'ignore', stderr: 'pipe' });
    const [, dumpExit] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    requireValue(dumpExit === 0, 'FULL_BACKUP_FAILED');
    await chmod(dump, 0o600);
    const listing = Bun.spawn(['pg_restore', '--list', dump], { stdout: 'pipe', stderr: 'pipe' });
    const [toc, , listExit] = await Promise.all([new Response(listing.stdout).text(), new Response(listing.stderr).text(), listing.exited]);
    requireValue(listExit === 0 && toc.includes('TABLE DATA'), 'BACKUP_ARCHIVE_UNREADABLE');
    const hash = await hashStream(createReadStream(dump));
    requireValue(hash.bytes === (await stat(dump)).size && hash.bytes > 0, 'BACKUP_SIZE');
    const key = config.prefix + '/database.dump';
    const stored = await s3.send(new commands.PutObjectCommand({ Bucket: config.bucket, Key: key,
      Body: createReadStream(dump), ContentLength: hash.bytes, IfNoneMatch: '*',
      ServerSideEncryption: 'AES256', Metadata: { sha256: hash.sha256, source: config.source } }));
    requireValue(Boolean(stored.VersionId) && stored.VersionId !== 'null', 'BACKUP_VERSION_MISSING');
    const readback = await s3.send(new commands.GetObjectCommand({ Bucket: config.bucket, Key: key, VersionId: stored.VersionId }));
    const verified = await hashStream(readback.Body);
    requireValue(verified.sha256 === hash.sha256 && verified.bytes === hash.bytes, 'BACKUP_READBACK_MISMATCH');
    await client.query('COMMIT');
    // Even the ledger dry-run initializes its table. Back up first, then
    // refuse any pending change before invoking the no-op apply path.
    const plan = await runMigration(true);
    const applied = await runMigration(false);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL row_security=off");
    const post = await fingerprint(client);
    await client.query('COMMIT');
    requireValue(pre.sha256 === post.sha256, 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    const receipt = { schema: 'knowledge.database-deploy-receipt.v1', source: config.source,
      image_digest: config.image_digest, legacy_owner_mode: 'disabled',
      backup: { bucket: config.bucket, key, version_id: stored.VersionId, ...hash, toc_sha256: digest(toc) },
      migration: { before: plan, after: applied }, integrity: { pre, post }, success: true };
    await s3.send(new commands.PutObjectCommand({ Bucket: config.bucket, Key: config.prefix + '/receipt.json',
      Body: JSON.stringify(receipt), ContentType: 'application/json', IfNoneMatch: '*', ServerSideEncryption: 'AES256' }));
    return receipt;
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    client.release();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const config = validateConfig(process.env);
  const sourceUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER;
  requireValue(Boolean(sourceUrl), 'OWNER_CONNECTION_REQUIRED');
  const { createKnowledgeDatabaseClient, normalizePostgresDatabaseUrl } = await import('../dist/serve.js');
  process.env.HASNA_KNOWLEDGE_DATABASE_URL = sourceUrl;
  normalizePostgresDatabaseUrl();
  const commands = await import('@aws-sdk/client-s3');
  await runDatabasePhase(config, { sourceUrl, database: createKnowledgeDatabaseClient(), commands, s3: new commands.S3Client({ region: process.env.AWS_REGION }) });
  console.log('KNOWLEDGE_DATABASE_DEPLOY_OK');
}

if (import.meta.main) main().catch(() => { console.error('KNOWLEDGE_DATABASE_DEPLOY_REFUSED'); process.exitCode = 1; });
