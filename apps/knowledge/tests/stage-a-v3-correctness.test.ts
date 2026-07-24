import { describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AnchoredArtifactDirectory,
  MAX_ANCHORED_ARTIFACT_NODES,
  setAnchoredArtifactLockTestControl,
  setAnchoredFsTestHook,
  writeAnchoredRegularFile,
} from '../src/anchored-fs.ts';
import { loadStore, saveStore, setStoreLockTestControl, withLock } from '../src/store.ts';
import { buildServer } from '../src/mcp.js';
import { buildServer as builtBuildServer } from '../dist/mcp-payload.js';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const cli = join(repositoryRoot, 'src', 'cli.ts');
const builtCli = join(repositoryRoot, 'bin', 'knowledge.js');

function internalPreviousName(kind: 'store' | 'artifact', target: string): string {
  const digest = createHash('sha256').update(target).digest('hex');
  return `.knowledge-${kind}-previous-${digest}`;
}

function artifactLockName(key: string): string {
  return `.knowledge-artifact-lock-${createHash('sha256').update(key).digest('hex')}`;
}

function artifactLockCandidateName(lockName: string, pid: number, token: string): string {
  return `${lockName}.candidate.${pid}.${token}`;
}

function storeLockCandidateName(lockName: string, pid: number, token: string): string {
  return `${lockName}.candidate.${pid}.${token}`;
}

