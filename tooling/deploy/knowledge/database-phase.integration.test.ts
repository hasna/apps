import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createKnowledgeDatabaseClient, buildKnowledgePostgresMigrations, MigrationLedger } from '../../../apps/knowledge/dist/serve.js';
import { runDatabasePhase, migration, reviewedMigrationsSha256, validateConfig } from './database-phase.mjs';

// Real isolated PostgreSQL and archive tools; only the S3 transport is substituted.
// No hosted credentials, production endpoints, app mode override or user data.
class MemoryVersionedS3 {
  objects = new Map<string, Buffer>();
  corruptReadback = false;
  loseUploadResponse = false;
  async send(command: any) {
    const input = command.input;
    switch (command.constructor.name) {
      case 'GetBucketVersioningCommand': return { Status: 'Enabled' };
      case 'PutObjectCommand': {
        expect(input.IfNoneMatch).toBe('*');
        expect(input.ServerSideEncryption).toBe('AES256');
        expect(this.objects.has(input.Key)).toBe(false);
        const chunks = typeof input.Body === 'string' ? [Buffer.from(input.Body)] : [];
        if (typeof input.Body !== 'string') for await (const part of input.Body) chunks.push(Buffer.from(part));
        this.objects.set(input.Key, Buffer.concat(chunks));
        if (this.loseUploadResponse && input.Key.endsWith('/database.dump')) throw new Error('fixture accepted upload but lost response');
        return { VersionId: 'fixture-version-1' };
      }
      case 'GetObjectCommand': {
        expect(input.VersionId).toBe('fixture-version-1');
        const value = Buffer.from(this.objects.get(input.Key)!);
        if (this.corruptReadback) value[0] ^= 1;
        return { Body: Readable.from([value]) };
      }
      default: throw new Error('unexpected S3 operation');
    }
  }
}

async function command(args: string[], options: any = {}) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', ...options });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`fixture command failed ${args[0]} (${code}): ${err}`);
  return out;
}

const commands = createRequire(new URL('../../../apps/knowledge/package.json', import.meta.url))('@aws-sdk/client-s3');
const pgBin = process.env.KNOWLEDGE_TEST_PG_BIN ?? '/usr/lib/postgresql/16/bin';
const packageDir = new URL('../../../apps/knowledge/', import.meta.url).pathname;

