import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sourceRoot from '../src/index.ts';
import * as sourceStorage from '../src/storage.ts';
import * as builtRoot from '../dist/index.js';
import * as builtStorage from '../dist/storage.js';

const ROOT_COMPATIBILITY_NAMES = [
  'KnowledgeApiClient',
  'RemoteKnowledgeClient',
  'S3ArtifactStore',
  'createAiSdkProviderRegistry',
  'getStoragePg',
  'languageModelFor',
  'runStorageMigrations',
] as const;

const STORAGE_COMPATIBILITY_NAMES = [
  'PG_MIGRATIONS',
  'PgAdapterAsync',
  'createCloudPoolFromEnv',
  'createKnowledgeCloudClient',
  'createPgPool',
  'createQueryClient',
  'getStoragePg',
  'runStorageMigrations',
] as const;

async function expectBuiltContainment(run: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await run();
    throw new Error('expected built compatibility containment');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'KnowledgeContainmentError',
      code: 'KNOWLEDGE_HOSTED_CONTAINED',
      status: 503,
    });
  }
}

describe('rebuilt public package boundaries', () => {
  test('built config and artifact exports reject supplied hosted mode with local or absent persisted config', async () => {
    for (const persistedMode of ['local', 'absent'] as const) {
      for (const operation of ['writeKnowledgeConfig', 'createArtifactStore'] as const) {
        const root = mkdtempSync(join(tmpdir(), 'knowledge-built-supplied-hosted-'));
        const workspace = builtRoot.workspaceForHome(join(root, '.hasna', 'knowledge'));
        const hostedConfig = { ...builtRoot.defaultKnowledgeConfig(), mode: 'hosted' as const };
        const localConfigText = `${JSON.stringify(builtRoot.defaultKnowledgeConfig())}\n`;
        try {
          if (persistedMode === 'local') {
            mkdirSync(workspace.home, { recursive: true });
            writeFileSync(workspace.configPath, localConfigText);
          }

          await expectBuiltContainment(() => operation === 'writeKnowledgeConfig'
            ? builtRoot.writeKnowledgeConfig(workspace.configPath, hostedConfig)
            : builtRoot.createArtifactStore(hostedConfig, workspace));

          expect(existsSync(workspace.artifactsDir)).toBe(false);
          if (persistedMode === 'local') {
            expect(readFileSync(workspace.configPath, 'utf8')).toBe(localConfigText);
          } else {
            expect(existsSync(workspace.configPath)).toBe(false);
            expect(existsSync(workspace.home)).toBe(false);
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  });

  test('source and dist expose the same restored compatibility names', () => {
    for (const name of ROOT_COMPATIBILITY_NAMES) {
      expect(name in sourceRoot, `source root ${name}`).toBe(true);
      expect(name in builtRoot, `dist root ${name}`).toBe(true);
    }
    for (const name of STORAGE_COMPATIBILITY_NAMES) {
      expect(name in sourceStorage, `source storage ${name}`).toBe(true);
      expect(name in builtStorage, `dist storage ${name}`).toBe(true);
    }
  });

  test('built root named imports fail before inspecting remote arguments', async () => {
    const root = builtRoot as Record<string, any>;
    let calls = 0;
    const hostile = new Proxy({}, { get() { calls += 1; throw new Error('argument inspected'); } });

    await expectBuiltContainment(() => new root.KnowledgeApiClient(hostile));
    await expectBuiltContainment(() => new root.RemoteKnowledgeClient('synthetic', 'https://invalid.test'));
    await expectBuiltContainment(() => new root.S3ArtifactStore(hostile));
    await expectBuiltContainment(() => root.createAiSdkProviderRegistry(hostile));
    await expectBuiltContainment(() => root.languageModelFor('synthetic:model', hostile));
    await expectBuiltContainment(() => root.getStoragePg());
    await expectBuiltContainment(() => root.runStorageMigrations(hostile));
    expect(calls).toBe(0);
  });

  test('built long-lived local artifact stores retain mutable env and config revocation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'knowledge-built-artifact-revocation-'));
    const env: Record<string, string | undefined> = {
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
    };
    const service = builtRoot.createKnowledgeService({ scope: 'project', cwd, env } as never);
    service.setup({ mode: 'local' });
    const store = service.artifactStore();
    const artifactsDir = service.workspace.artifactsDir;
    await store.put({ key: 'stable.txt', body: 'unchanged' });

    env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
    for (const operation of [
      () => store.put({ key: 'blocked.txt', body: 'blocked' }),
      () => store.getText('stable.txt'),
    ]) {
      await expectBuiltContainment(operation);
    }
    expect(readFileSync(join(artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
    expect(existsSync(join(artifactsDir, 'blocked.txt'))).toBe(false);
  });

  test('built declarations keep the internal operator brand private', () => {
    const declaration = readFileSync(join(import.meta.dir, '..', 'dist', 'storage.d.ts'), 'utf8');
    const syncDeclaration = readFileSync(
      join(import.meta.dir, '..', 'dist', 'db', 'storage-sync.d.ts'),
      'utf8',
    );
    expect(declaration).not.toContain('KnowledgeOperatorCapability');
    expect(declaration).not.toMatch(/\bcapability\??\s*:/);
    expect(syncDeclaration).toContain('interface StorageSyncOptions');
    expect(existsSync(join(import.meta.dir, '..', 'dist', 'knowledge-db.d.ts'))).toBe(true);
    expect(readFileSync(join(import.meta.dir, '..', 'dist', 'sync.d.ts'), 'utf8'))
      .not.toContain("from './knowledge-db'");
  });

  test('operator capability factory remains absent from rebuilt exports', () => {
    for (const surface of [builtRoot, builtStorage]) {
      expect('createKnowledgeOperatorCapability' in surface).toBe(false);
      expect('assertKnowledgeOperatorRuntime' in surface).toBe(false);
    }
  });
});
