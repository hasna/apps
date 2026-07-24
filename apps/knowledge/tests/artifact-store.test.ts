import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalArtifactStore,
  S3ArtifactStore,
  createArtifactStore,
  normalizeArtifactKey,
} from '../src/artifact-store';
import { KnowledgeContainmentError } from '../src/runtime-role';
import { createKnowledgeService } from '../src/service';
import { defaultKnowledgeConfig, workspaceForHome } from '../src/workspace';

const createLocalStoreWithBoundary = (
  root: string,
  boundary: Record<string, unknown>,
): LocalArtifactStore => new (LocalArtifactStore as unknown as {
  new(root: string, boundary: Record<string, unknown>): LocalArtifactStore;
})(root, boundary);

const createStoreWithBoundary = (
  config: Parameters<typeof createArtifactStore>[0],
  workspace: Parameters<typeof createArtifactStore>[1],
  boundary: Record<string, unknown>,
) => (createArtifactStore as unknown as (
  config: Parameters<typeof createArtifactStore>[0],
  workspace: Parameters<typeof createArtifactStore>[1],
  boundary: Record<string, unknown>,
) => ReturnType<typeof createArtifactStore>)(config, workspace, boundary);

async function expectContained(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected Stage-A containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect(error).toMatchObject({ status: 503 });
  }
}

