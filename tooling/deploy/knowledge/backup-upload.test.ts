import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupUploadInput, sendBackupCommand, databaseFailureMetadata } from './database-phase.mjs';

const require = createRequire(new URL('../../../apps/knowledge/package.json', import.meta.url));
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const config = { bucket: 'fixture', prefix: 'fixture-backup', source: 'a'.repeat(40) };

test('actual Bun S3 upload preserves fixed length and full SHA256 over an independent Node receiver', async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-backup-wire-'));
  const server = Bun.spawn(['node', new URL('./fixtures/s3-wire-server.mjs', import.meta.url).pathname],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  const reader = server.stdout.getReader();
  let buffer = '';
  async function line() {
    while (!buffer.includes('\n')) {
      const value = await reader.read();
      if (value.done) throw new Error('FIXTURE_RECEIVER_EARLY_END');
      buffer += new TextDecoder().decode(value.value);
    }
    const end = buffer.indexOf('\n');
    const result = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    return result;
  }
  const ready = await line();
  expect(ready.runtime).toBe('node');
  const client = new S3Client({ region: 'us-east-1', endpoint: `http://127.0.0.1:${ready.port}`,
    forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: 'fixture', secretAccessKey: 'fixture' },
    logger: { warn() {}, error() {}, info() {}, debug() {} } });
  try {
    // Include small/single-chunk and multi-chunk bodies; the original Bun path
    // truncated the latter before its CRC32 trailer. No production credentials.
    for (const size of [4096, 65536, 200000, 1048897, 8388931]) {
      const body = Buffer.alloc(size, 65);
      const hash = createHash('sha256').update(body).digest('hex');
      const path = join(root, 'archive');
      await writeFile(path, body, { mode: 0o600 });
      const result = await sendBackupCommand(client, new PutObjectCommand(backupUploadInput(config, path,
        { bytes: size, sha256: hash })), 'upload');
      expect(result.VersionId).toBe('fixture-version');
      expect(await line()).toEqual({ valid: true, bytes: size, sha256: hash });
    }
    // A deliberately wrong checksum proves the receiver rejects corruption.
    const path = join(root, 'archive');
    await writeFile(path, Buffer.from('fixture'), { mode: 0o600 });
    const input = backupUploadInput(config, path, { bytes: 7, sha256: '0'.repeat(64) });
    await expect(sendBackupCommand(client, new PutObjectCommand(input), 'upload')).rejects.toThrow('KNOWLEDGE_BACKUP_OPERATION_REFUSED');
    expect((await line()).valid).toBe(false);
  } finally {
    client.destroy();
    server.stdin.end();
    const error = await new Response(server.stderr).text();
    expect(await server.exited).toBe(0);
    expect(error).toBe('');
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test('backup error metadata never renders message, headers, body or arbitrary code', async () => {
  const cause: any = new Error('PRIVATE_DIAGNOSTIC_SENTINEL');
  cause.name = 'AccessDenied';
  cause.$metadata = { httpStatusCode: 403, requestId: 'PRIVATE_DIAGNOSTIC_SENTINEL' };
  cause.$response = { body: 'PRIVATE_DIAGNOSTIC_SENTINEL' };
  for (const phase of ['versioning', 'upload', 'readback', 'receipt']) {
    try { await sendBackupCommand({ send: async () => { throw cause; } }, {}, phase); throw new Error('FIXTURE_EXPECTED_REFUSAL'); }
    catch (error) {
      expect(databaseFailureMetadata(error)).toEqual({ phase, code: 'AccessDenied', http_status: 403 });
      expect(JSON.stringify(databaseFailureMetadata(error))).not.toContain('PRIVATE_DIAGNOSTIC_SENTINEL');
    }
  }
  cause.name = 'PRIVATE_DIAGNOSTIC_SENTINEL';
  cause.$metadata.httpStatusCode = 'PRIVATE_DIAGNOSTIC_SENTINEL';
  try { await sendBackupCommand({ send: async () => { throw cause; } }, {}, 'upload'); }
  catch (error) { expect(databaseFailureMetadata(error)).toEqual({ phase: 'upload', code: 'UNCLASSIFIED', http_status: null }); }
  expect(databaseFailureMetadata(cause)).toEqual({ phase: 'unclassified', code: 'UNCLASSIFIED' });
});
