import { describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalArtifactStore } from '../src/artifact-store';
import {
  AnchoredArtifactDirectory,
  MAX_ANCHORED_ARTIFACT_BYTES,
  readAnchoredRegularFileSnapshot,
  setAnchoredFsTestHook,
  writeAnchoredRegularFile,
} from '../src/anchored-fs';
import { createKnowledgeService } from '../src/service';
import { KnowledgeContainmentError } from '../src/runtime-role';
import {
  defaultKnowledgeConfig,
  workspaceForHome,
  writeKnowledgeConfig,
} from '../src/workspace';

async function expectTyped(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected typed containment');
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeContainmentError);
    expect(error).toMatchObject({ status: 503 });
  }
}

describe('directory-anchored config and artifact regressions', () => {
  test('every present contradictory local storage.s3 object is invalid', () => {
    for (const s3 of [{}, { bucket: 'synthetic-stage-a-bucket' }]) {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-local-s3-invalid-'));
      const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
      mkdirSync(workspace.home, { recursive: true });
      const config = defaultKnowledgeConfig() as any;
      config.storage.s3 = s3;
      writeFileSync(workspace.configPath, `${JSON.stringify(config)}\n`);
      try {
        expect(() => createKnowledgeService({ scope: 'project', cwd: fixture, env: {} } as never))
          .toThrow('KNOWLEDGE_CONFIG_INVALID');
        expect(existsSync(workspace.artifactsDir)).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('a config-backed store treats deletion as KNOWLEDGE_CONFIG_INVALID before every operation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-config-deleted-'));
    const env: Record<string, string | undefined> = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };
    const service = createKnowledgeService({ scope: 'project', cwd: fixture, env } as never);
    service.setup({ mode: 'local' });
    const workspace = service.workspace;
    const store = service.artifactStore();
    await store.put({ key: 'stable.txt', body: 'unchanged' });
    unlinkSync(workspace.configPath);

    for (const operation of [
      () => store.put({ key: 'blocked.txt', body: 'blocked' }),
      () => store.getText('stable.txt'),
      () => store.exists('stable.txt'),
    ]) {
      try {
        await operation();
        throw new Error('expected deleted-config containment');
      } catch (error) {
        expect(error).toBeInstanceOf(KnowledgeContainmentError);
        expect(error).toMatchObject({ code: 'KNOWLEDGE_CONFIG_INVALID', status: 503 });
      }
    }
    expect(readFileSync(join(workspace.artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
    expect(existsSync(join(workspace.artifactsDir, 'blocked.txt'))).toBe(false);
    rmSync(fixture, { recursive: true, force: true });
  });

  test('proxy environment input is contained before workspace or artifact mutation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-config-proxy-env-'));
    const env = new Proxy({ HASNA_KNOWLEDGE_STORAGE_MODE: 'local' }, {
      get() {
        throw new Error('proxy getter tripwire');
      },
    });
    try {
      await expectTyped(() => createKnowledgeService({ scope: 'project', cwd: fixture, env } as never));
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('a config-backed store revalidates invalid or symlinked config swaps', async () => {
    for (const mutation of ['invalid-json', 'symlink'] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-config-${mutation}-`));
      const env: Record<string, string | undefined> = { HASNA_KNOWLEDGE_STORAGE_MODE: 'local' };
      const service = createKnowledgeService({ scope: 'project', cwd: fixture, env } as never);
      service.setup({ mode: 'local' });
      const workspace = service.workspace;
      const store = service.artifactStore();
      await store.put({ key: 'stable.txt', body: 'unchanged' });
      if (mutation === 'invalid-json') {
        writeFileSync(workspace.configPath, '{invalid-json\n');
      } else {
        const outside = join(fixture, 'outside-config.json');
        writeFileSync(outside, `${JSON.stringify(defaultKnowledgeConfig())}\n`);
        unlinkSync(workspace.configPath);
        symlinkSync(outside, workspace.configPath);
      }
      await expectTyped(() => store.getText('stable.txt'));
      expect(readFileSync(join(workspace.artifactsDir, 'stable.txt'), 'utf8')).toBe('unchanged');
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const operation of ['put', 'get'] as const) {
    test(`local artifact ${operation} rejects a symlink component without touching its external target`, async () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-artifact-symlink-${operation}-`));
      const root = join(fixture, 'artifacts');
      const outside = join(fixture, 'outside');
      mkdirSync(root, { recursive: true, mode: 0o700 });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(outside, 'victim.txt'), 'outside-unchanged');
      symlinkSync(outside, join(root, 'linked'));
      const store = new LocalArtifactStore(root);
      const call = operation === 'put'
        ? () => store.put({ key: 'linked/new.txt', body: 'blocked' })
        : () => store.getText('linked/victim.txt');
      await expectTyped(call);
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('outside-unchanged');
      expect(existsSync(join(outside, 'new.txt'))).toBe(false);
      rmSync(fixture, { recursive: true, force: true });
    });
  }

  test('local artifacts fail closed when their root path is replaced by a symlink after construction', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-root-swap-'));
    const root = join(fixture, 'artifacts');
    const moved = join(fixture, 'artifacts-original');
    const outside = join(fixture, 'outside');
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(outside);
    const store = new LocalArtifactStore(root);
    await store.put({ key: 'stable.txt', body: 'inside-unchanged' });
    writeFileSync(join(outside, 'stable.txt'), 'outside-unchanged');
    renameSync(root, moved);
    symlinkSync(outside, root);

    await expectTyped(() => store.put({ key: 'blocked.txt', body: 'blocked' }));
    await expectTyped(() => store.getText('stable.txt'));
    expect(readFileSync(join(moved, 'stable.txt'), 'utf8')).toBe('inside-unchanged');
    expect(readFileSync(join(outside, 'stable.txt'), 'utf8')).toBe('outside-unchanged');
    expect(existsSync(join(outside, 'blocked.txt'))).toBe(false);
    rmSync(fixture, { recursive: true, force: true });
  });

  test('anchored config replacement detects a parent swap without touching the replacement directory', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-config-parent-swap-'));
    const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
    writeKnowledgeConfig(workspace.configPath, defaultKnowledgeConfig());
    const moved = join(fixture, 'knowledge-original');
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'config.json'), 'outside-unchanged');
    let injected = false;
    setAnchoredFsTestHook((event) => {
      if (event !== 'config-before-parent-check' || injected) return;
      injected = true;
      renameSync(workspace.home, moved);
      symlinkSync(outside, workspace.home);
    });
    try {
      expect(() => writeKnowledgeConfig(workspace.configPath, defaultKnowledgeConfig()))
        .toThrow('KNOWLEDGE_CONFIG_INVALID');
      expect(readFileSync(join(outside, 'config.json'), 'utf8')).toBe('outside-unchanged');
      expect(JSON.parse(readFileSync(join(moved, 'config.json'), 'utf8')).mode).toBe('local');
    } finally {
      setAnchoredFsTestHook(undefined);
      if (existsSync(workspace.home)) unlinkSync(workspace.home);
      if (existsSync(moved)) renameSync(moved, workspace.home);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('anchored config replacement detects a destination swap and preserves both inodes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-config-target-swap-'));
    const workspace = workspaceForHome(join(fixture, '.hasna', 'knowledge'));
    writeKnowledgeConfig(workspace.configPath, defaultKnowledgeConfig());
    const original = join(workspace.home, 'config.original.json');
    const racing = join(workspace.home, 'config.racing.json');
    writeFileSync(racing, 'racing-target-unchanged');
    let injected = false;
    setAnchoredFsTestHook((event) => {
      if (event !== 'config-before-target-move' || injected) return;
      injected = true;
      renameSync(workspace.configPath, original);
      renameSync(racing, workspace.configPath);
    });
    try {
      expect(() => writeKnowledgeConfig(workspace.configPath, defaultKnowledgeConfig()))
        .toThrow('KNOWLEDGE_CONFIG_INVALID');
      expect(readFileSync(workspace.configPath, 'utf8')).toBe('racing-target-unchanged');
      expect(JSON.parse(readFileSync(original, 'utf8')).mode).toBe('local');
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('artifact component swaps are detected before external-target access', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-component-swap-'));
    const root = join(fixture, 'artifacts');
    const component = join(root, 'nested');
    const moved = join(root, 'nested-original');
    const outside = join(fixture, 'outside');
    mkdirSync(component, { recursive: true, mode: 0o700 });
    mkdirSync(outside);
    writeFileSync(join(outside, 'victim.txt'), 'outside-unchanged');
    const store = new LocalArtifactStore(root);
    let injected = false;
    setAnchoredFsTestHook((event, detail) => {
      if (event !== 'artifact-before-component-open' || detail !== 'nested' || injected) return;
      injected = true;
      renameSync(component, moved);
      symlinkSync(outside, component);
    });
    try {
      await expectTyped(() => store.put({ key: 'nested/blocked.txt', body: 'blocked' }));
      expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('outside-unchanged');
      expect(existsSync(join(outside, 'blocked.txt'))).toBe(false);
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const mutation of ['grow', 'truncate', 'replace', 'symlink'] as const) {
    test(`anchored artifact bounded read rejects a deterministic ${mutation} race`, () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-artifact-read-${mutation}-`));
      const root = join(fixture, 'artifacts');
      const target = join(root, 'target.txt');
      const moved = join(root, 'target-original.txt');
      const outside = join(fixture, 'outside.txt');
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(target, 'stable-content', { mode: 0o600 });
      writeFileSync(outside, 'outside-content', { mode: 0o600 });
      const artifacts = new AnchoredArtifactDirectory(root);
      let injected = false;
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'artifact-before-read' || detail !== 'target.txt' || injected) return;
        injected = true;
        if (mutation === 'grow') appendFileSync(target, '-growth');
        if (mutation === 'truncate') truncateSync(target, 1);
        if (mutation === 'replace') {
          renameSync(target, moved);
          writeFileSync(target, 'replacement', { mode: 0o600 });
        }
        if (mutation === 'symlink') {
          renameSync(target, moved);
          symlinkSync(outside, target);
        }
      });
      try {
        expect(() => artifacts.read('target.txt')).toThrow();
        expect(injected).toBe(true);
      } finally {
        setAnchoredFsTestHook(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  for (const mutation of ['grow', 'truncate', 'replace', 'unlink-recreate', 'symlink', 'hardlink'] as const) {
    test(`anchored regular-file snapshot rejects a deterministic post-read ${mutation} race`, () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-snapshot-read-${mutation}-`));
      const target = join(fixture, 'config.json');
      const moved = join(fixture, 'config.original.json');
      const outside = join(fixture, 'outside.json');
      writeFileSync(target, 'stable-content', { mode: 0o600 });
      writeFileSync(outside, 'outside-content', { mode: 0o600 });
      let injected = false;
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'snapshot-after-read' || detail !== target || injected) return;
        injected = true;
        if (mutation === 'grow') appendFileSync(target, '-growth');
        if (mutation === 'truncate') truncateSync(target, 1);
        if (mutation === 'replace') {
          renameSync(target, moved);
          writeFileSync(target, 'replacement', { mode: 0o600 });
        }
        if (mutation === 'unlink-recreate') {
          unlinkSync(target);
          writeFileSync(target, 'replacement', { mode: 0o600 });
        }
        if (mutation === 'symlink') {
          renameSync(target, moved);
          symlinkSync(outside, target);
        }
        if (mutation === 'hardlink') linkSync(target, moved);
      });
      try {
        expect(() => readAnchoredRegularFileSnapshot(target)).toThrow();
        expect(injected).toBe(true);
      } finally {
        setAnchoredFsTestHook(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('anchored artifact read enforces the final encoded UTF-8 byte ceiling', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-encoded-limit-'));
    const root = join(fixture, 'artifacts');
    const target = join(root, 'invalid-utf8.bin');
    mkdirSync(root, { mode: 0o700 });
    writeFileSync(
      target,
      Buffer.alloc(Math.floor(MAX_ANCHORED_ARTIFACT_BYTES / 3) + 1, 0x80),
      { mode: 0o600 },
    );
    try {
      expect(() => new AnchoredArtifactDirectory(root).read('invalid-utf8.bin'))
        .toThrow('encoded bytes');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('config implementation uses a directory-FD anchored helper rather than pathname replacement', () => {
    const runtime = readFileSync(join(import.meta.dir, '..', 'src', 'runtime-role.ts'), 'utf8');
    const workspace = readFileSync(join(import.meta.dir, '..', 'src', 'workspace.ts'), 'utf8');
    expect(runtime).toContain("from './anchored-fs'");
    expect(workspace).toContain("from './anchored-fs'");
    expect(runtime).not.toContain('openSync(path,');
    expect(workspace).not.toContain('renameSync(temporary, path)');
  });

  test('artifact roots and files enforce exact confidentiality modes on every operation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-modes-'));
    const root = join(fixture, 'artifacts');
    mkdirSync(root, { mode: 0o700 });
    const store = new LocalArtifactStore(root);
    try {
      await store.put({ key: 'private.txt', body: 'private' });
      expect(statSync(root).mode & 0o777).toBe(0o700);
      expect(statSync(join(root, 'private.txt')).mode & 0o777).toBe(0o600);

      chmodSync(join(root, 'private.txt'), 0o640);
      await expectTyped(() => store.getText('private.txt'));
      await expectTyped(() => store.exists('private.txt'));

      chmodSync(join(root, 'private.txt'), 0o600);
      chmodSync(root, 0o750);
      await expectTyped(() => store.put({ key: 'blocked.txt', body: 'blocked' }));
      await expectTyped(() => store.getText('private.txt'));
      await expectTyped(() => store.exists('private.txt'));
      expect(existsSync(join(root, 'blocked.txt'))).toBe(false);
    } finally {
      chmodSync(root, 0o700);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('artifact replacement installs a fresh 0600 inode instead of preserving unsafe bits', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-replace-mode-'));
    const root = join(fixture, 'artifacts');
    mkdirSync(root, { mode: 0o700 });
    const target = join(root, 'replace.txt');
    writeFileSync(target, 'unsafe-old', { mode: 0o644 });
    const oldInode = statSync(target).ino;
    const store = new LocalArtifactStore(root);
    try {
      await store.put({ key: 'replace.txt', body: 'safe-new' });
      const replaced = statSync(target);
      expect(replaced.ino).not.toBe(oldInode);
      expect(replaced.mode & 0o777).toBe(0o600);
      expect(readFileSync(target, 'utf8')).toBe('safe-new');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const mutation of ['replace', 'unlink-recreate'] as const) {
    test(`anchored config finality rolls back a deterministic ${mutation} after install`, () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-config-finality-${mutation}-`));
      const target = join(fixture, 'config.json');
      const displaced = join(fixture, 'config.intended.json');
      writeAnchoredRegularFile(target, 'original-config');
      let injected = false;
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'config-before-final-verify' || detail !== target || injected) return;
        injected = true;
        if (mutation === 'replace') renameSync(target, displaced);
        else unlinkSync(target);
        writeFileSync(target, 'racing-config', { mode: 0o600 });
      });
      try {
        expect(() => writeAnchoredRegularFile(target, 'intended-config')).toThrow(/installed file|identity|temporary (?:inode|install)|hard-link/i);
        expect(injected).toBe(true);
        expect(readFileSync(target, 'utf8')).toBe('original-config');
        const conflict = readdirSync(fixture).find((name) => name.startsWith('.knowledge-conflict-'));
        expect(conflict).toBeDefined();
        expect(readFileSync(join(fixture, conflict!), 'utf8')).toBe('racing-config');
      } finally {
        setAnchoredFsTestHook(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    });

    test(`anchored artifact finality rolls back a deterministic ${mutation} after install`, () => {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-artifact-finality-${mutation}-`));
      const root = join(fixture, 'artifacts');
      const target = join(root, 'target.txt');
      const displaced = join(root, 'target.intended.txt');
      const artifacts = new AnchoredArtifactDirectory(root);
      artifacts.put('target.txt', 'original-artifact');
      let injected = false;
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'artifact-before-final-verify' || detail !== 'target.txt' || injected) return;
        injected = true;
        if (mutation === 'replace') renameSync(target, displaced);
        else unlinkSync(target);
        writeFileSync(target, 'racing-artifact', { mode: 0o600 });
      });
      try {
        expect(() => artifacts.put('target.txt', 'intended-artifact')).toThrow(/installed file|identity|temporary (?:inode|install)|hard-link/i);
        expect(injected).toBe(true);
        expect(readFileSync(target, 'utf8')).toBe('original-artifact');
        const conflict = readdirSync(root).find((name) => name.startsWith('.knowledge-conflict-'));
        expect(conflict).toBeDefined();
        expect(readFileSync(join(root, conflict!), 'utf8')).toBe('racing-artifact');
      } finally {
        setAnchoredFsTestHook(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  }

  test('artifact directory mode drift revokes nested reads and writes', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-artifact-component-mode-'));
    const root = join(fixture, 'artifacts');
    mkdirSync(root, { mode: 0o700 });
    const store = new LocalArtifactStore(root);
    try {
      await store.put({ key: 'nested/stable.txt', body: 'stable' });
      chmodSync(join(root, 'nested'), 0o755);
      await expectTyped(() => store.getText('nested/stable.txt'));
      await expectTyped(() => store.put({ key: 'nested/blocked.txt', body: 'blocked' }));
      expect(existsSync(join(root, 'nested', 'blocked.txt'))).toBe(false);
    } finally {
      chmodSync(join(root, 'nested'), 0o700);
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
