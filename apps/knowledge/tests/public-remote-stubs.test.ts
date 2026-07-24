import { describe, expect, test } from 'bun:test';
import * as rootModule from '../src/index.ts';
import * as storageModule from '../src/storage.ts';

type RuntimeModule = Record<string, any>;

async function expectContained(run: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await run();
    throw new Error('expected contained compatibility boundary');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'KnowledgeContainmentError',
      code: 'KNOWLEDGE_HOSTED_CONTAINED',
      status: 503,
      role: 'hosted-client',
      surface: 'public-api',
    });
  }
}

function hostileObject(calls: { value: number }): Record<string, unknown> {
  return new Proxy({}, {
    get() {
      calls.value += 1;
      throw new Error('caller-supplied object was inspected');
    },
    ownKeys() {
      calls.value += 1;
      throw new Error('caller-supplied object was enumerated');
    },
  });
}

describe('public remote compatibility stubs', () => {
  test('root constructors and provider factories are typed containment with zero argument inspection', async () => {
    const root = rootModule as RuntimeModule;
    const calls = { value: 0 };
    const hostile = hostileObject(calls);

    await expectContained(() => new root.KnowledgeApiClient(hostile));
    await expectContained(() => new root.RemoteKnowledgeClient('synthetic', 'https://invalid.test'));
    await expectContained(() => new root.S3ArtifactStore(hostile));
    await expectContained(() => root.createAiSdkProviderRegistry(hostile));
    await expectContained(() => root.languageModelFor('synthetic:model', hostile));
    expect(calls.value).toBe(0);
  });

  test('storage constructors and migration entrypoints never touch remote arguments', async () => {
    const storage = storageModule as RuntimeModule;
    const calls = { value: 0 };
    const hostile = hostileObject(calls);

    await expectContained(() => new storage.PgAdapterAsync('postgres://synthetic.invalid/knowledge'));
    await expectContained(() => storage.createCloudPoolFromEnv('knowledge', hostile));
    await expectContained(() => storage.createKnowledgeCloudClient());
    await expectContained(() => storage.createPgPool(hostile));
    await expectContained(() => storage.createQueryClient(hostile));
    await expectContained(() => storage.getStoragePg());
    await expectContained(() => storage.runStorageMigrations(hostile));

    expect(calls.value).toBe(0);
    expect(Array.isArray(storage.PG_MIGRATIONS)).toBe(true);
    expect(storage.PG_MIGRATIONS).toHaveLength(0);
  });
});