function itemStore(title: string): string {
  return `${JSON.stringify({
    items: [{
      id: `k_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      short_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      content: title,
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

describe('Stage A V3 rejected-candidate correctness regressions', () => {
  test('nested parent replacement after open revokes artifact reads at the canonical path', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-parent-read-'));
    const root = join(fixture, 'artifacts');
    const nested = join(root, 'nested');
    const displaced = join(root, 'nested-displaced');
    mkdirSync(nested, { recursive: true, mode: 0o700 });
    writeFileSync(join(nested, 'target.txt'), 'displaced-content', { mode: 0o600 });
    const artifacts = new AnchoredArtifactDirectory(root);
    let injected = false;
    setAnchoredFsTestHook((event, detail) => {
      if (event !== 'artifact-before-read' || detail !== 'nested/target.txt' || injected) return;
      injected = true;
      renameSync(nested, displaced);
      mkdirSync(nested, { mode: 0o700 });
      writeFileSync(join(nested, 'target.txt'), 'canonical-content', { mode: 0o600 });
    });
    try {
      expect(() => artifacts.read('nested/target.txt')).toThrow(/component|parent|identity|canonical/i);
      expect(readFileSync(join(nested, 'target.txt'), 'utf8')).toBe('canonical-content');
      expect(readFileSync(join(displaced, 'target.txt'), 'utf8')).toBe('displaced-content');
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('nested parent replacement after open prevents artifact put success against a displaced directory', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-parent-put-'));
    const root = join(fixture, 'artifacts');
    const nested = join(root, 'nested');
    const displaced = join(root, 'nested-displaced');
    mkdirSync(nested, { recursive: true, mode: 0o700 });
    writeFileSync(join(nested, 'target.txt'), 'prior-content', { mode: 0o600 });
    const artifacts = new AnchoredArtifactDirectory(root);
    let injected = false;
    setAnchoredFsTestHook((event, detail) => {
      if (event !== 'artifact-before-final-verify' || detail !== 'nested/target.txt' || injected) return;
      injected = true;
      renameSync(nested, displaced);
      mkdirSync(nested, { mode: 0o700 });
      writeFileSync(join(nested, 'target.txt'), 'canonical-content', { mode: 0o600 });
    });
    try {
      expect(() => artifacts.put('nested/target.txt', 'displaced-write'))
        .toThrow(/component|parent|identity|canonical/i);
      expect(readFileSync(join(nested, 'target.txt'), 'utf8')).toBe('canonical-content');
      expect(readFileSync(join(displaced, 'target.txt'), 'utf8')).toBe('prior-content');
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('store recovery restores the last complete generation instead of initializing empty', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-store-generation-'));
    const storePath = join(fixture, 'db.json');
    const previousPath = join(fixture, internalPreviousName('store', 'db.json'));
    writeFileSync(previousPath, itemStore('Prior generation'), { mode: 0o600 });
    try {
      const recovered = withLock(storePath, () => loadStore(storePath));
      expect(recovered.items.map((item) => item.title)).toEqual(['Prior generation']);
      expect(readFileSync(storePath, 'utf8')).toBe(itemStore('Prior generation'));
      expect(existsSync(previousPath)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('artifact recovery restores the last complete generation when the canonical name is absent', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-artifact-generation-'));
    const root = join(fixture, 'artifacts');
    const nested = join(root, 'nested');
    mkdirSync(nested, { recursive: true, mode: 0o700 });
    const previousPath = join(nested, internalPreviousName('artifact', 'target.txt'));
    writeFileSync(previousPath, 'prior-generation', { mode: 0o600 });
    const artifacts = new AnchoredArtifactDirectory(root);
    try {
      expect(artifacts.read('nested/target.txt')).toBe('prior-generation');
      expect(readFileSync(join(nested, 'target.txt'), 'utf8')).toBe('prior-generation');
      expect(existsSync(previousPath)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('store replacement crash points preserve a canonical complete generation and recover deterministically', () => {
    const moduleUrl = new URL('../src/store.ts', import.meta.url).href;
    for (const [event, exitCode, expectedTitle] of [
      ['before-store-atomic-install', 81, 'Prior generation'],
      ['before-store-final-verify', 82, 'Committed generation'],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v3-store-crash-${event}-`));
      const storePath = join(fixture, 'db.json');
      const previousPath = join(fixture, internalPreviousName('store', 'db.json'));
      writeFileSync(storePath, itemStore('Prior generation'), { mode: 0o600 });
      const script = `
        const { loadStore, saveStore, setStoreLockTestControl, withLock } = await import(${JSON.stringify(moduleUrl)});
        setStoreLockTestControl({
          onEvent(observed, detail) {
            if (observed === ${JSON.stringify(event)} && detail.path === ${JSON.stringify(storePath)}) {
              process.exit(${exitCode});
            }
          },
        });
        withLock(${JSON.stringify(storePath)}, () => {
          const store = loadStore(${JSON.stringify(storePath)});
          store.items[0].title = 'Committed generation';
          store.items[0].content = 'Committed generation';
          saveStore(${JSON.stringify(storePath)}, store);
        });
      `;
      try {
        const crashed = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(crashed.exitCode, new TextDecoder().decode(crashed.stderr)).toBe(exitCode);
        expect(existsSync(storePath)).toBe(true);
        expect(JSON.parse(readFileSync(storePath, 'utf8')).items[0].title).toBe(expectedTitle);
        const recovered = withLock(storePath, () => loadStore(storePath));
        expect(recovered.items[0].title).toBe(expectedTitle);
        expect(existsSync(previousPath)).toBe(false);
        expect(readdirSync(fixture).filter((name) => name.startsWith('db.json.tmp.'))).toEqual([]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('artifact replacement crash points preserve a canonical complete generation and recover deterministically', () => {
    const moduleUrl = new URL('../src/anchored-fs.ts', import.meta.url).href;
    for (const [event, exitCode, expected] of [
      ['artifact-before-atomic-install', 83, 'prior-generation'],
      ['artifact-before-final-verify', 84, 'committed-generation'],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v3-artifact-crash-${event}-`));
      const root = join(fixture, 'artifacts');
      const target = join(root, 'nested', 'target.txt');
      const previous = join(root, 'nested', internalPreviousName('artifact', 'target.txt'));
      mkdirSync(join(root, 'nested'), { recursive: true, mode: 0o700 });
      writeFileSync(target, 'prior-generation', { mode: 0o600 });
      const script = `
        const { AnchoredArtifactDirectory, setAnchoredFsTestHook } = await import(${JSON.stringify(moduleUrl)});
        const artifacts = new AnchoredArtifactDirectory(${JSON.stringify(root)});
        setAnchoredFsTestHook((observed, detail) => {
          if (observed === ${JSON.stringify(event)} && detail === 'nested/target.txt') process.exit(${exitCode});
        });
        artifacts.put('nested/target.txt', 'committed-generation');
      `;
      try {
        const crashed = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(crashed.exitCode, new TextDecoder().decode(crashed.stderr)).toBe(exitCode);
        expect(existsSync(target)).toBe(true);
        expect(readFileSync(target, 'utf8')).toBe(expected);
        const artifacts = new AnchoredArtifactDirectory(root);
        expect(artifacts.read('nested/target.txt')).toBe(expected);
        expect(existsSync(previous)).toBe(false);
        expect(readdirSync(join(root, 'nested')).filter((name) => name.startsWith('.knowledge-tmp-')))
          .toEqual([]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('initial config, store, and artifact publication never overwrite a racing canonical name', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-initial-no-clobber-'));
    const configPath = join(fixture, 'config.json');
    const storePath = join(fixture, 'db.json');
    const artifactRoot = join(fixture, 'artifacts');
    const artifactPath = join(artifactRoot, 'target.txt');
    mkdirSync(artifactRoot, { mode: 0o700 });
    try {
      let configInjected = false;
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'config-before-parent-check' || detail !== configPath || configInjected) return;
        configInjected = true;
        writeFileSync(configPath, 'racing-config', { mode: 0o600 });
      });
      expect(() => writeAnchoredRegularFile(configPath, 'intended-config'))
        .toThrow(/changed|install|target/i);
      expect(readFileSync(configPath, 'utf8')).toBe('racing-config');

      let artifactInjected = false;
      const artifacts = new AnchoredArtifactDirectory(artifactRoot);
      setAnchoredFsTestHook((event, detail) => {
        if (event !== 'artifact-before-atomic-install' || detail !== 'target.txt' || artifactInjected) return;
        artifactInjected = true;
        writeFileSync(artifactPath, 'racing-artifact', { mode: 0o600 });
      });
      expect(() => artifacts.put('target.txt', 'intended-artifact'))
        .toThrow(/changed|install|target/i);
      expect(readFileSync(artifactPath, 'utf8')).toBe('racing-artifact');

      let storeInjected = false;
      setStoreLockTestControl({
        onEvent(event, detail) {
          if (event !== 'before-store-atomic-install' || detail.path !== storePath || storeInjected) return;
          storeInjected = true;
          writeFileSync(storePath, itemStore('Racing store'), { mode: 0o600 });
        },
      });
      expect(() => withLock(storePath, () => saveStore(storePath, { items: [] })))
        .toThrow(/changed|install|target/i);
      expect(readFileSync(storePath, 'utf8')).toBe(itemStore('Racing store'));
    } finally {
      setAnchoredFsTestHook(undefined);
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('config generation recovery cannot consume another live writer transition', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-config-live-generation-'));
    const configPath = join(fixture, 'config.json');
    writeAnchoredRegularFile(configPath, 'prior-config');
    let injected = false;
    let innerError: unknown;
    let monotonic = 0;
    setAnchoredArtifactLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds: number) => { monotonic += milliseconds; },
    });
    setAnchoredFsTestHook((event, detail) => {
      if (event !== 'config-before-target-move' || detail !== configPath || injected) return;
      injected = true;
      try {
        writeAnchoredRegularFile(configPath, 'inner-config');
      } catch (error) {
        innerError = error;
      }
    });
    try {
      expect(() => writeAnchoredRegularFile(configPath, 'outer-config')).not.toThrow();
      expect(String(innerError)).toMatch(/lock.*could not be acquired/i);
      expect(readFileSync(configPath, 'utf8')).toBe('outer-config');
      expect(readdirSync(fixture).filter((name) => name.startsWith('.knowledge-'))).toEqual([]);
    } finally {
      setAnchoredFsTestHook(undefined);
      setAnchoredArtifactLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('dead initial-publication temporary hard links are reclaimed without removing the canonical generation', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-initial-publication-recovery-'));
    const deadPid = 2_147_483_647;
    const storePath = join(fixture, 'db.json');
    const storeTemporary = join(fixture, `db.json.tmp.${deadPid}.dead-initial`);
    const artifactRoot = join(fixture, 'artifacts');
    const artifactTarget = join(artifactRoot, 'target.txt');
    const artifactTemporary = join(artifactRoot, `.knowledge-tmp-${deadPid}-dead-initial`);
    mkdirSync(artifactRoot, { mode: 0o700 });
    writeFileSync(storeTemporary, itemStore('Published store'), { mode: 0o600 });
    linkSync(storeTemporary, storePath);
    writeFileSync(artifactTemporary, 'published-artifact', { mode: 0o600 });
    linkSync(artifactTemporary, artifactTarget);
    try {
      const store = withLock(storePath, () => loadStore(storePath));
      expect(store.items[0]?.title).toBe('Published store');
      expect(existsSync(storeTemporary)).toBe(false);
      expect(lstatSync(storePath).nlink).toBe(1);

      const artifacts = new AnchoredArtifactDirectory(artifactRoot);
      expect(artifacts.read('target.txt')).toBe('published-artifact');
      expect(existsSync(artifactTemporary)).toBe(false);
      expect(lstatSync(artifactTarget).nlink).toBe(1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('artifact lock recovery bounds only same-key transition names, not unrelated root entries', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-artifact-lock-prefix-'));
    const root = join(fixture, 'artifacts');
    mkdirSync(root, { mode: 0o700 });
    try {
      for (let index = 0; index <= MAX_ANCHORED_ARTIFACT_NODES; index += 1) {
        writeFileSync(join(root, `unrelated-${index}.txt`), 'unrelated', { mode: 0o600 });
      }
      const artifacts = new AnchoredArtifactDirectory(root);
      expect(() => artifacts.put('target.txt', 'installed')).not.toThrow();
      expect(readFileSync(join(root, 'target.txt'), 'utf8')).toBe('installed');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('a crash while creating a store-lock candidate cannot leave permanent zero or partial blockage', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-store-lock-publication-'));
    const storePath = join(fixture, 'db.json');
    const lockPath = `${storePath}.lock`;
    const moduleUrl = new URL('../src/store.ts', import.meta.url).href;
    try {
      for (const [event, exitCode] of [
        ['after-lock-candidate-create', 91],
        ['after-lock-candidate-partial-write', 92],
      ] as const) {
        const script = `
          const { setStoreLockTestControl, withLock } = await import(${JSON.stringify(moduleUrl)});
          setStoreLockTestControl({
            onEvent(observed, detail) {
              if (observed === ${JSON.stringify(event)} && detail.path === ${JSON.stringify(lockPath)}) {
                process.exit(${exitCode});
              }
            },
          });
          withLock(${JSON.stringify(storePath)}, () => undefined, { createParent: true });
        `;
        const crashed = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(crashed.exitCode, new TextDecoder().decode(crashed.stderr)).toBe(exitCode);
        expect(existsSync(lockPath)).toBe(false);
        expect(readdirSync(fixture).some((name) => name.startsWith('db.json.lock.candidate.'))).toBe(true);

        let entered = false;
        withLock(storePath, () => { entered = true; }, { createParent: true });
        expect(entered).toBe(true);
        expect(existsSync(lockPath)).toBe(false);
        expect(readdirSync(fixture).filter((name) => name.includes('.lock.candidate.'))).toEqual([]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('store and artifact transition recovery rejects malformed, oversized, and special static entries', () => {
    const deadPid = 2_147_483_647;
    for (const surface of ['store', 'artifact'] as const) {
      for (const mutation of ['malformed-name', 'oversized', 'directory'] as const) {
        const fixture = mkdtempSync(join(tmpdir(), `knowledge-v3-${surface}-transition-${mutation}-`));
        const root = surface === 'artifact' ? join(fixture, 'artifacts') : fixture;
        mkdirSync(root, { recursive: true, mode: 0o700 });
        const storePath = join(root, 'db.json');
        const lockName = surface === 'artifact' ? artifactLockName('target.txt') : 'db.json.lock';
        const entryName = mutation === 'malformed-name'
          ? `${lockName}.candidate.bad`
          : `${lockName}.candidate.${deadPid}.static-${mutation}`;
        const entryPath = join(root, entryName);
        if (mutation === 'directory') mkdirSync(entryPath, { mode: 0o700 });
        else writeFileSync(entryPath, mutation === 'oversized' ? 'x'.repeat(65_537) : 'static', { mode: 0o600 });
        try {
          if (surface === 'store') {
            expect(() => withLock(storePath, () => undefined, { createParent: true }))
              .toThrow(/lock.*transition|transition.*lock/i);
          } else {
            const artifacts = new AnchoredArtifactDirectory(root);
            expect(() => artifacts.put('target.txt', 'must-not-install'))
              .toThrow(/lock.*transition|transition.*lock/i);
            expect(existsSync(join(root, 'target.txt'))).toBe(false);
          }
          expect(existsSync(entryPath)).toBe(true);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    }
  });

  test('store lock recovery completes a dead nlink=2 publication while preserving a live owner', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-store-lock-hardlink-'));
    const storePath = join(fixture, 'db.json');
    const lockName = 'db.json.lock';
    const lockPath = join(fixture, lockName);
    const deadPid = 2_147_483_647;
    const deadToken = 'dead-publication';
    const deadCandidate = join(fixture, storeLockCandidateName(lockName, deadPid, deadToken));
    writeFileSync(deadCandidate, `${JSON.stringify({
      version: 1,
      owner: 'dead-owner',
      token: deadToken,
      pid: deadPid,
    })}\n`, { mode: 0o600 });
    linkSync(deadCandidate, lockPath);
    let monotonic = 0;
    setStoreLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds: number) => { monotonic += milliseconds; },
    });
    try {
      let entered = false;
      withLock(storePath, () => { entered = true; });
      expect(entered).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(deadCandidate)).toBe(false);

      const liveToken = 'live-publication';
      const liveCandidate = join(fixture, storeLockCandidateName(lockName, process.pid, liveToken));
      writeFileSync(liveCandidate, `${JSON.stringify({
        version: 1,
        owner: 'live-owner',
        token: liveToken,
        pid: process.pid,
      })}\n`, { mode: 0o600 });
      linkSync(liveCandidate, lockPath);
      monotonic = 0;
      expect(() => withLock(storePath, () => {
        throw new Error('live publication exclusion was bypassed');
      })).toThrow(/Could not acquire lock/i);
      expect(lstatSync(lockPath).nlink).toBe(2);
      expect(readFileSync(lockPath, 'utf8')).toBe(readFileSync(liveCandidate, 'utf8'));
    } finally {
      setStoreLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('artifact lock recovery reclaims only a provably dead complete nlink=2 publication', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-artifact-lock-publication-'));
    const root = join(fixture, 'artifacts');
    mkdirSync(root, { mode: 0o700 });
    const key = 'same.txt';
    const lockName = artifactLockName(key);
    const lockPath = join(root, lockName);
    const deadPid = 2_147_483_647;
    const deadToken = 'dead-publication';
    const candidate = join(root, artifactLockCandidateName(lockName, deadPid, deadToken));
    writeFileSync(candidate, `${JSON.stringify({ version: 1, pid: deadPid, token: deadToken })}\n`, { mode: 0o600 });
    linkSync(candidate, lockPath);
    const artifacts = new AnchoredArtifactDirectory(root);
    let monotonic = 0;
    setAnchoredArtifactLockTestControl({
      monotonicNow: () => monotonic,
      wait: (milliseconds: number) => { monotonic += milliseconds; },
    });
    try {
      expect(() => artifacts.put(key, 'recovered-write')).not.toThrow();
      expect(readFileSync(join(root, key), 'utf8')).toBe('recovered-write');
      expect(existsSync(lockPath)).toBe(false);
      expect(existsSync(candidate)).toBe(false);

      const liveToken = 'live-publication';
      const liveCandidate = join(root, artifactLockCandidateName(lockName, process.pid, liveToken));
      writeFileSync(liveCandidate, `${JSON.stringify({ version: 1, pid: process.pid, token: liveToken })}\n`, { mode: 0o600 });
      linkSync(liveCandidate, lockPath);
      monotonic = 0;
      expect(() => artifacts.put(key, 'must-not-enter')).toThrow(/could not be acquired/i);
      expect(lstatSync(lockPath).nlink).toBe(2);
      expect(readFileSync(join(root, key), 'utf8')).toBe('recovered-write');
    } finally {
      setAnchoredArtifactLockTestControl(undefined);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('source and built production HTTP factories bind concurrent tools and resources to startup identity', async () => {
    const originalCwd = process.cwd();
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-http-factory-'));
    try {
      const sourceModule = await import('../src/mcp.js');
      const builtModule = await import('../dist/mcp-payload.js');
      for (const [index, module] of [sourceModule, builtModule].entries()) {
        const createFactory = (module as Record<string, unknown>).createMcpHttpServerFactory;
        expect(createFactory).toBeFunction();
        const projectA = join(fixture, `project-a-${index}`);
        const projectB = join(fixture, `project-b-${index}`);
        const movedA = join(fixture, `project-a-moved-${index}`);
        const homeA = join(projectA, '.hasna', 'knowledge');
        mkdirSync(homeA, { recursive: true, mode: 0o700 });
        mkdirSync(projectB);
        writeFileSync(join(homeA, 'db.json'), itemStore(`Startup project ${index}`), { mode: 0o600 });

        const factory = (createFactory as (options: unknown) => () => any)({
          surface: 'mcp-http',
          cwd: projectA,
          env: {},
          scope: 'project',
        });
        process.chdir(projectB);
        const first = factory();
        const second = factory();
        const [tool, resource] = await Promise.all([
          first._registeredTools.knowledge_inventory.handler({ scope: 'project' }),
          second._registeredResources['knowledge://project/inventory']
            .readCallback(new URL('knowledge://project/inventory')),
        ]);
        expect(tool.isError).not.toBe(true);
        expect(JSON.parse(tool.content?.[0]?.text ?? '{}').items?.[0]?.title)
          .toBe(`Startup project ${index}`);
        expect(JSON.parse(resource.contents?.[0]?.text ?? '{}').items?.[0]?.title)
          .toBe(`Startup project ${index}`);
        expect(existsSync(join(projectB, '.hasna'))).toBe(false);

        process.chdir(originalCwd);
        renameSync(projectA, movedA);
        mkdirSync(join(projectA, '.hasna', 'knowledge'), { recursive: true, mode: 0o700 });
        const replacementStore = join(projectA, '.hasna', 'knowledge', 'db.json');
        writeFileSync(replacementStore, itemStore('Replacement must stay untouched'), { mode: 0o600 });
        let revoked = false;
        try {
          const replacementServer = factory();
          const result = await replacementServer._registeredTools.knowledge_inventory.handler({ scope: 'project' });
          revoked = result.isError === true && /identity|invalid/i.test(result.content?.[0]?.text ?? '');
        } catch (error) {
          revoked = /identity|invalid/i.test(error instanceof Error ? error.message : String(error));
        }
        expect(revoked).toBe(true);
        expect(readFileSync(replacementStore, 'utf8')).toBe(itemStore('Replacement must stay untouched'));
      }
      const entrySource = readFileSync(join(repositoryRoot, 'src', 'mcp-entry.js'), 'utf8');
      expect(entrySource).toContain('createMcpHttpServerFactory');
      expect(entrySource).not.toMatch(/startMcpHttpServer\(\(\) => buildServer/);
    } finally {
      process.chdir(originalCwd);
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('global inventory requires exact-own authority across CLI, MCP, service, and generated contract', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v3-global-inventory-'));
    const project = join(fixture, 'project');
    const home = join(fixture, 'home');
    const storePath = join(fixture, 'inventory.json');
    mkdirSync(project);
    mkdirSync(home);
    writeFileSync(storePath, itemStore('Inventory item'), { mode: 0o600 });
    try {
      for (const launcher of [cli, builtCli]) {
        for (const args of [
          ['inventory', '--scope', 'global', '--json'],
          ['inventory', '--scope', 'global', '--json', '--allow-global=false'],
        ]) {
          const result = Bun.spawnSync(['bun', launcher, ...args], {
            cwd: project,
            env: sanitizedLocalTestEnv({
              HOME: home,
              USERPROFILE: home,
              BUN_CONFIG_INSTALL_AUTO: 'disable',
            }),
            stdout: 'pipe',
            stderr: 'pipe',
          });
          expect(result.exitCode).toBe(1);
          expect(new TextDecoder().decode(result.stderr)).toMatch(/global.*(?:allow-global|allowGlobal)/i);
          expect(existsSync(join(home, '.hasna'))).toBe(false);
        }
      }

      for (const createServer of [buildServer, builtBuildServer]) {
        const server = createServer({ cwd: project, env: {}, scope: 'project' });
        const inventory = (server as any)._registeredTools.knowledge_inventory;
        expect(JSON.stringify(inventory.inputSchema ?? inventory)).toContain('allow_global');
        let accessorReads = 0;
        const accessor = { scope: 'global', store_path: storePath } as Record<string, unknown>;
        Object.defineProperty(accessor, 'allow_global', {
          enumerable: true,
          get() {
            accessorReads += 1;
            return true;
          },
        });
        for (const input of [
          { scope: 'global', store_path: storePath },
          { scope: 'global', store_path: storePath, allow_global: false },
          Object.assign(Object.create({ allow_global: true }), { scope: 'global', store_path: storePath }),
          accessor,
        ]) {
          const result = await inventory.handler(input);
          expect(result.isError).toBe(true);
          expect(result.content?.[0]?.text).toMatch(/own allow_global=true/i);
        }
        expect(accessorReads).toBe(0);
        const projectResult = await inventory.handler({ scope: 'project', store_path: storePath });
        expect(projectResult.isError).not.toBe(true);
      }

      const moduleUrls = [
        new URL('../src/service.ts', import.meta.url).href,
        new URL('../dist/index.js', import.meta.url).href,
      ];
      const serviceScript = `
        const moduleUrls = ${JSON.stringify(moduleUrls)};
        let rejected = 0;
        let accessorReads = 0;
        for (const url of moduleUrls) {
          const { createKnowledgeService } = await import(url);
          const globalService = createKnowledgeService({ scope: 'global', env: {} });
          const inherited = Object.assign(Object.create({ allowGlobal: true }), { storePath: ${JSON.stringify(storePath)} });
          const accessor = { storePath: ${JSON.stringify(storePath)} };
          Object.defineProperty(accessor, 'allowGlobal', {
            enumerable: true,
            get() { accessorReads += 1; return true; },
          });
          for (const options of [
            { storePath: ${JSON.stringify(storePath)} },
            { storePath: ${JSON.stringify(storePath)}, allowGlobal: false },
            inherited,
            accessor,
          ]) {
            try {
              globalService.inventory(options);
            } catch (error) {
              if (!/explicit own allowGlobal=true/i.test(String(error?.message ?? error))) throw error;
              rejected += 1;
            }
          }
          const authorized = globalService.inventory({
            storePath: ${JSON.stringify(storePath)},
            allowGlobal: true,
          });
          if (authorized.items?.[0]?.title !== 'Inventory item') throw new Error('authorized global inventory failed');
          const projectService = createKnowledgeService({ scope: 'project', cwd: ${JSON.stringify(project)}, env: {} });
          const compatible = projectService.inventory({ storePath: ${JSON.stringify(storePath)} });
          if (compatible.items?.[0]?.title !== 'Inventory item') throw new Error('project inventory compatibility failed');
        }
        if (rejected !== 8) throw new Error('missing exact-own inventory rejections: ' + rejected);
        if (accessorReads !== 0) throw new Error('authority accessor was invoked');
      `;
      const serviceResult = Bun.spawnSync(['bun', '--eval', serviceScript], {
        cwd: project,
        env: sanitizedLocalTestEnv({
          HOME: home,
          USERPROFILE: home,
          BUN_CONFIG_INSTALL_AUTO: 'disable',
        }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(serviceResult.exitCode, new TextDecoder().decode(serviceResult.stderr)).toBe(0);

      const declaration = readFileSync(join(repositoryRoot, 'dist', 'service.d.ts'), 'utf8');
      const inventoryContract = /export interface KnowledgeInventoryOptions \{([\s\S]*?)\n\}/.exec(declaration)?.[1] ?? '';
      expect(inventoryContract).toContain('allowGlobal?: boolean;');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
