import { describe, expect, test } from 'bun:test';
import {
  KIT_VERSION,
  MigrationLedger,
  createQueryClient,
  defineMigration,
  wrapExecutor,
} from '../src/generated/storage-kit/index';
import { KnowledgeContainmentError } from '../src/runtime-role';

function hostile(reads: { count: number }): object {
  return new Proxy({}, {
    get() { reads.count += 1; throw new Error('query getter tripwire'); },
    ownKeys() { reads.count += 1; throw new Error('query enumeration tripwire'); },
  });
}

async function expectContained(operation: () => unknown): Promise<void> {
  try {
    await Promise.resolve().then(operation);
    throw new Error('expected storage-kit containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect(error).toMatchObject({ code: 'KNOWLEDGE_HOSTED_CONTAINED', status: 503 });
  }
}

describe('generated storage kit Stage-A compatibility', () => {
  test('preserves base version and type constructors without runtime SQL retention', () => {
    expect(KIT_VERSION).toBe('0.4.0');
    const marker = 'synthetic-sql-marker';
    const migration = defineMigration('synthetic-id', marker);
    expect(JSON.stringify(migration)).not.toContain(marker);
  });

  test('query wrappers contain before executor or pool inspection', async () => {
    for (const operation of [wrapExecutor, createQueryClient]) {
      const reads = { count: 0 };
      await expectContained(() => operation(hostile(reads) as never));
      expect(reads.count).toBe(0);
    }
  });

  test('migration ledger preserves inert base descriptors and zero-client calls', async () => {
    const reads = { count: 0 };
    const ledger = new MigrationLedger(hostile(reads) as never, hostile(reads) as never);
    expect(reads.count).toBe(0);
    expect(Object.getOwnPropertyNames(ledger).sort()).toEqual(['client', 'ledgerTable', 'migrations']);
    for (const key of Object.getOwnPropertyNames(ledger)) {
      expect(Object.getOwnPropertyDescriptor(ledger, key)).toMatchObject({
        value: undefined,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    await expectContained(() => ledger.ensureLedger());
    await expectContained(() => ledger.listApplied());
    await expectContained(() => ledger.migrate());
    expect(reads.count).toBe(0);
  });
});