test('real PostgreSQL snapshot/archive/ledger: complete integrity, restore, corrupt readback and pending refusal', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'knowledge-db-integration-'));
  const data = join(temp, 'data');
  const socket = join(temp, 'socket');
  await mkdir(socket, { mode: 0o700 });
  const port = '55439'; // Unix socket belongs only to this private directory.
  const sourceUrl = `postgresql://${process.env.USER}@localhost:${port}/postgres?host=${encodeURIComponent(socket)}&sslmode=disable`;
  const env = { ...process.env, HASNA_KNOWLEDGE_DATABASE_URL: sourceUrl, HASNA_KNOWLEDGE_DATABASE_URL_OWNER: sourceUrl };
  const oldCwd = process.cwd();
  const oldUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL;
  const oldOwner = process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER;
  const dumpEnvironment = { PGHOST: socket, PGPORT: port, PGSSLMODE: 'disable', PGSSLROOTCERT: '' };
  const config = { schema: 'knowledge.database-deploy.v1', source: 'a'.repeat(40), image_digest: 'sha256:' + 'b'.repeat(64), bucket: 'fixture-backup', prefix: 'deployment-backups/knowledge/1-1/' + 'a'.repeat(40), legacy_owner_mode: 'disabled' };
  let started = false;
  try {
    await command([pgBin + '/initdb', '-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8']);
    await command([pgBin + '/pg_ctl', '-D', data, '-l', join(temp, 'postgres.log'), '-o', `-F -k ${socket} -p ${port} -c listen_addresses=''`, 'start']);
    started = true;
    process.chdir(packageDir);
    process.env.HASNA_KNOWLEDGE_DATABASE_URL = sourceUrl;
    process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER = sourceUrl;
    await command(['bun', 'scripts/apply-postgres-migrations.mjs', '--json'], { cwd: packageDir, env });
    const fixture = createKnowledgeDatabaseClient(env);
    for (const sql of `CREATE SCHEMA integration_extra;
      CREATE TABLE integration_extra.history (revision bigint, body text, provenance jsonb);
      INSERT INTO integration_extra.history VALUES (1, 'synthetic original', '{"author":"fixture","source_version":1}');
      CREATE TABLE integration_extra.no_primary_key (body text);
      INSERT INTO integration_extra.no_primary_key VALUES ('same'), ('same'), ('different');
      CREATE SEQUENCE integration_extra.sequence;
      SELECT nextval('integration_extra.sequence');`.split(';').filter(s => s.trim())) await fixture.query(sql);
    await fixture.close();
    await command(['bun', 'scripts/apply-postgres-migrations.mjs', '--dry-run', '--json'], { cwd: packageDir, env });
    const s3 = new MemoryVersionedS3();
    const receipt = await runDatabasePhase(config, { commands, database: createKnowledgeDatabaseClient(env), s3, sourceUrl, dumpEnvironment });
    expect(receipt.success).toBe(true);
    expect(receipt.integrity.pre).toEqual(receipt.integrity.post);
    expect(receipt.integrity.pre.tables.find((t: any) => t.schema === 'integration_extra' && t.table === 'no_primary_key').count).toBe(3);
    expect(receipt.migration.before.pending).toBe(0);
    expect(receipt.migration.after.pending).toBe(0);
    expect(s3.objects.has(config.prefix + '/receipt.json')).toBe(true);
    const archive = join(temp, 'backup.dump');
    await Bun.write(archive, s3.objects.get(config.prefix + '/database.dump')!);
    await command([pgBin + '/createdb', 'restored'], { env: { ...process.env, ...dumpEnvironment } });
    await command(['pg_restore', '--exit-on-error', '--dbname=restored', archive], { env: { ...process.env, ...dumpEnvironment } });
    const restored = createKnowledgeDatabaseClient({ ...env, HASNA_KNOWLEDGE_DATABASE_URL: sourceUrl.replace('/postgres?', '/restored?') });
    expect((await restored.query('SELECT body,provenance FROM integration_extra.history')).rows).toEqual([{ body: 'synthetic original', provenance: { author: 'fixture', source_version: 1 } }]);
    expect(Number((await restored.query('SELECT count(*) AS n FROM integration_extra.no_primary_key')).rows[0].n)).toBe(3);
    await restored.close();

    let migrations = 0;
    const corrupt = new MemoryVersionedS3();
    corrupt.corruptReadback = true;
    await expect(runDatabasePhase(config, { commands, database: createKnowledgeDatabaseClient(env), s3: corrupt, sourceUrl, dumpEnvironment,
      runMigration: async (dry: boolean) => { migrations++; return migration(dry); } })).rejects.toThrow('BACKUP_READBACK_MISMATCH');
    expect(migrations).toBe(0);
    expect(corrupt.objects.has(config.prefix + '/receipt.json')).toBe(false);

    const ambiguous = new MemoryVersionedS3();
    ambiguous.loseUploadResponse = true;
    await expect(runDatabasePhase(config, { commands, database: createKnowledgeDatabaseClient(env), s3: ambiguous, sourceUrl, dumpEnvironment,
      runMigration: async (dry: boolean) => { migrations++; return migration(dry); } })).rejects.toThrow('accepted upload but lost response');
    expect(migrations).toBe(0);
    expect(ambiguous.objects.has(config.prefix + '/database.dump')).toBe(true);
    expect(ambiguous.objects.has(config.prefix + '/receipt.json')).toBe(false);

    const drift = new MemoryVersionedS3();
    await expect(runDatabasePhase(config, { commands, database: createKnowledgeDatabaseClient(env), s3: drift, sourceUrl, dumpEnvironment,
      runMigration: async (dry: boolean) => {
        const result = await migration(dry);
        if (!dry) {
          const outsider = createKnowledgeDatabaseClient(env);
          try { await outsider.query("UPDATE integration_extra.history SET body='synthetic drift'"); }
          finally { await outsider.close(); }
        }
        return result;
      } })).rejects.toThrow('COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    expect(drift.objects.has(config.prefix + '/receipt.json')).toBe(false);

    const pending = createKnowledgeDatabaseClient(env);
    await pending.query("DELETE FROM schema_migrations WHERE id = (SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1)");
    await pending.close();
    const refused = new MemoryVersionedS3();
    await expect(runDatabasePhase(config, { commands, database: createKnowledgeDatabaseClient(env), s3: refused, sourceUrl, dumpEnvironment })).rejects.toThrow('PENDING_MIGRATIONS_REQUIRE_REVIEWED_EVOLUTION');
    expect(refused.objects.has(config.prefix + '/database.dump')).toBe(true);
    expect(refused.objects.has(config.prefix + '/receipt.json')).toBe(false);
  } finally {
    process.chdir(oldCwd);
    if (oldUrl === undefined) delete process.env.HASNA_KNOWLEDGE_DATABASE_URL; else process.env.HASNA_KNOWLEDGE_DATABASE_URL = oldUrl;
    if (oldOwner === undefined) delete process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER; else process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER = oldOwner;
    if (started) await command([pgBin + '/pg_ctl', '-D', data, '-m', 'immediate', 'stop']);
    await rm(temp, { recursive: true, force: true });
  }
}, 120000);


