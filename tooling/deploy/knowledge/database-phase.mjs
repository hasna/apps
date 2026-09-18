import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { mkdtemp, chmod, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Server-only deployment diagnostic. No database URL, rows, dump bytes or
// API-key material is written to stdout/stderr. The only output is a code.
const fail = (code) => { throw new Error(code); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const digest = (value) => createHash('sha256').update(value).digest('hex');
const reviewedBytes = readFileSync(new URL('./reviewed-migrations.json', import.meta.url));
export const reviewedMigrationsSha256 = digest(reviewedBytes);
const reviewed = JSON.parse(reviewedBytes);
const reviewedIds = reviewed.migrations.map(item => item.id);
const isLedger = table => table.schema === reviewed.ledger.schema && table.table === reviewed.ledger.table;
const isNonce = table => table.schema === reviewed.added_table.schema && table.table === reviewed.added_table.name;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function policy(config) {
  const value = config.migration_policy ?? 'no-pending-migrations';
  requireValue(['no-pending-migrations', 'reviewed-additive-nonce-v1'].includes(value), 'MIGRATION_POLICY');
  if (value === 'reviewed-additive-nonce-v1') {
    requireValue(config.reviewed_migrations_sha256 === reviewedMigrationsSha256, 'REVIEWED_MIGRATIONS_DIGEST');
    requireValue(reviewed.schema === 'knowledge.reviewed-migrations.v1'
      && same(reviewedIds, [132, 133, 134, 135, 136].map(n => 'knowledge_pg_' + n)), 'REVIEWED_MIGRATIONS_CONTRACT');
  }
  return value;
}

// Catalog definitions are hashed into the receipt; private function bodies and
// default expressions never leave the database phase. OIDs are excluded.
export async function relationShape(client, schema, name) {
  const identity = [schema, name];
  const relation = await client.query(`SELECT c.relkind::text AS kind, c.relpersistence::text AS persistence,
    c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security,
    c.relreplident::text AS replica_identity, c.reloptions AS options, c.relacl::text AS acl,
    pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`, identity);
  if (relation.rows.length !== 1) return null;
  const columns = await client.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null, a.attidentity::text AS identity, a.attgenerated::text AS generated,
    pg_get_expr(d.adbin,d.adrelid) AS default_expression,
    CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END AS collation
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, identity);
  const constraints = await client.query(`SELECT con.conname AS name, con.contype::text AS type,
    pg_get_constraintdef(con.oid) AS definition, con.convalidated AS validated,
    con.condeferrable AS deferrable, con.condeferred AS initially_deferred
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=$2 ORDER BY con.conname`, identity);
  const indexes = await client.query(`SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
    i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class ic ON ic.oid=i.indexrelid WHERE n.nspname=$1 AND c.relname=$2 ORDER BY ic.relname`, identity);
  const triggers = await client.query(`SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS definition,
    t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2
    AND NOT t.tgisinternal ORDER BY t.tgname`, identity);
  const policies = await client.query(`SELECT pol.polname AS name, pol.polcmd::text AS command,
    pol.polpermissive AS permissive, pol.polroles::regrole[]::text AS roles,
    pg_get_expr(pol.polqual,pol.polrelid) AS using_expression,
    pg_get_expr(pol.polwithcheck,pol.polrelid) AS check_expression
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=$2 ORDER BY pol.polname`, identity);
  return { ...relation.rows[0], columns: columns.rows, constraints: constraints.rows,
    indexes: indexes.rows, triggers: triggers.rows, policies: policies.rows };
}

export async function functionShapes(client) {
  return (await client.query(`SELECT n.nspname AS schema, p.proname AS name,
    pg_get_function_identity_arguments(p.oid) AS arguments, p.prokind::text AS kind,
    CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) ELSE NULL END AS definition,
    p.prosrc AS source, p.probin AS binary, p.prorettype::regtype::text AS return_type,
    l.lanname AS language, p.provolatile::text AS volatility, p.proisstrict AS strict,
    p.prosecdef AS security_definer, p.proleakproof AS leakproof, p.proparallel::text AS parallel,
    p.proconfig AS config, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
    ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`)).rows;
}


export function validateConfig(env) {
  const value = JSON.parse(env.KNOWLEDGE_DEPLOY_CONFIG ?? '{}');
  requireValue(value.schema === 'knowledge.database-deploy.v1', 'CONFIG_SCHEMA');
  requireValue(/^[0-9a-f]{40}$/.test(value.source ?? ''), 'SOURCE');
  requireValue(/^sha256:[0-9a-f]{64}$/.test(value.image_digest ?? ''), 'IMAGE_DIGEST');
  requireValue(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket ?? ''), 'BUCKET');
  requireValue(/^deployment-backups\/knowledge\/[0-9]+-[0-9]+\/[0-9a-f]{40}$/.test(value.prefix ?? ''), 'BACKUP_PREFIX');
  requireValue(value.legacy_owner_mode === 'disabled', 'LEGACY_OWNER_DISABLED');
  requireValue(!env.HASNA_KNOWLEDGE_LEGACY_OWNER_TENANT_ID, 'UNVERIFIED_LEGACY_OWNER');
  policy(value);
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
    results.push({ schema: table.schema, table: table.name, count, sha256: hash.digest('hex'),
      schema_sha256: digest(JSON.stringify(await relationShape(client, table.schema, table.name))) });
  }
  const sequences = await client.query(`SELECT schemaname,sequencename,start_value,min_value,max_value,
    increment_by,cycle,cache_size,last_value FROM pg_sequences
    WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema'
    ORDER BY schemaname,sequencename`);
  const sequenceStates = [];
  for (const sequence of sequences.rows) {
    const state = await client.query(`SELECT last_value::text,is_called FROM ${quote(sequence.schemaname)}.${quote(sequence.sequencename)}`);
    sequenceStates.push({ ...sequence, ...state.rows[0] });
  }
  const sequenceSha256 = digest(JSON.stringify(sequenceStates));
  const functions = (await functionShapes(client)).map(fn => ({ schema: fn.schema, name: fn.name,
    arguments: fn.arguments, sha256: digest(JSON.stringify(fn)) }));
  const result = { tables: results, sequences: sequenceStates, sequence_sha256: sequenceSha256, functions };
  return { ...result, sha256: digest(JSON.stringify(result)) };
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
  requireValue(result.pending.every(id => typeof id === 'string'), 'MIGRATION_RESPONSE');
  return { total: result.total, already_applied: result.alreadyApplied, pending: result.pending.length, pending_ids: result.pending };
}

