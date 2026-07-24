import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalArtifactStore,
  buildKnowledgeAgentContextPack,
  compileWikiPage,
  createArtifactStore,
  createKnowledgeSyncBundle,
  createKnowledgeSyncSnapshot,
  defaultKnowledgeConfig,
  embeddingIndexStatus,
  ensureKnowledgeWorkspace,
  getKnowledgeSyncStatus,
  hybridSearch,
  ingestOpenFilesManifest,
  lintWiki,
  listAppWikiNotes,
  listKnowledgeMachines,
  listKnowledgeSyncConflicts,
  providerCredentialStatus,
  providerStatus,
  readKnowledgeConfig,
  reindexHealth,
  resolveOpenFilesSource,
  resolveStorageContract,
  retrieveKnowledgeContext,
  syncArtifactsFromSnapshot,
  syncTablesFromSnapshot,
  workspaceForHome,
  writeKnowledgeConfig,
  type ArtifactStore,
} from '../src/index.ts';
import { KnowledgeContainmentError } from '../src/runtime-role.ts';

async function expectContained(operation: () => unknown): Promise<void> {
  try {
    await Promise.resolve().then(operation);
    throw new Error('expected containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect((error as KnowledgeContainmentError).status).toBe(503);
  }
}

describe('root local API two-phase containment', () => {
  test('supplied hosted config blocks config writes and artifact-store construction with local or absent persisted mode', async () => {
    for (const persistedMode of ['local', 'absent'] as const) {
      for (const operation of ['writeKnowledgeConfig', 'createArtifactStore'] as const) {
        const root = mkdtempSync(join(tmpdir(), 'knowledge-public-supplied-hosted-'));
        const workspace = workspaceForHome(join(root, '.hasna', 'knowledge'));
        const hostedConfig = { ...defaultKnowledgeConfig(), mode: 'hosted' as const };
        const localConfigText = `${JSON.stringify(defaultKnowledgeConfig())}\n`;
        try {
          if (persistedMode === 'local') {
            mkdirSync(workspace.home, { recursive: true });
            writeFileSync(workspace.configPath, localConfigText);
          }

          await expectContained(() => operation === 'writeKnowledgeConfig'
            ? writeKnowledgeConfig(workspace.configPath, hostedConfig)
            : createArtifactStore(hostedConfig, workspace));

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

  test('hosted role config blocks representative root exports before data I/O', async () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-public-root-'));
    const home = join(root, '.hasna', 'knowledge');
    const workspace = workspaceForHome(home);
    const localConfig = defaultKnowledgeConfig();
    const hostedConfig = { ...localConfig, mode: 'hosted' as const };
    mkdirSync(home, { recursive: true });
    writeFileSync(workspace.configPath, `${JSON.stringify(hostedConfig)}\n`);
    const originalConfig = readFileSync(workspace.configPath, 'utf8');
    const storage = resolveStorageContract(localConfig, workspace, 'project');
    let artifactCalls = 0;
    const store: ArtifactStore = {
      type: 'local',
      canRead: true,
      canWrite: true,
      async put() {
        artifactCalls += 1;
        throw new Error('artifact tripwire');
      },
      async getText() {
        artifactCalls += 1;
        throw new Error('artifact tripwire');
      },
      async exists() {
        artifactCalls += 1;
        throw new Error('artifact tripwire');
      },
    };
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error('network tripwire');
    }) as unknown as typeof fetch;

    const snapshotOptions = {
      dbPath: workspace.knowledgeDbPath,
      scope: 'project',
      workspaceHome: workspace.home,
      storage,
    };
    const operations: Array<() => unknown> = [
      () => ensureKnowledgeWorkspace(home),
      () => readKnowledgeConfig(workspace.configPath),
      () => writeKnowledgeConfig(workspace.configPath, localConfig),
      () => createArtifactStore(localConfig, workspace),
      () => new LocalArtifactStore(workspace.artifactsDir),
      () => hybridSearch({ dbPath: workspace.knowledgeDbPath, query: 'synthetic', env: {} }),
      () => retrieveKnowledgeContext({ dbPath: workspace.knowledgeDbPath, query: 'synthetic', env: {} }),
      () => buildKnowledgeAgentContextPack({ dbPath: workspace.knowledgeDbPath, query: 'synthetic', env: {} }),
      () => createKnowledgeSyncBundle(snapshotOptions),
      () => createKnowledgeSyncSnapshot(snapshotOptions),
      () => getKnowledgeSyncStatus({
        dbPath: workspace.knowledgeDbPath,
        scope: 'project',
        workspaceHome: workspace.home,
      }),
      () => listKnowledgeMachines(workspace.knowledgeDbPath),
      () => listKnowledgeSyncConflicts(workspace.knowledgeDbPath),
      () => listAppWikiNotes({
        dbPath: workspace.knowledgeDbPath,
        scope: 'project',
        workspace,
      }),
      () => embeddingIndexStatus(workspace.knowledgeDbPath),
      () => reindexHealth({ dbPath: workspace.knowledgeDbPath, env: {} }),
      () => lintWiki({ dbPath: workspace.knowledgeDbPath }),
      () => compileWikiPage({ dbPath: workspace.knowledgeDbPath, store }),
      () => ingestOpenFilesManifest({
        dbPath: workspace.knowledgeDbPath,
        input: join(root, 'synthetic-manifest.json'),
      }),
      () => resolveOpenFilesSource({
        dbPath: workspace.knowledgeDbPath,
        sourceRef: 'open-files://file/synthetic',
      }),
    ];

    try {
      for (const operation of operations) await expectContained(operation);
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchCalls).toBe(0);
    expect(artifactCalls).toBe(0);
    expect(existsSync(workspace.knowledgeDbPath)).toBe(false);
    expect(existsSync(workspace.artifactsDir)).toBe(false);
    expect(readdirSync(home).sort()).toEqual(['config.json']);
    expect(readFileSync(workspace.configPath, 'utf8')).toBe(originalConfig);
  });

  test('directly preserved transforms and provider status helpers remain pure', () => {
    const snapshot = {
      tables_json: JSON.stringify({ sources: 2, chunks: 3 }),
      artifact_hashes_json: JSON.stringify([
        { artifact_uri: 'file:///synthetic', kind: 'wiki', hash: null, size_bytes: 0 },
      ]),
    } as Parameters<typeof syncTablesFromSnapshot>[0];

    expect(syncTablesFromSnapshot(snapshot)).toEqual({ sources: 2, chunks: 3 });
    expect(syncArtifactsFromSnapshot(snapshot)).toHaveLength(1);
    expect(providerCredentialStatus(defaultKnowledgeConfig(), {})).toBeArray();
    expect(providerStatus(defaultKnowledgeConfig(), {}).providers).toBeArray();
  });
});
