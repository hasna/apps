import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sourceRoot from '../src/index.ts';
import * as builtRoot from '../dist/index.js';
import * as sourceStorage from '../src/storage.ts';
import * as builtStorage from '../dist/storage.js';
import * as sourceServe from '../src/serve.ts';
import * as builtServe from '../dist/serve.js';

type RootSurface = Record<string, any>;

async function expectTypedContainment(
  operation: () => unknown | Promise<unknown>,
  codes: readonly string[] = ['KNOWLEDGE_HOSTED_CONTAINED'],
): Promise<void> {
  try {
    await operation();
    throw new Error('expected typed Stage-A containment');
  } catch (error) {
    expect(error).toMatchObject({ name: 'KnowledgeContainmentError', status: 503 });
    expect(codes).toContain((error as { code?: string }).code);
  }
}

function tripwireProxy(label: string, reads: { count: number }): Record<string, unknown> {
  return new Proxy({
    HASNA_KNOWLEDGE_AUTH_PATH: `/proc/knowledge-stage-a/${label}/auth.json`,
  }, {
    get() {
      reads.count += 1;
      throw new Error(`${label} getter tripwire`);
    },
    ownKeys() {
      reads.count += 1;
      throw new Error(`${label} ownKeys tripwire`);
    },
    getOwnPropertyDescriptor() {
      reads.count += 1;
      throw new Error(`${label} descriptor tripwire`);
    },
  });
}