async function ledgerRows(client) {
  return (await client.query(`SELECT id,checksum,applied_at::text AS applied_at FROM
    ${quote(reviewed.ledger.schema)}.${quote(reviewed.ledger.table)} ORDER BY id COLLATE "C"`)).rows;
}

function verifyBuilderAndLedger(built, rows, migrationPolicy) {
  const pinned = built.filter(item => reviewedIds.includes(item.id)).map(({ id, checksum }) => ({ id, checksum }));
  requireValue(same(pinned, reviewed.migrations), 'REVIEWED_BUILDER_CHECKSUM_MISMATCH');
  const known = new Map(built.map(item => [item.id, item]));
  const applied = new Map(rows.map(item => [item.id, item]));
  requireValue(applied.size === rows.length, 'LEDGER_DUPLICATE');
  for (const row of rows) requireValue(known.get(row.id)?.checksum === row.checksum, 'LEDGER_CHECKSUM_OR_UNKNOWN_MIGRATION');
  const pending = built.filter(item => !applied.has(item.id)).map(item => item.id);
  if (migrationPolicy === 'no-pending-migrations') requireValue(pending.length === 0, 'PENDING_MIGRATIONS_REQUIRE_REVIEWED_EVOLUTION');
  else requireValue(pending.length === 0 || same(pending, reviewedIds), 'REVIEWED_PENDING_SET_MISMATCH');
  return pending;
}