describe('knowledge artifact store', () => {
  test('normalizes safe keys and rejects traversal', () => {
    expect(normalizeArtifactKey('wiki/engineering/mcp.md')).toBe('wiki/engineering/mcp.md');
    expect(normalizeArtifactKey('wiki\\engineering\\mcp.md')).toBe('wiki/engineering/mcp.md');
    expect(() => normalizeArtifactKey('../secrets.txt')).toThrow('Invalid artifact key');
    expect(() => normalizeArtifactKey('/absolute/path.txt')).toThrow('Invalid artifact key');
    expect(() => normalizeArtifactKey('wiki/../secret.txt')).toThrow('Invalid artifact key');
  });

  test('local store writes and reads text inside artifact root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-artifacts-'));
    const store = new LocalArtifactStore(dir);

    const result = await store.put({
      key: 'wiki/engineering/mcp.md',
      body: '# MCP\n\nAgent-facing tools.',
      content_type: 'text/markdown',
    });

    expect(result.key).toBe('wiki/engineering/mcp.md');
    expect(result.uri).toStartWith('file://');
    expect(Number.isNaN(Date.parse(result.modified_at ?? ''))).toBe(false);
    expect(existsSync(join(dir, 'wiki', 'engineering', 'mcp.md'))).toBe(true);
    expect(await store.exists('wiki/engineering/mcp.md')).toBe(true);
    expect(await store.getText('wiki/engineering/mcp.md')).toContain('Agent-facing tools');
  });

  test('S3 constructors and factories contain before inspecting or calling clients', async () => {
    let optionReads = 0;
    let clientCalls = 0;
    const hostileOptions = new Proxy({
      bucket: 'synthetic-bucket',
      client: {
        async send() {
          clientCalls += 1;
          throw new Error('S3 client tripwire');
        },
      },
    }, {
      get(target, property, receiver) {
        optionReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    await expectContained(() => new S3ArtifactStore(hostileOptions));
    expect(optionReads).toBe(0);
    expect(clientCalls).toBe(0);

    const root = mkdtempSync(join(tmpdir(), 'knowledge-s3-factory-contained-'));
    const workspace = workspaceForHome(join(root, '.hasna', 'knowledge'));
    const config = defaultKnowledgeConfig();
    config.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: { bucket: 'synthetic-bucket' },
    };
    await expectContained(() => createArtifactStore(config, workspace));
    expect(existsSync(workspace.home)).toBe(false);
  });

  test('factory gates hosted intent before config inspection and malformed config before I/O', () => {
    const root = mkdtempSync(join(tmpdir(), 'knowledge-artifact-factory-gates-'));
    const workspace = workspaceForHome(join(root, '.hasna', 'knowledge'));
    let inspections = 0;
    const hostileConfig = new Proxy({}, {
      get() {
        inspections += 1;
        throw new Error('config inspected');
      },
    });
    expect(() => createStoreWithBoundary(hostileConfig as any, workspace, {
      env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'hosted' },
    })).toThrow('KNOWLEDGE_HOSTED_CONTAINED');
    expect(inspections).toBe(0);

    const malformed = defaultKnowledgeConfig() as any;
    malformed.storage.artifacts_root = '../outside';
    expect(() => createStoreWithBoundary(malformed, workspace, {
      env: { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' },
    })).toThrow('KNOWLEDGE_CONFIG_INVALID');
    expect(existsSync(workspace.home)).toBe(false);
  });

  test('requireConfig needs an explicit trusted config before nonstandard root access', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-explicit-config-'));
    const root = join(fixture, 'nonstandard-root');
    const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
    try {
      expect(() => createLocalStoreWithBoundary(root, { requireConfig: true }))
        .toThrow('KNOWLEDGE_CONFIG_INVALID');
      expect(existsSync(root)).toBe(false);

      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      service.setup({ mode: 'local' });
      const store = createLocalStoreWithBoundary(root, {
        requireConfig: true,
        configPath: workspace.configPath,
        env: {},
      } as any);
      await store.put({ key: 'proof.txt', body: 'authorized' });
      expect(await store.getText('proof.txt')).toBe('authorized');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const mutation of ['deletion', 'replacement'] as const) {
    test(`an explicitly authorized nonstandard root revokes access after config ${mutation}`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-nonstandard-config-${mutation}-`));
      const root = join(fixture, 'private-artifact-authority');
      const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      try {
        service.setup({ mode: 'local' });
        const store = createLocalStoreWithBoundary(root, {
          requireConfig: true,
          configPath: workspace.configPath,
          env: {},
        });
        await store.put({ key: 'stable.txt', body: 'unchanged' });

        if (mutation === 'deletion') {
          unlinkSync(workspace.configPath);
        } else {
          const replacement = join(workspace.home, 'config.replacement.json');
          writeFileSync(replacement, readFileSync(workspace.configPath));
          renameSync(replacement, workspace.configPath);
        }

        for (const operation of [
          () => store.put({ key: 'blocked.txt', body: 'blocked' }),
          () => store.getText('stable.txt'),
        ]) await expectContained(operation);

        expect(readFileSync(join(root, 'stable.txt'), 'utf8')).toBe('unchanged');
        expect(existsSync(join(root, 'blocked.txt'))).toBe(false);
        expect(readdirSync(root).sort()).toEqual(['stable.txt']);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('hard-linked artifacts are replaced or rejected without modifying the outside inode', async () => {
    for (const operation of ['put', 'get'] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-artifact-hardlink-${operation}-`));
      const root = join(fixture, 'artifacts');
      const outside = join(fixture, 'outside.txt');
      const target = join(root, 'linked.txt');
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(outside, 'outside-unchanged');
      linkSync(outside, target);
      const original = lstatSync(outside);
      const store = new LocalArtifactStore(root);
      try {
        if (operation === 'put') {
          await store.put({ key: 'linked.txt', body: 'inside-replaced' });
          expect(readFileSync(target, 'utf8')).toBe('inside-replaced');
          expect(lstatSync(target).ino).not.toBe(original.ino);
        } else {
          await expectContained(() => store.getText('linked.txt'));
        }
        expect(readFileSync(outside, 'utf8')).toBe('outside-unchanged');
        expect(lstatSync(outside).ino).toBe(original.ino);
        expect(readdirSync(root).sort()).toEqual(['linked.txt']);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('a returned service store revokes every operation when supplied env flips hosted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-artifact-env-revocation-'));
    const env: Record<string, string | undefined> = {
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
    };
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env } as never);
    service.setup({ mode: 'local' });
    const store = service.artifactStore() as LocalArtifactStore;
    const artifactsDir = service.workspace.artifactsDir;
    await store.put({ key: 'stable.txt', body: 'unchanged' });
    const before = readdirSync(artifactsDir).sort();

    env.HASNA_KNOWLEDGE_STORAGE_MODE = 'hosted';
    for (const operation of [
      () => store.put({ key: 'blocked.txt', body: 'blocked' }),
      () => store.getText('stable.txt'),
    ]) await expectContained(operation);

    expect(readFileSync(join(artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
    expect(existsSync(join(artifactsDir, 'blocked.txt'))).toBe(false);
    expect(readdirSync(artifactsDir).sort()).toEqual(before);
  });

  test('a returned service store revalidates the persisted config before every operation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-artifact-config-revocation-'));
    const env: Record<string, string | undefined> = {
      HASNA_KNOWLEDGE_STORAGE_MODE: 'local',
    };
    const service = createKnowledgeService({ scope: 'project', cwd: dir, env } as never);
    service.setup({ mode: 'local' });
    const store = service.artifactStore() as LocalArtifactStore;
    const { artifactsDir, configPath } = service.workspace;
    await store.put({ key: 'stable.txt', body: 'unchanged' });

    const hosted = defaultKnowledgeConfig();
    hosted.storage = {
      type: 's3',
      artifacts_root: 'artifacts',
      s3: { bucket: 'synthetic-bucket' },
    };
    writeFileSync(configPath, `${JSON.stringify(hosted)}\n`);
    for (const operation of [
      () => store.put({ key: 'blocked.txt', body: 'blocked' }),
      () => store.getText('stable.txt'),
    ]) await expectContained(operation);

    expect(readFileSync(join(artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
    expect(existsSync(join(artifactsDir, 'blocked.txt'))).toBe(false);
  });

  for (const mutation of ['deletion', 'replacement'] as const) {
    test(`a direct class store revokes put/get after config ${mutation}`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-direct-config-${mutation}-`));
      const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
      const config = defaultKnowledgeConfig();
      try {
        writeFileSync(workspace.configPath, '', { flag: 'wx' });
      } catch {
        // Parent creation is performed below through the canonical setup path.
      }
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never);
      service.setup({ mode: 'local' });
      const store = new LocalArtifactStore(workspace.artifactsDir);
      await store.put({ key: 'stable.txt', body: 'unchanged' });

      if (mutation === 'deletion') {
        unlinkSync(workspace.configPath);
      } else {
        const replacement = join(workspace.home, 'config.replacement.json');
        writeFileSync(replacement, `${JSON.stringify(config)}\n`);
        renameSync(replacement, workspace.configPath);
      }

      for (const operation of [
        () => store.put({ key: 'blocked.txt', body: 'blocked' }),
        () => store.getText('stable.txt'),
      ]) await expectContained(operation);

      expect(readFileSync(join(workspace.artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
      expect(existsSync(join(workspace.artifactsDir, 'blocked.txt'))).toBe(false);
      rmSync(fixture, { recursive: true, force: true });
    });
  }
});