describe('Stage-A public facade regressions', () => {
  for (const [surfaceName, root] of [
    ['source', sourceRoot],
    ['dist', builtRoot],
  ] as const) {
    test(`${surfaceName} root auth wrappers deny before reading payload or env proxies`, async () => {
      const operations: Array<(payload: any, env: any) => unknown> = [
        (_payload, env) => root.getKnowledgeAuth(env),
        (payload, env) => root.saveKnowledgeAuth(payload, env),
        (_payload, env) => root.clearKnowledgeAuth(env),
        (_payload, env) => root.getKnowledgeApiKey(env),
        (payload, env) => root.knowledgeAuthStatus(payload, env),
      ];

      for (const [index, operation] of operations.entries()) {
        const reads = { count: 0 };
        const payload = tripwireProxy(`${surfaceName}-auth-payload-${index}`, reads);
        const env = tripwireProxy(`${surfaceName}-auth-env-${index}`, reads);
        await expectTypedContainment(() => operation(payload, env));
        expect(reads.count).toBe(0);
      }
    });

    test(`${surfaceName} generic public entrypoints check ambient hosted intent before hostile arguments`, async () => {
      process.env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
      const calls: Array<(proxy: any) => unknown> = [
        (proxy) => root.ingestOpenFilesManifest(proxy),
        (proxy) => root.createArtifactStore(proxy, proxy),
        (proxy) => root.createKnowledgeService(proxy),
        (proxy) => root.createKnowledgeClient(proxy),
        (proxy) => root.createAppWikiScope(proxy),
        (proxy) => root.createKnowledgeProjectPanel('synthetic-project', proxy),
      ];
      try {
        for (const [index, call] of calls.entries()) {
          const reads = { count: 0 };
          const proxy = tripwireProxy(`${surfaceName}-ambient-${index}`, reads);
          await expectTypedContainment(() => call(proxy));
          expect(reads.count).toBe(0);
        }
      } finally {
        delete process.env.HASNA_KNOWLEDGE_STORAGE_MODE;
      }
    });

    test(`${surfaceName} hostile supplied getters become typed containment`, async () => {
      const hostile = new Proxy({ config: { mode: 'local' } }, {
        get() {
          throw new Error('supplied options getter tripwire');
        },
      });
      await expectTypedContainment(
        () => root.ingestOpenFilesManifest(hostile as any),
        ['KNOWLEDGE_RUNTIME_INTENT_INVALID', 'KNOWLEDGE_CONFIG_INVALID'],
      );
    });

    test(`${surfaceName} central classifier rejects nested S3 across ingest, search, context, and project surfaces`, async () => {
      const callFactories: Array<(options: any) => unknown> = [
        (options) => root.ingestOpenFilesManifest(options),
        (options) => root.ingestOpenFilesManifestItems(options),
        (options) => root.ingestSourceRef(options),
        (options) => root.importRulesProvenance(options),
        (options) => root.resolveOpenFilesSource(options),
        (options) => root.hybridSearch(options),
        (options) => root.searchVectorIndex(options),
        (options) => root.retrieveKnowledgeContext(options),
        (options) => root.buildKnowledgeAgentContextPack(options),
        (options) => root.createKnowledgeService(options),
        (options) => root.createKnowledgeClient(options),
        (options) => root.createAppWikiScope(options),
        (options) => root.createKnowledgeProjectPanel('synthetic-project', options),
      ];

      for (const [index, call] of callFactories.entries()) {
        const fixture = mkdtempSync(join(tmpdir(), `knowledge-${surfaceName}-nested-s3-${index}-`));
        const config = root.defaultKnowledgeConfig();
        config.storage = {
          type: 's3',
          artifacts_root: 'artifacts',
          s3: { bucket: 'synthetic-stage-a-bucket' },
        };
        const options = {
          config,
          cwd: fixture,
          scope: 'project',
          dbPath: join(fixture, '.hasna', 'knowledge', 'knowledge.db'),
          workspaceHome: join(fixture, '.hasna', 'knowledge'),
          input: join(fixture, 'synthetic-manifest.json'),
          query: 'synthetic',
          sourceRef: 'open-files://file/synthetic',
          env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' },
        };
        try {
          await expectTypedContainment(
            () => call(options),
            ['KNOWLEDGE_HOSTED_CONTAINED', 'KNOWLEDGE_RUNTIME_INTENT_INVALID'],
          );
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    });

    test(`${surfaceName} service denies URI-bearing ingestion before creating a workspace`, async () => {
      const operations: Array<(service: any) => unknown> = [
        (service) => service.ingestManifest('https://invalid.test/manifest.json'),
        (service) => service.ingestSource('open-files://file/stored-source'),
        (service) => service.consumeOutbox('s3://synthetic-bucket/outbox.jsonl'),
        (service) => service.addAppWikiSourceRef({
          sourceRef: 'https://invalid.test/source',
          purpose: 'knowledge_index',
        }),
      ];

      for (const [index, operation] of operations.entries()) {
        const fixture = mkdtempSync(join(tmpdir(), `knowledge-${surfaceName}-service-source-${index}-`));
        try {
          const service = root.createKnowledgeService({
            scope: 'project',
            cwd: fixture,
            env: {},
          } as never);
          await expectTypedContainment(() => operation(service));
          expect(existsSync(join(fixture, '.hasna'))).toBe(false);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    });

    test(`${surfaceName} root source wrappers classify before database or workspace access`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-${surfaceName}-root-source-`));
      try {
        await expectTypedContainment(() => root.resolveOpenFilesSource({
          dbPath: join(fixture, '.hasna', 'knowledge', 'knowledge.db'),
          sourceRef: 'https://invalid.test/source',
        }));
        await expectTypedContainment(() => root.ingestAppWikiSourceRef({
          scope: 'project',
          workspace: {
            home: join(fixture, '.hasna', 'knowledge'),
            knowledgeDbPath: join(fixture, '.hasna', 'knowledge', 'knowledge.db'),
          } as any,
          sourceRef: 's3://synthetic-bucket/source',
        }));
        expect(existsSync(join(fixture, '.hasna'))).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('raw storage DSN compatibility names are fixed zero-read stubs', () => {
    const env = { HASNA_KNOWLEDGE_DATABASE_URL: 'synthetic-presence-value' };
    const sourceRootDatabaseUrl = sourceRoot.getStorageDatabaseUrl as unknown as (env: unknown) => string | null;
    const builtRootDatabaseUrl = builtRoot.getStorageDatabaseUrl as unknown as (env: unknown) => string | null;
    const sourceStorageDatabaseUrl = sourceStorage.getStorageDatabaseUrl as unknown as (env: unknown) => string | null;
    const builtStorageDatabaseUrl = builtStorage.getStorageDatabaseUrl as unknown as (env: unknown) => string | null;
    for (const value of [
      sourceRootDatabaseUrl(env),
      builtRootDatabaseUrl(env),
      sourceStorageDatabaseUrl(env),
      builtStorageDatabaseUrl(env),
      sourceStorage.resolveDatabaseUrl('knowledge', env),
      builtStorage.resolveDatabaseUrl('knowledge', env),
    ]) {
      expect(value).toBeNull();
    }
    expect(sourceServe.normalizeCloudDatabaseUrl(env)).toBeUndefined();
    expect(builtServe.normalizeCloudDatabaseUrl(env)).toBeUndefined();
    expect(readFileSync(join(import.meta.dir, '..', 'dist', 'index.d.ts'), 'utf8'))
      .toContain('getStorageDatabaseUrl');
    expect(readFileSync(join(import.meta.dir, '..', 'dist', 'storage.d.ts'), 'utf8'))
      .toContain('getStorageDatabaseUrl');
  });

  test('remote-host file URIs are contained as remote authority', async () => {
    for (const root of [sourceRoot, builtRoot]) {
      await expectTypedContainment(
        () => root.ingestSourceRef({
          dbPath: '/synthetic/knowledge.db',
          sourceRef: 'file://remote.invalid/document.txt',
        }),
      );
    }
  });
});
