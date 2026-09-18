import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createKnowledgeDatabaseClient } from '../../../apps/knowledge/dist/serve.js';
import { runDatabasePhase, migration } from './database-phase.mjs';

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
