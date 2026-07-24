import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getSyncMetaAll,
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
  type StorageRemoteAdapter,
} from '../src/storage.ts';

function tripwireRemote() {
  let calls = 0;
  const fail = () => {
    calls += 1;
    throw new Error('remote datastore tripwire');
  };
  const remote = {
    run: async () => fail() as never,
    all: async () => fail() as never,
    get: async () => fail() as never,
    close: async () => fail() as never,
  } as unknown as StorageRemoteAdapter;
  return { remote, calls: () => calls };
}

const publicStorageTripwire = new URL('./fixtures/storage-public-tripwire.ts', import.meta.url).pathname;

describe('storage and migration containment', () => {
  test('public executor and ledger compatibility surfaces make zero calls in default-local and hosted env', async () => {
    for (const mode of ['no-signal-local', 'hosted'] as const) {
      const env = mode === 'hosted'
        ? { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' }
        : {};
      const result = spawnSync(process.execPath, [publicStorageTripwire], {
        cwd: new URL('..', import.meta.url).pathname,
        env,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const evidence = JSON.parse(result.stdout) as {
        calls: { executor: number; directLedger: number; factoryLedger: number };
        errors: Array<{ code: string; status: number }>;
      };
      expect(evidence.calls).toEqual({ executor: 0, directLedger: 0, factoryLedger: 0 });
      expect(evidence.errors).toHaveLength(7);
      expect(evidence.errors.every(({ code, status }) => (
        code === 'KNOWLEDGE_HOSTED_CONTAINED' && status === 503
      ))).toBe(true);
    }
  });

  for (const [name, operation] of [
    ['push', storagePush],
    ['pull', storagePull],
    ['sync', storageSync],
  ] as const) {
    test(`${name} requires the internal branded operator capability before local or remote I/O`, async () => {
      const cwd = mkdtempSync(join(tmpdir(), `knowledge-storage-${name}-`));
      const tripwire = tripwireRemote();
      await expect(operation({ scope: 'project', cwd, remote: tripwire.remote }))
      .rejects.toThrow('KNOWLEDGE_HOSTED_CONTAINED');
      expect(tripwire.calls()).toBe(0);
      expect(existsSync(join(cwd, '.hasna'))).toBe(false);
    });
  }

  test('status and sync metadata are fixed redacted zero-I/O stubs', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-storage-status-local-'));
    let reads = 0;
    const hostile = new Proxy({}, {
      get() { reads += 1; throw new Error('storage options getter tripwire'); },
      ownKeys() { reads += 1; throw new Error('storage options enumeration tripwire'); },
    });
    const status = getStorageStatus(hostile);
    const sync = getSyncMetaAll(hostile);
    expect(reads).toBe(0);
    expect(status.mode).toBe('local');
    expect(status.configured).toBe(false);
    expect(status.activeEnv).toBeNull();
    expect(status.scope).toBe('contained');
    expect(status.databasePath).toBe('[contained-zero-io]');
    expect(status.sync).toEqual([]);
    expect(sync).toEqual([]);
    expect(existsSync(join(cwd, '.hasna'))).toBe(false);
  });
});