function verifyPlan(plan, pending) {
  requireValue(plan.pending === pending.length && same(plan.pending_ids, pending), 'MIGRATION_PLAN_MISMATCH');
}

async function verifyNonceShape(client) {
  const shape = await relationShape(client, reviewed.added_table.schema, reviewed.added_table.name);
  requireValue(shape !== null, 'REVIEWED_TABLE_MISSING');
  // Object ownership is preserved in full fingerprints. The new objects must
  // be owned by the executing owner, whose account name is deployment-specific.
  const owner = (await client.query('SELECT current_user AS name')).rows[0].name;
  requireValue(shape.owner === owner, 'REVIEWED_TABLE_OWNER');
  const { owner: ignored, acl: inheritedAcl, ...withoutOwner } = shape;
  requireValue(same(withoutOwner, reviewed.added_table.shape), 'REVIEWED_TABLE_SHAPE_MISMATCH');
  const functions = (await functionShapes(client)).filter(fn => fn.schema === reviewed.added_function.schema && fn.name === reviewed.added_function.name);
  requireValue(functions.length === 1 && functions[0].owner === owner, 'REVIEWED_FUNCTION_IDENTITY');
  const { owner: ignoredFunctionOwner, acl: inheritedFunctionAcl, ...functionShape } = functions[0];
  requireValue(same(functionShape, reviewed.added_function.shape), 'REVIEWED_FUNCTION_SHAPE_MISMATCH');
}

async function runtimePermissions(client, runtimeRole, creating) {
  requireValue(typeof runtimeRole === 'string' && runtimeRole.length > 0, 'RUNTIME_ROLE_REQUIRED');
  const qualified = quote(reviewed.added_table.schema) + '.' + quote(reviewed.added_table.name);
  let permissions;
  if (!creating) {
    permissions = await client.query(`SELECT has_schema_privilege($1,$2,'USAGE') AS schema_usage,
      has_table_privilege($1,$3,'SELECT') AS can_select,
      has_table_privilege($1,$3,'INSERT') AS can_insert`, [runtimeRole, reviewed.added_table.schema, qualified]);
  } else {
    // Read the owner's effective future-table defaults. No probe table, grant,
    // role change or other database write is needed to prove both privileges.
    permissions = await client.query(`WITH owner_role AS (
      SELECT oid FROM pg_roles WHERE rolname=current_user
    ), runtime_role AS (SELECT oid,rolsuper FROM pg_roles WHERE rolname=$1), defaults AS (
      SELECT a.* FROM owner_role o CROSS JOIN LATERAL aclexplode(COALESCE(
        (SELECT defaclacl FROM pg_default_acl WHERE defaclrole=o.oid AND defaclnamespace=0 AND defaclobjtype='r'),
        acldefault('r',o.oid))) a
      UNION ALL
      SELECT a.* FROM owner_role o JOIN pg_default_acl d ON d.defaclrole=o.oid
        JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE n.nspname=$2 AND d.defaclobjtype='r'
    ) SELECT has_schema_privilege(r.oid,$2,'USAGE') AS schema_usage,
      (r.rolsuper OR pg_has_role(r.oid,o.oid,'USAGE') OR EXISTS (
        SELECT 1 FROM defaults d WHERE d.privilege_type='SELECT'
        AND CASE WHEN d.grantee=0 THEN true ELSE pg_has_role(r.oid,d.grantee,'USAGE') END)) AS can_select,
      (r.rolsuper OR pg_has_role(r.oid,o.oid,'USAGE') OR EXISTS (
        SELECT 1 FROM defaults d WHERE d.privilege_type='INSERT'
        AND CASE WHEN d.grantee=0 THEN true ELSE pg_has_role(r.oid,d.grantee,'USAGE') END)) AS can_insert
      FROM runtime_role r CROSS JOIN owner_role o`, [runtimeRole, reviewed.added_table.schema]);
  }
  requireValue(permissions.rows.length === 1 && permissions.rows[0].schema_usage === true
    && permissions.rows[0].can_select === true && permissions.rows[0].can_insert === true,
  creating ? 'RUNTIME_DEFAULT_PRIVILEGES_REQUIRED' : 'RUNTIME_TABLE_PRIVILEGES_REQUIRED');
}