test('reviewed nonce evolution preserves old state and rejects every unreviewed delta on real PostgreSQL', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'knowledge-nonce-integration-'));
  const data = join(temp, 'data');
  const socket = join(temp, 'socket');
  await mkdir(socket, { mode: 0o700 });
  const port = '55440';
  const dbUrl = (name: string) => `postgresql://${process.env.USER}@localhost:${port}/${name}?host=${encodeURIComponent(socket)}&sslmode=disable`;
  const envFor = (name: string) => ({ ...process.env, HASNA_KNOWLEDGE_DATABASE_URL: dbUrl(name), HASNA_KNOWLEDGE_DATABASE_URL_OWNER: dbUrl(name) });
  const dumpEnvironment = { PGHOST: socket, PGPORT: port, PGSSLMODE: 'disable', PGSSLROOTCERT: '' };
  const config = { schema: 'knowledge.database-deploy.v1', source: 'c'.repeat(40), image_digest: 'sha256:' + 'd'.repeat(64),
    bucket: 'fixture-backup', prefix: 'deployment-backups/knowledge/2-1/' + 'c'.repeat(40), legacy_owner_mode: 'disabled',
    migration_policy: 'reviewed-additive-nonce-v1', reviewed_migrations_sha256: reviewedMigrationsSha256 };
  const oldCwd = process.cwd();
  const oldUrl = process.env.HASNA_KNOWLEDGE_DATABASE_URL;
  const oldOwner = process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER;
  const reviewed = buildKnowledgePostgresMigrations().filter((item: any) => /^knowledge_pg_13[2-6]$/.test(item.id));
  const baseline = buildKnowledgePostgresMigrations().filter((item: any) => !reviewed.some((addition: any) => addition.id === item.id));
  let started = false;
  let index = 0;
  async function sql(name: string, statement: string) {
    const db = createKnowledgeDatabaseClient(envFor(name));
    try { return await db.query(statement); } finally { await db.close(); }
  }
  async function clone() {
    const name = 'scenario_' + ++index;
    await sql('postgres', `CREATE DATABASE ${name} TEMPLATE baseline`);
    return name;
  }
  async function phase(name: string, overrides: any = {}, configuration: any = config) {
    process.env.HASNA_KNOWLEDGE_DATABASE_URL = dbUrl(name);
    process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER = dbUrl(name);
    return runDatabasePhase(configuration, { commands, database: createKnowledgeDatabaseClient(envFor(name)),
      s3: new MemoryVersionedS3(), sourceUrl: dbUrl(name), dumpEnvironment, runtimeRole: 'fixture_runtime', ...overrides });
  }
  async function refuseAfterApply(statement: string, expected: string) {
    const name = await clone();
    const s3 = new MemoryVersionedS3();
    await expect(phase(name, { s3, runMigration: async (dry: boolean) => {
      const result = await migration(dry);
      if (!dry) await sql(name, statement);
      return result;
    } })).rejects.toThrow(expected);
    expect(s3.objects.has(config.prefix + '/database.dump')).toBe(true);
    expect(s3.objects.has(config.prefix + '/receipt.json')).toBe(false);
  }
  try {
    await command([pgBin + '/initdb', '-D', data, '--auth=trust', '--no-locale', '--encoding=UTF8']);
    await command([pgBin + '/pg_ctl', '-D', data, '-l', join(temp, 'postgres.log'), '-o', `-F -k ${socket} -p ${port} -c listen_addresses=''`, 'start']);
    started = true;
    process.chdir(packageDir);
    await sql('postgres', 'CREATE ROLE fixture_runtime NOLOGIN');
    await sql('postgres', 'CREATE ROLE fixture_denied NOLOGIN');
    await sql('postgres', 'CREATE DATABASE baseline');
    const seed = createKnowledgeDatabaseClient(envFor('baseline'));
    try {
      await new MigrationLedger(seed, baseline).migrate();
      await seed.query('CREATE SCHEMA integration_extra');
      await seed.query('CREATE TABLE integration_extra.history (revision bigint, body text, provenance jsonb)');
      await seed.query(`INSERT INTO integration_extra.history VALUES (1, 'synthetic original', '{"author":"fixture","source_version":1}')`);
      await seed.query('CREATE TABLE integration_extra.no_primary_key (body text)');
      await seed.query("INSERT INTO integration_extra.no_primary_key VALUES ('same'), ('same'), ('different')");
      await seed.query('CREATE SEQUENCE integration_extra.sequence');
      await seed.query("SELECT nextval('integration_extra.sequence')");
      await seed.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO fixture_runtime');
    } finally { await seed.close(); }
    expect(validateConfig({ KNOWLEDGE_DEPLOY_CONFIG: JSON.stringify(config) })).toEqual(config);
    expect(() => validateConfig({ KNOWLEDGE_DEPLOY_CONFIG: JSON.stringify({ ...config, reviewed_migrations_sha256: '0'.repeat(64) }) })).toThrow('REVIEWED_MIGRATIONS_DIGEST');

    const good = await clone();
    const beforeLedger = (await sql(good, 'SELECT id,checksum,applied_at::text FROM schema_migrations ORDER BY id')).rows;
    const s3 = new MemoryVersionedS3();
    const receipt = await phase(good, { s3 });
    expect(receipt.success).toBe(true);
    expect(receipt.migration.reviewed_migrations_sha256).toBe(reviewedMigrationsSha256);
    expect(receipt.migration.before.pending).toBe(5);
    expect(receipt.migration.before.pending_ids).toEqual(reviewed.map((item: any) => item.id));
    expect(receipt.migration.after.pending).toBe(0);
    expect(receipt.migration.after.pending_ids).toEqual([]);
    expect(receipt.integrity.pre.sha256).not.toBe(receipt.integrity.post.sha256);
    expect(receipt.integrity.proof.existing_domain.pre).toBe(receipt.integrity.proof.existing_domain.post);
    expect(receipt.integrity.proof.ledger.preserved_pre).toBe(receipt.integrity.proof.ledger.preserved_post);
    expect(receipt.integrity.proof.runtime_permissions_verified).toBe(true);
    expect(receipt.integrity.proof.added_migrations.map(({id,checksum}: any) => ({id,checksum}))).toEqual(reviewed.map(({id,checksum}: any) => ({id,checksum})));
    expect(receipt.integrity.proof.added_tables).toHaveLength(1);
    expect(receipt.integrity.proof.added_tables[0].count).toBe(0);
    expect(receipt.integrity.proof.added_functions).toHaveLength(1);
    // The ECS producer and Python deploy consumer must agree on the same real
    // PostgreSQL receipt, including its JSON digests and exact ledger delta.
    const validateReceipt = async (value: unknown) => command(['python3', '-B', '-c', [
      'import json,sys',
      'from deploy import validate_receipt',
      'r=json.load(sys.stdin)',
      "c={'migration_policy':r['migration']['policy'],'reviewed_migrations_sha256':r['migration']['reviewed_migrations_sha256']}",
      "validate_receipt(r,r['source'],r['image_digest'],r['backup']['bucket'],r['backup']['key'].removesuffix('/database.dump'),c)",
      "print('RECEIPT_ACCEPTED')",
    ].join('\n')], {
      cwd: new URL('.', import.meta.url).pathname,
      stdin: Buffer.from(JSON.stringify(value)),
    });
    expect((await validateReceipt(receipt)).trim()).toBe('RECEIPT_ACCEPTED');
    expect((await sql(good, "SELECT id,checksum,applied_at::text FROM schema_migrations WHERE id NOT IN ('knowledge_pg_132','knowledge_pg_133','knowledge_pg_134','knowledge_pg_135','knowledge_pg_136') ORDER BY id")).rows).toEqual(beforeLedger);
    expect((await sql(good, "SELECT tgenabled FROM pg_trigger WHERE tgname='trg_knowledge_private_review_nonce_immutable'")).rows).toEqual([{tgenabled:'A'}]);
    if (process.env.KNOWLEDGE_TEST_RECEIPT_PATH) {
      await writeFile(process.env.KNOWLEDGE_TEST_RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
      await chmod(process.env.KNOWLEDGE_TEST_RECEIPT_PATH, 0o600);
    }
    const repeat = await phase(good);
    expect(repeat.migration.before.pending).toBe(0);
    expect(repeat.migration.after.pending).toBe(0);
    expect(repeat.integrity.pre).toEqual(repeat.integrity.post);
    expect(repeat.integrity.proof.exact_reviewed_additions).toBe(false);
    expect(repeat.integrity.proof.added_migrations).toEqual([]);
    expect((await validateReceipt(repeat)).trim()).toBe('RECEIPT_ACCEPTED');
    const corruptReceipt = structuredClone(receipt);
    corruptReceipt.integrity.post.tables[0].count += 1;
    await expect(validateReceipt(corruptReceipt)).rejects.toThrow('RECEIPT_SNAPSHOT_DIGEST');
    const archive = join(temp, 'baseline.dump');
    await Bun.write(archive, s3.objects.get(config.prefix + '/database.dump')!);
    await command([pgBin + '/createdb', 'restored'], { env: { ...process.env, ...dumpEnvironment } });
    await command(['pg_restore', '--exit-on-error', '--dbname=restored', archive], { env: { ...process.env, ...dumpEnvironment } });
    expect((await sql('restored', "SELECT to_regclass('public.knowledge_private_review_nonce_consumptions') AS nonce")).rows).toEqual([{nonce:null}]);
    expect((await sql('restored', 'SELECT id,checksum,applied_at::text FROM schema_migrations ORDER BY id')).rows).toEqual(beforeLedger);
    expect((await sql('restored', 'SELECT body,provenance FROM integration_extra.history')).rows).toEqual([{body:'synthetic original',provenance:{author:'fixture',source_version:1}}]);

    for (const [statement, expected] of [
      ["DELETE FROM schema_migrations WHERE id='knowledge_pg_131'", 'REVIEWED_PENDING_SET_MISMATCH'],
      ["UPDATE schema_migrations SET checksum='sha256:' || repeat('0',64) WHERE id='knowledge_pg_131'", 'LEDGER_CHECKSUM_OR_UNKNOWN_MIGRATION'],
    ]) {
      const name = await clone(); await sql(name, statement);
      let calls = 0; const refused = new MemoryVersionedS3();
      await expect(phase(name, {s3:refused,runMigration:async (dry:boolean)=>{calls++;return migration(dry);}})).rejects.toThrow(expected);
      expect(calls).toBe(0);expect(refused.objects.has(config.prefix+'/database.dump')).toBe(true);expect(refused.objects.has(config.prefix+'/receipt.json')).toBe(false);
    }
    const partial = await clone();
    const partialDb = createKnowledgeDatabaseClient(envFor(partial));
    try { await new MigrationLedger(partialDb, [...baseline, reviewed[0]]).migrate(); } finally { await partialDb.close(); }
    await expect(phase(partial)).rejects.toThrow('REVIEWED_PENDING_SET_MISMATCH');
    await expect(phase(await clone(), {}, {...config,migration_policy:'no-pending-migrations'})).rejects.toThrow('PENDING_MIGRATIONS_REQUIRE_REVIEWED_EVOLUTION');
    let deniedCalls = 0;
    const denied = await clone();
    await expect(phase(denied, { runtimeRole: 'fixture_denied', runMigration: async (dry:boolean)=>{deniedCalls++;return migration(dry);} })).rejects.toThrow('RUNTIME_DEFAULT_PRIVILEGES_REQUIRED');
    expect(deniedCalls).toBe(0);
    expect((await sql(denied, "SELECT to_regclass('public.knowledge_private_review_nonce_consumptions') AS nonce")).rows).toEqual([{nonce:null}]);

    await refuseAfterApply("UPDATE integration_extra.history SET body='synthetic drift'", 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    await refuseAfterApply("UPDATE schema_migrations SET applied_at=applied_at+interval '1 second' WHERE id='knowledge_pg_131'", 'EXISTING_LEDGER_INTEGRITY_MISMATCH');
    await refuseAfterApply('CREATE TABLE integration_extra.unexpected (id text)', 'UNEXPECTED_TABLE_DELTA');
    await refuseAfterApply("INSERT INTO knowledge_private_review_nonce_consumptions VALUES (repeat('a',64),repeat('b',64),'fixture','fcame1_'||repeat('c',64),'fixture-time')", 'REVIEWED_TABLE_NOT_EMPTY');
    await refuseAfterApply('ALTER TABLE knowledge_private_review_nonce_consumptions DISABLE TRIGGER trg_knowledge_private_review_nonce_immutable', 'REVIEWED_TABLE_SHAPE_MISMATCH');
    await refuseAfterApply("CREATE OR REPLACE FUNCTION knowledge_private_review_nonce_immutable() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END'", 'REVIEWED_FUNCTION_SHAPE_MISMATCH');
    await refuseAfterApply('ALTER TABLE integration_extra.history ADD COLUMN surprise text', 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    await refuseAfterApply("SELECT nextval('integration_extra.sequence')", 'COMPLETE_DOMAIN_INTEGRITY_MISMATCH');
    await refuseAfterApply("DELETE FROM schema_migrations WHERE id='knowledge_pg_136'", 'MIGRATION_PLAN_MISMATCH');
    await refuseAfterApply("UPDATE schema_migrations SET applied_at='infinity' WHERE id='knowledge_pg_136'", 'REVIEWED_LEDGER_DELTA_MISMATCH');
    await refuseAfterApply('REVOKE INSERT ON knowledge_private_review_nonce_consumptions FROM fixture_runtime', 'RUNTIME_TABLE_PRIVILEGES_REQUIRED');
  } finally {
    process.chdir(oldCwd);
    if (oldUrl === undefined) delete process.env.HASNA_KNOWLEDGE_DATABASE_URL; else process.env.HASNA_KNOWLEDGE_DATABASE_URL = oldUrl;
    if (oldOwner === undefined) delete process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER; else process.env.HASNA_KNOWLEDGE_DATABASE_URL_OWNER = oldOwner;
    if (started) await command([pgBin + '/pg_ctl', '-D', data, '-m', 'immediate', 'stop']);
    await rm(temp, {recursive:true,force:true});
  }
}, 240000);
