import { describe, expect, test } from 'bun:test';
import {
  KIT_VERSION,
  MigrationLedger,
  checkHealth,
  checkReady,
  createCloudPoolFromEnv,
  createMigrationLedger,
  createPgPool,
  createQueryClient,
  defineMigration,
  getStorageDatabaseUrl,
  normalizeCloudStorageMode,
  resolveDatabaseUrl,
  resolveStorageMode,
  resolveTlsConfig,
  storageEnvKeys,
  wrapExecutor,
  type TypedQueryClient,
} from '../src/storage';
import { KnowledgeContainmentError } from '../src/runtime-role';

async function expectPublicStorageContained(operation: () => unknown): Promise<void> {
  try {
    await Promise.resolve().then(operation);
    throw new Error('expected public storage containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect((error as KnowledgeContainmentError).status).toBe(503);
    expect((error as KnowledgeContainmentError).code).toBe('KNOWLEDGE_HOSTED_CONTAINED');
  }
}

function hostile(reads: { count: number }): object {
  return new Proxy({}, {
    get() {
      reads.count += 1;
      throw new Error('storage argument getter tripwire');
    },
    ownKeys() {
      reads.count += 1;
      throw new Error('storage argument enumeration tripwire');
    },
  });
}

describe('public cloud storage compatibility surface', () => {
  test('exposes the exact base kit version and no runtime migration SQL', () => {
    expect(KIT_VERSION).toBe('0.4.0');
    const migration = defineMigration('synthetic-id', 'synthetic-sql-sentinel');
    expect(migration as unknown).toEqual({});
    expect(JSON.stringify(migration)).not.toContain('synthetic-sql-sentinel');
  });

  test('executor wrapper itself is a zero-I/O containment stub', async () => {
    const reads = { count: 0 };
    await expectPublicStorageContained(() => wrapExecutor(hostile(reads) as never));
    expect(reads.count).toBe(0);
  });

  test('migration ledger retains every base method but never touches its inputs', async () => {
    const reads = { count: 0 };
    const client = hostile(reads) as TypedQueryClient;
    const migration = defineMigration('synthetic-id', 'synthetic-sql-sentinel');
    for (const ledger of [
      new MigrationLedger(client, [migration]),
      createMigrationLedger(client, [migration]),
    ]) {
      const internals = ledger as unknown as {
        readApplied(): Promise<unknown>;
        buildPlan(input: unknown): unknown;
        applyPendingMigration(input: unknown): Promise<unknown>;
      };
      for (const operation of [
        () => ledger.ensureLedger(),
        () => internals.readApplied(),
        () => ledger.listApplied(),
        () => internals.buildPlan([]),
        () => internals.applyPendingMigration(migration),
        () => ledger.migrate(),
      ]) await expectPublicStorageContained(operation);
    }
    expect(reads.count).toBe(0);
  });

  test('capability helper names fail before hostile argument inspection', async () => {
    for (const helper of [
      storageEnvKeys,
      resolveStorageMode,
      resolveTlsConfig,
      normalizeCloudStorageMode,
      createPgPool,
      createCloudPoolFromEnv,
      createQueryClient,
      checkHealth,
    ] as Array<(value: never) => unknown>) {
      const reads = { count: 0 };
      await expectPublicStorageContained(() => helper(hostile(reads) as never));
      expect(reads.count).toBe(0);
    }
    const reads = { count: 0 };
    await expectPublicStorageContained(() => checkReady(
      hostile(reads) as never,
      hostile(reads) as never,
    ));
    expect(reads.count).toBe(0);
  });

  test('DSN helpers are fixed zero-read containment metadata stubs', () => {
    const env = { HASNA_KNOWLEDGE_DATABASE_URL: 'synthetic-presence-value' };
    expect((getStorageDatabaseUrl as unknown as (env: unknown) => string | null)(env)).toBeNull();
    expect(resolveDatabaseUrl('knowledge', env)).toBeNull();
    expect((getStorageDatabaseUrl as unknown as (env: unknown) => string | null)({})).toBeNull();
    expect(resolveDatabaseUrl('knowledge', {})).toBeNull();
    let reads = 0;
    const hostileEnv = new Proxy({}, {
      get() { reads += 1; throw new Error('env get tripwire'); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error('env descriptor tripwire'); },
      getPrototypeOf() { reads += 1; throw new Error('env prototype tripwire'); },
    });
    expect((getStorageDatabaseUrl as unknown as (env: unknown) => string | null)(hostileEnv)).toBeNull();
    expect(resolveDatabaseUrl('knowledge', hostileEnv)).toBeNull();
    expect(reads).toBe(0);
  });
});