async function verifyBefore(client, pre, pending, migrationPolicy, runtimeRole) {
  if (migrationPolicy !== 'reviewed-additive-nonce-v1') return;
  const nonce = pre.tables.filter(isNonce);
  const functions = pre.functions.filter(fn => fn.schema === reviewed.added_function.schema && fn.name === reviewed.added_function.name);
  if (pending.length) requireValue(nonce.length === 0 && functions.length === 0, 'REVIEWED_ADDITION_ALREADY_PRESENT');
  else await verifyNonceShape(client);
  await runtimePermissions(client, runtimeRole, pending.length > 0);
}

async function verifyEvolution(client, pre, post, beforeLedger, afterLedger, pending, migrationPolicy, runtimeRole) {
  const additions = pending.length > 0;
  if (migrationPolicy === 'reviewed-additive-nonce-v1') await runtimePermissions(client, runtimeRole, false);
  const baseProof = { existing_domain_preserved: true, existing_ledger_preserved: true,
    runtime_permissions_verified: migrationPolicy === 'reviewed-additive-nonce-v1',
    exact_reviewed_additions: additions, added_migrations: [], added_tables: [], added_functions: [] };
  if (!additions) {
    requireValue(pre.sha256 === post.sha256 && same(beforeLedger, afterLedger), 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    if (migrationPolicy === 'reviewed-additive-nonce-v1') await verifyNonceShape(client);
    const existing = digest(JSON.stringify(pre));
    return { ...baseProof, existing_domain: { pre: existing, post: digest(JSON.stringify(post)) },
      ledger: { preserved_pre: digest(JSON.stringify(beforeLedger)), preserved_post: digest(JSON.stringify(afterLedger)) } };
  }
  requireValue(pre.sequence_sha256 === post.sequence_sha256, 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
  const existingPost = post.tables.filter(table => !isNonce(table));
  requireValue(existingPost.length === pre.tables.length, 'UNEXPECTED_TABLE_DELTA');
  for (const before of pre.tables) {
    const after = existingPost.find(table => table.schema === before.schema && table.table === before.table);
    requireValue(Boolean(after), 'EXISTING_TABLE_MISSING');
    requireValue(isLedger(before) ? before.schema_sha256 === after.schema_sha256 : same(before, after), 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
  }
  const oldLedger = afterLedger.filter(row => !reviewedIds.includes(row.id));
  requireValue(same(beforeLedger, oldLedger), 'EXISTING_LEDGER_INTEGRITY_MISMATCH');
  const addedLedger = afterLedger.filter(row => reviewedIds.includes(row.id));
  requireValue(same(addedLedger.map(({id,checksum}) => ({id,checksum})), reviewed.migrations)
    && addedLedger.every(row => typeof row.applied_at === 'string' && Number.isFinite(Date.parse(row.applied_at))), 'REVIEWED_LEDGER_DELTA_MISMATCH');
  const nonce = post.tables.filter(isNonce);
  requireValue(nonce.length === 1 && nonce[0].count === 0, 'REVIEWED_TABLE_NOT_EMPTY');
  await verifyNonceShape(client);
  const addedFunction = fn => fn.schema === reviewed.added_function.schema && fn.name === reviewed.added_function.name;
  requireValue(same(pre.functions, post.functions.filter(fn => !addedFunction(fn))), 'EXISTING_FUNCTION_INTEGRITY_MISMATCH');
  const functionDelta = post.functions.filter(addedFunction);
  requireValue(functionDelta.length === 1, 'REVIEWED_FUNCTION_DELTA_MISMATCH');
  const domain = (snapshot, newObjects) => ({ tables: snapshot.tables.filter(table => !isLedger(table) && !(newObjects && isNonce(table))),
    sequences: snapshot.sequences, functions: snapshot.functions.filter(fn => !(newObjects && addedFunction(fn))) });
  const preservedPre = digest(JSON.stringify(domain(pre, false)));
  const preservedPost = digest(JSON.stringify(domain(post, true)));
  requireValue(preservedPre === preservedPost, 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
  return { ...baseProof, existing_domain: { pre: preservedPre, post: preservedPost },
    ledger: { preserved_pre: digest(JSON.stringify(beforeLedger)), preserved_post: digest(JSON.stringify(oldLedger)) },
    added_migrations: addedLedger, added_tables: nonce, added_functions: functionDelta };
}

export async function runDatabasePhase(config, { database, s3, sourceUrl, runMigration = migration, dumpEnvironment, commands, runtimeRole } ) {
  const migrationPolicy = policy(config);
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
    const beforeLedger = await ledgerRows(client);
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
    // verify the entire builder/ledger before permitting the exact five additions.
    const { buildKnowledgePostgresMigrations } = await import(pathToFileURL(join(process.cwd(), 'dist/serve.js')).href);
    const built = buildKnowledgePostgresMigrations();
    const pending = verifyBuilderAndLedger(built, beforeLedger, migrationPolicy);
    await verifyBefore(client, pre, pending, migrationPolicy, runtimeRole);
    const plan = await runMigration(true);
    verifyPlan(plan, pending);
    const executed = await runMigration(false);
    verifyPlan(executed, pending);
    const applied = await runMigration(true);
    verifyPlan(applied, []);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='15min'");
    await client.query("SET LOCAL row_security=off");
    const post = await fingerprint(client);
    const afterLedger = await ledgerRows(client);
    const proof = await verifyEvolution(client, pre, post, beforeLedger, afterLedger, pending, migrationPolicy, runtimeRole);
    await client.query('COMMIT');
    const receipt = { schema: 'knowledge.database-deploy-receipt.v1', source: config.source,
      image_digest: config.image_digest, legacy_owner_mode: 'disabled',
      backup: { bucket: config.bucket, key, version_id: stored.VersionId, ...hash, toc_sha256: digest(toc) },
      migration: { policy: migrationPolicy, reviewed_migrations_sha256: migrationPolicy === 'reviewed-additive-nonce-v1' ? reviewedMigrationsSha256 : null,
        before: plan, executed, after: applied }, integrity: { pre, post, proof }, success: true };
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
  const runtimeUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL;
  const runtimeRole = runtimeUrl ? decodeURIComponent(new URL(runtimeUrl).username) : undefined;
  const sourceUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER;
  requireValue(Boolean(sourceUrl), 'OWNER_CONNECTION_REQUIRED');
  const { createKnowledgeDatabaseClient, normalizePostgresDatabaseUrl } = await import('../dist/serve.js');
  process.env.HASNA_KNOWLEDGE_DATABASE_URL = sourceUrl;
  normalizePostgresDatabaseUrl();
  const commands = await import('@aws-sdk/client-s3');
  await runDatabasePhase(config, { sourceUrl, runtimeRole, database: createKnowledgeDatabaseClient(), commands, s3: new commands.S3Client({ region: process.env.AWS_REGION }) });
  console.log('KNOWLEDGE_DATABASE_DEPLOY_OK');
}

if (import.meta.main) main().catch(() => { console.error('KNOWLEDGE_DATABASE_DEPLOY_REFUSED'); process.exitCode = 1; });
