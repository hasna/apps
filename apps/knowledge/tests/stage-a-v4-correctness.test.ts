import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  AnchoredArtifactDirectory,
  setAnchoredFsTestHook,
} from '../src/anchored-fs.ts';
import { LocalArtifactStore as SourceLocalArtifactStore } from '../src/artifact-store.ts';
import {
  LocalArtifactStore as BuiltLocalArtifactStore,
} from '../dist/index.js';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const sourceCli = join(repositoryRoot, 'src', 'cli.ts');
const builtCli = join(repositoryRoot, 'bin', 'knowledge.js');

function itemStore(title: string): string {
  return `${JSON.stringify({
    items: [{
      id: `k_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      short_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      content: `${title} searchable content`,
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

function previousArtifactName(target: string): string {
  const digest = createHash('sha256').update(target).digest('hex');
  return `.knowledge-artifact-previous-${digest}`;
}

function fdCount(): number {
  return readdirSync('/proc/self/fd').length;
}

describe('Stage A V4 accepted correctness regressions', () => {
  test('the concrete source and built inventory method enforces exact-own global authority', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v4-inventory-boundary-'));
    const storePath = join(fixture, 'inventory.json');
    writeFileSync(storePath, itemStore('Prototype inventory'), { mode: 0o600 });
    try {
      for (const [index, moduleUrl] of [
        new URL('../src/index.ts', import.meta.url).href,
        new URL('../dist/index.js', import.meta.url).href,
      ].entries()) {
        const home = join(fixture, `home-${index}`);
        const displacedHome = join(fixture, `home-${index}-displaced`);
        mkdirSync(home);
        const env = sanitizedLocalTestEnv({
          HOME: home,
          USERPROFILE: home,
          BUN_CONFIG_INSTALL_AUTO: 'disable',
        });
        const script = `
          const { mkdirSync, renameSync } = await import('node:fs');
          const { KnowledgeService, createKnowledgeService } = await import(${JSON.stringify(moduleUrl)});
          const service = createKnowledgeService({ scope: 'global', env: process.env });
          const invocations = [
            ['proxy', (options) => service.inventory(options)],
            ['bound', service.inventory.bind(service)],
            ['direct', (options) => Reflect.apply(service.inventory, service, [options])],
            ['prototype', (options) => KnowledgeService.prototype.inventory.call(service, options)],
          ];
          for (const [label, invoke] of invocations) {
            for (const options of [
              { storePath: ${JSON.stringify(storePath)} },
              { storePath: ${JSON.stringify(storePath)}, allowGlobal: false },
            ]) {
              let rejected = false;
              try { invoke(options); }
              catch (error) { rejected = /explicit own allowGlobal=true/i.test(String(error?.message ?? error)); }
              if (!rejected) throw new Error(label + ' inventory bypassed global authority');
            }
            const authorized = invoke({
              storePath: ${JSON.stringify(storePath)},
              allowGlobal: true,
            });
            if (authorized.items?.[0]?.title !== 'Prototype inventory') {
              throw new Error(label + ' authorized inventory failed');
            }
          }
          renameSync(${JSON.stringify(home)}, ${JSON.stringify(displacedHome)});
          mkdirSync(${JSON.stringify(home)});
          let authorityFirst = false;
          try { KnowledgeService.prototype.inventory.call(service, { storePath: ${JSON.stringify(storePath)} }); }
          catch (error) { authorityFirst = /explicit own allowGlobal=true/i.test(String(error?.message ?? error)); }
          if (!authorityFirst) throw new Error('workspace revalidation ran before concrete inventory authority');
          let workspaceRejected = false;
          try {
            KnowledgeService.prototype.inventory.call(service, {
              storePath: ${JSON.stringify(storePath)},
              allowGlobal: true,
            });
          } catch (error) {
            workspaceRejected = /workspace|identity|invalidated/i.test(String(error?.message ?? error));
          }
          if (!workspaceRejected) throw new Error('authorized prototype inventory bypassed workspace revalidation');
        `;
        const result = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('source and built artifact traversal close descriptors on repeated validation rejection', async () => {
    for (const [label, Store] of [
      ['source', SourceLocalArtifactStore],
      ['built', BuiltLocalArtifactStore],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v4-fd-${label}-`));
      const root = join(fixture, 'artifacts');
      const nested = join(root, 'nested');
      mkdirSync(nested, { recursive: true, mode: 0o700 });
      chmodSync(nested, 0o755);
      const store = new Store(root);
      try {
        const before = fdCount();
        for (let index = 0; index < 16; index += 1) {
          await expect(store.exists('nested/missing.txt')).rejects.toThrow();
        }
        const after = fdCount();
        expect(after - before, `${label} leaked descriptors`).toBeLessThanOrEqual(1);

        chmodSync(nested, 0o700);
        const displaced = join(fixture, 'artifacts-displaced');
        const replacement = join(fixture, 'artifacts');
        const { renameSync } = await import('node:fs');
        renameSync(root, displaced);
        mkdirSync(replacement, { mode: 0o700 });
        const beforeRootRejections = fdCount();
        for (let index = 0; index < 16; index += 1) {
          await expect(store.exists('missing.txt')).rejects.toThrow();
        }
        const afterRootRejections = fdCount();
        expect(afterRootRejections - beforeRootRejections, `${label} leaked root descriptors`)
          .toBeLessThanOrEqual(1);
      } finally {
        if (existsSync(nested)) chmodSync(nested, 0o700);
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('source crash recovery supports replacement of a two-link canonical artifact', () => {
    const moduleUrl = new URL('../src/anchored-fs.ts', import.meta.url).href;
    for (const [event, exitCode, expectedAtCrash] of [
      ['artifact-before-atomic-install', 91, 'prior-generation'],
      ['artifact-before-final-verify', 92, 'committed-generation'],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v4-two-link-${event}-`));
      const root = join(fixture, 'artifacts');
      const outside = join(fixture, 'outside.txt');
      const target = join(root, 'target.txt');
      const backup = join(root, previousArtifactName('target.txt'));
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(outside, 'prior-generation', { mode: 0o600 });
      linkSync(outside, target);
      const script = `
        const { AnchoredArtifactDirectory, setAnchoredFsTestHook } = await import(${JSON.stringify(moduleUrl)});
        const artifacts = new AnchoredArtifactDirectory(${JSON.stringify(root)});
        setAnchoredFsTestHook((observed, detail) => {
          if (observed === ${JSON.stringify(event)} && detail === 'target.txt') process.exit(${exitCode});
        });
        artifacts.put('target.txt', 'committed-generation');
      `;
      try {
        const crashed = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(crashed.exitCode, new TextDecoder().decode(crashed.stderr)).toBe(exitCode);
        expect(readFileSync(target, 'utf8')).toBe(expectedAtCrash);
        expect(readFileSync(outside, 'utf8')).toBe('prior-generation');
        expect(existsSync(backup)).toBe(true);

        const artifacts = new AnchoredArtifactDirectory(root);
        expect(() => artifacts.put('target.txt', 'recovered-generation')).not.toThrow();
        expect(readFileSync(target, 'utf8')).toBe('recovered-generation');
        expect(readFileSync(outside, 'utf8')).toBe('prior-generation');
        expect(lstatSync(target).nlink).toBe(1);
        expect(lstatSync(outside).nlink).toBe(1);
        expect(existsSync(backup)).toBe(false);
        expect(readdirSync(root).filter((name) => name.startsWith('.knowledge-tmp-'))).toEqual([]);
      } finally {
        setAnchoredFsTestHook(undefined);
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('built crash hooks support both two-link artifact interruption states', async () => {
    const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
    for (const [transition, exitCode, expectedAtCrash] of [
      ['before-install', 93, 'prior-generation'],
      ['before-final-verify', 94, 'committed-generation'],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v4-built-two-link-${transition}-`));
      const root = join(fixture, 'artifacts');
      const outside = join(fixture, 'outside.txt');
      const target = join(root, 'target.txt');
      const backup = join(root, previousArtifactName('target.txt'));
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(outside, 'prior-generation', { mode: 0o600 });
      linkSync(outside, target);
      const script = `
        const { mock } = await import('bun:test');
        const realFs = await import('node:fs');
        const nativeRenameSync = realFs.renameSync;
        const nativeFsyncSync = realFs.fsyncSync;
        let installed = false;
        mock.module('fs', () => ({
          ...realFs,
          renameSync(source, destination) {
            const isInstall = String(destination).endsWith('/target.txt')
              && String(source).includes('.knowledge-tmp-');
            if (isInstall && ${JSON.stringify(transition)} === 'before-install') {
              process.exit(${exitCode});
            }
            const result = nativeRenameSync(source, destination);
            if (isInstall) installed = true;
            return result;
          },
          fsyncSync(fd) {
            const result = nativeFsyncSync(fd);
            if (installed && ${JSON.stringify(transition)} === 'before-final-verify') {
              process.exit(${exitCode});
            }
            return result;
          },
        }));
        const { LocalArtifactStore } = await import(${JSON.stringify(moduleUrl)});
        const store = new LocalArtifactStore(${JSON.stringify(root)});
        await store.put({ key: 'target.txt', body: 'committed-generation' });
        throw new Error('built interruption hook did not fire');
      `;
      try {
        const crashed = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(crashed.exitCode, new TextDecoder().decode(crashed.stderr)).toBe(exitCode);
        expect(readFileSync(target, 'utf8')).toBe(expectedAtCrash);
        expect(readFileSync(outside, 'utf8')).toBe('prior-generation');
        expect(existsSync(backup)).toBe(true);

        const store = new BuiltLocalArtifactStore(root);
        await expect(store.put({ key: 'target.txt', body: 'recovered-generation' })).resolves.toMatchObject({
          key: 'target.txt',
        });
        expect(readFileSync(target, 'utf8')).toBe('recovered-generation');
        expect(readFileSync(outside, 'utf8')).toBe('prior-generation');
        expect(lstatSync(target).nlink).toBe(1);
        expect(lstatSync(outside).nlink).toBe(1);
        expect(existsSync(backup)).toBe(false);
        expect(readdirSync(root).filter((name) => name.startsWith('.knowledge-tmp-'))).toEqual([]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('source and built replacement reject unmodeled three-link canonical artifacts', async () => {
    for (const [label, Store] of [
      ['source', SourceLocalArtifactStore],
      ['built', BuiltLocalArtifactStore],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v4-three-link-${label}-`));
      const root = join(fixture, 'artifacts');
      const outsideA = join(fixture, 'outside-a.txt');
      const outsideB = join(fixture, 'outside-b.txt');
      const target = join(root, 'target.txt');
      mkdirSync(root, { mode: 0o700 });
      writeFileSync(outsideA, 'unchanged', { mode: 0o600 });
      linkSync(outsideA, outsideB);
      linkSync(outsideA, target);
      const store = new Store(root);
      try {
        await expect(store.put({ key: 'target.txt', body: 'must-not-install' })).rejects.toThrow();
        expect(readFileSync(target, 'utf8')).toBe('unchanged');
        expect(readFileSync(outsideA, 'utf8')).toBe('unchanged');
        expect(readFileSync(outsideB, 'utf8')).toBe('unchanged');
        expect(lstatSync(target).nlink).toBe(3);
        expect(readdirSync(root)).toEqual(['target.txt']);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('project MCP and explicit-store SDK/CLI do not depend on an unrelated HOME', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v4-missing-home-'));
    const project = join(fixture, 'project');
    const missingHome = join(fixture, 'missing-home');
    const storePath = join(fixture, 'explicit-store.json');
    mkdirSync(project);
    writeFileSync(storePath, itemStore('Selected store'), { mode: 0o600 });
    const env = sanitizedLocalTestEnv({
      HOME: missingHome,
      USERPROFILE: missingHome,
      BUN_INSTALL: join(fixture, 'bun-install'),
      BUN_INSTALL_CACHE_DIR: join(fixture, 'bun-cache'),
      XDG_CACHE_HOME: join(fixture, 'xdg-cache'),
      BUN_CONFIG_INSTALL_AUTO: 'disable',
    });
    try {
      for (const moduleUrl of [
        new URL('../src/mcp.js', import.meta.url).href,
        new URL('../dist/mcp-payload.js', import.meta.url).href,
      ]) {
        const script = `
          const { buildServer } = await import(${JSON.stringify(moduleUrl)});
          const server = buildServer({ cwd: ${JSON.stringify(project)}, scope: 'project', env: {} });
          const inventory = server._registeredTools?.knowledge_inventory;
          if (!inventory) throw new Error('project MCP tool registration missing');
          const result = await inventory.handler({ scope: 'project', store_path: ${JSON.stringify(storePath)} });
          if (result.isError) throw new Error(result.content?.[0]?.text ?? 'project MCP inventory failed');
          const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
          if (payload.items?.[0]?.title !== 'Selected store') throw new Error('project MCP selected the wrong store');
        `;
        const result = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      }

      for (const moduleUrl of [
        new URL('../src/index.ts', import.meta.url).href,
        new URL('../dist/index.js', import.meta.url).href,
      ]) {
        const script = `
          const { createKnowledgeClient } = await import(${JSON.stringify(moduleUrl)});
          const client = createKnowledgeClient({ scope: 'global', allowGlobal: true, env: {} });
          const result = client.inventory({ storePath: ${JSON.stringify(storePath)} });
          if (result.items?.[0]?.title !== 'Selected store') throw new Error('explicit SDK store was not selected');
          let falseRejected = false;
          try { client.inventory({ storePath: ${JSON.stringify(storePath)}, allowGlobal: false }); }
          catch (error) { falseRejected = /explicit own allowGlobal=true/i.test(String(error?.message ?? error)); }
          if (!falseRejected) throw new Error('explicit SDK inventory authority override was ignored');
        `;
        const result = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      }

      for (const launcher of [sourceCli, builtCli]) {
        for (const args of [
          ['add', 'CLI selected', 'Explicit store', '--store', storePath, '--json'],
          ['list', '--store', storePath, '--allow-global', '--json'],
          ['upsert', '--store', storePath, '--id', 'selected', '--title', 'Selected', '--content', 'Updated', '--json'],
        ]) {
          const result = Bun.spawnSync(['bun', launcher, ...args], {
            cwd: project,
            env,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
        }
      }
      expect(existsSync(missingHome)).toBe(false);
      expect(existsSync(join(project, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('README global read examples match executable source and built CLI contracts', () => {
    const readme = readFileSync(join(repositoryRoot, 'README.md'), 'utf8');
    const documented = [
      'knowledge list --scope global --allow-global --json',
      'knowledge inventory --scope global --allow-global --json',
      'knowledge get --id <id> --scope global --allow-global --json',
      'knowledge search <query> --scope global --allow-global --json',
    ];
    for (const command of documented) expect(readme).toContain(command);
    expect(readme).toMatch(/\| `--allow-global` \|[^\n]+global/i);

    for (const [label, launcher] of [
      ['source', sourceCli],
      ['built', builtCli],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v4-docs-${label}-`));
      const home = join(fixture, 'home');
      const workspace = join(home, '.hasna', 'knowledge');
      const id = 'k_documented_global';
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      writeFileSync(join(workspace, 'db.json'), itemStore('Documented global'), { mode: 0o600 });
      const env = sanitizedLocalTestEnv({
        HOME: home,
        USERPROFILE: home,
        BUN_CONFIG_INSTALL_AUTO: 'disable',
      });
      try {
        const globalHelp = Bun.spawnSync(['bun', launcher, '--help'], {
          cwd: fixture,
          env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(globalHelp.exitCode, new TextDecoder().decode(globalHelp.stderr)).toBe(0);
        expect(new TextDecoder().decode(globalHelp.stdout)).toContain('--allow-global');

        for (const command of ['list', 'inventory', 'get', 'search']) {
          const commandHelp = Bun.spawnSync(['bun', launcher, 'help', command], {
            cwd: fixture,
            env,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          expect(commandHelp.exitCode, new TextDecoder().decode(commandHelp.stderr)).toBe(0);
          expect(new TextDecoder().decode(commandHelp.stdout)).toContain('--allow-global');
        }

        for (const args of [
          ['list', '--scope', 'global', '--allow-global', '--json'],
          ['inventory', '--scope', 'global', '--allow-global', '--json'],
          ['get', '--id', id, '--scope', 'global', '--allow-global', '--json'],
          ['search', 'searchable', '--scope', 'global', '--allow-global', '--json'],
        ]) {
          const result = Bun.spawnSync(['bun', launcher, ...args], {
            cwd: fixture,
            env,
            stdout: 'pipe',
            stderr: 'pipe',
          });
          expect(result.exitCode, `${label}: ${new TextDecoder().decode(result.stderr)}`).toBe(0);
        }
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });
});
