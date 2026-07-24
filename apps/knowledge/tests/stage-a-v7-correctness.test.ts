import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { setAnchoredFsTestHook } from '../src/anchored-fs.ts';
import { createKnowledgeService } from '../src/service.ts';
import { loadStore, saveStore, withLock } from '../src/store.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const sourceCli = join(repositoryRoot, 'src', 'cli.ts');
const builtCli = join(repositoryRoot, 'bin', 'knowledge.js');
const sourceStoreUrl = new URL('../src/store.ts', import.meta.url).href;

function itemStore(title: string): string {
  return `${JSON.stringify({
    items: [{
      id: `k_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      short_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      content: `${title} distinctive searchable evidence`,
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

function localEnv(home: string, overrides: Record<string, string | undefined> = {}) {
  return sanitizedLocalTestEnv({
    HOME: home,
    USERPROFILE: home,
    BUN_CONFIG_INSTALL_AUTO: 'disable',
    ...overrides,
  });
}

function runCli(
  launcher: string,
  args: string[],
  cwd: string,
  home: string,
) {
  return Bun.spawnSync(['bun', launcher, ...args], {
    cwd,
    env: localEnv(home),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function outputText(result: { stdout: Uint8Array; stderr: Uint8Array }) {
  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function copyRepository(destination: string): void {
  cpSync(repositoryRoot, destination, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
    filter(source) {
      const path = relative(repositoryRoot, source);
      if (!path) return true;
      const first = path.split(sep)[0];
      return first !== '.git'
        && first !== 'node_modules'
        && !first.startsWith('.knowledge-build-');
    },
  });
  symlinkSync(realpathSync(join(repositoryRoot, 'node_modules')), join(destination, 'node_modules'), 'dir');
}

const generatedPaths = [
  'src/generated',
  'dist',
  'bin',
  'generated-artifacts.json',
  'repository-generated-artifacts.json',
];

function generatedDigest(root: string): string {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    const stat = lstatSync(path);
    const name = relative(root, path);
    hash.update(name);
    hash.update('\0');
    hash.update(String(stat.mode & 0o777));
    hash.update('\0');
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    } else {
      hash.update(readFileSync(path));
      hash.update('\0');
    }
  };
  for (const path of generatedPaths) visit(join(root, path));
  return hash.digest('hex');
}

function copyGeneratedFixture(destination: string): void {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  cpSync(join(repositoryRoot, 'dist'), join(destination, 'dist'), { recursive: true });
  cpSync(join(repositoryRoot, 'bin'), join(destination, 'bin'), { recursive: true });
  mkdirSync(join(destination, 'src'), { recursive: true });
  cpSync(join(repositoryRoot, 'src', 'generated'), join(destination, 'src', 'generated'), {
    recursive: true,
  });
  cpSync(
    join(repositoryRoot, 'generated-artifacts.json'),
    join(destination, 'generated-artifacts.json'),
  );
  cpSync(
    join(repositoryRoot, 'repository-generated-artifacts.json'),
    join(destination, 'repository-generated-artifacts.json'),
  );
  for (const manifestName of [
    'generated-artifacts.json',
    'repository-generated-artifacts.json',
  ]) {
    const manifestPath = join(destination, manifestName);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ path: string; mode: number }>;
    };
    chmodSync(manifestPath, 0o644);
    for (const entry of manifest.files) {
      chmodSync(join(destination, entry.path), entry.mode);
    }
  }
}

function runGeneratedVerifier(root: string) {
  return Bun.spawnSync([
    'bun',
    join(repositoryRoot, 'scripts', 'verify-generated-artifacts.mjs'),
    '--root',
    root,
  ], {
    cwd: root,
    env: sanitizedLocalTestEnv({ BUN_CONFIG_INSTALL_AUTO: 'disable' }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('Stage A V7 correctness regressions', () => {
  test('public context-pack facade requires exact-own global-read authority in source and built roots', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v7-public-context-'));
    const storePath = join(fixture, 'db.json');
    writeFileSync(storePath, itemStore('Public global sentinel'), { mode: 0o600 });
    try {
      const script = `
        let accessorReads = 0;
        for (const [label, moduleUrl] of ${JSON.stringify([
          ['source', new URL('../src/index.ts', import.meta.url).href],
          ['built', new URL('../dist/index.js', import.meta.url).href],
        ])}) {
          const root = await import(moduleUrl);
          const base = {
            scope: 'global',
            dbPath: ${JSON.stringify(join(fixture, 'knowledge.db'))},
            legacyStorePath: ${JSON.stringify(storePath)},
            query: 'public global sentinel',
            source: 'search',
            maxTokens: 1200,
            maxItems: 1,
            env: {},
          };
          const inherited = Object.assign(Object.create({ allowGlobal: true }), base);
          const accessor = { ...base };
          Object.defineProperty(accessor, 'allowGlobal', {
            enumerable: true,
            get() { accessorReads += 1; return true; },
          });
          for (const [variant, options] of [
            ['missing', { ...base }],
            ['false', { ...base, allowGlobal: false }],
            ['inherited', inherited],
            ['accessor', accessor],
          ]) {
            let rejected = false;
            try { await root.buildKnowledgeAgentContextPack(options); }
            catch (error) { rejected = /global|allowGlobal|accessor/i.test(String(error?.message ?? error)); }
            if (!rejected) throw new Error(label + '/' + variant + ' bypassed global authority');
          }
          const allowed = await root.buildKnowledgeAgentContextPack({ ...base, allowGlobal: true });
          if (allowed.evidence?.[0]?.title !== 'Public global sentinel') {
            throw new Error(label + ' authorized public context pack failed');
          }
        }
        if (accessorReads !== 0) throw new Error('public allowGlobal accessor was invoked');
      `;
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: fixture,
        env: localEnv(join(fixture, 'home')),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, outputText(result).stderr).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('prompt reads share the exact-own contract across service and SDK source/built surfaces', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v7-prompt-authority-'));
    const project = join(fixture, 'project');
    const home = join(fixture, 'home');
    const globalWorkspace = join(home, '.hasna', 'knowledge');
    const projectWorkspace = join(project, '.hasna', 'knowledge');
    mkdirSync(globalWorkspace, { recursive: true, mode: 0o700 });
    mkdirSync(projectWorkspace, { recursive: true, mode: 0o700 });
    writeFileSync(join(globalWorkspace, 'db.json'), itemStore('Prompt global sentinel'), { mode: 0o600 });
    writeFileSync(join(projectWorkspace, 'db.json'), itemStore('Prompt project sentinel'), { mode: 0o600 });
    try {
      const script = `
        for (const [label, moduleUrl] of ${JSON.stringify([
          ['source', new URL('../src/index.ts', import.meta.url).href],
          ['built', new URL('../dist/index.js', import.meta.url).href],
        ])}) {
          const { KnowledgeService, createKnowledgeClient, createKnowledgeService } = await import(moduleUrl);
          const globalStore = ${JSON.stringify(join(globalWorkspace, 'db.json'))};
          const base = { prompt: 'prompt global sentinel', legacyStorePath: globalStore };
          const service = createKnowledgeService({ scope: 'global', env: {} });
          const invocations = [
            ['proxy', (options) => service.runPrompt(options)],
            ['bound', service.runPrompt.bind(service)],
            ['prototype', (options) => KnowledgeService.prototype.runPrompt.call(service, options)],
          ];
          for (const [callStyle, invoke] of invocations) {
            for (const options of [{ ...base }, { ...base, allowGlobal: false }]) {
              let rejected = false;
              try { await invoke(options); }
              catch (error) { rejected = /explicit own allowGlobal=true/i.test(String(error?.message ?? error)); }
              if (!rejected) throw new Error(label + '/' + callStyle + ' prompt bypassed authority');
            }
            const result = await invoke({ ...base, allowGlobal: true });
            if (!result.answer.includes('Prompt global sentinel')) {
              throw new Error(label + '/' + callStyle + ' authorized prompt failed');
            }
          }

          const projectService = createKnowledgeService({
            scope: 'project', cwd: ${JSON.stringify(project)}, env: {},
          });
          const projectResult = await projectService.runPrompt({
            prompt: 'prompt project sentinel',
            legacyStorePath: ${JSON.stringify(join(projectWorkspace, 'db.json'))},
          });
          if (!projectResult.answer.includes('Prompt project sentinel')) {
            throw new Error(label + ' project prompt failed');
          }

          const client = createKnowledgeClient({ scope: 'global', allowGlobal: true, env: {} });
          for (const method of ['ask', 'build']) {
            const allowed = await client[method]('prompt global sentinel', { legacyStorePath: globalStore });
            if (!allowed.answer.includes('Prompt global sentinel')) {
              throw new Error(label + '/' + method + ' constructor authority was not propagated');
            }
            let falseRejected = false;
            try {
              await client[method]('prompt global sentinel', {
                legacyStorePath: globalStore,
                allowGlobal: false,
              });
            } catch (error) {
              falseRejected = /explicit own allowGlobal=true/i.test(String(error?.message ?? error));
            }
            if (!falseRejected) throw new Error(label + '/' + method + ' ignored explicit false');

            let accessorReads = 0;
            const accessorInput = { legacyStorePath: globalStore };
            Object.defineProperty(accessorInput, 'allowGlobal', {
              enumerable: true,
              get() { accessorReads += 1; return true; },
            });
            let accessorRejected = false;
            try {
              await client[method]('prompt global sentinel', accessorInput);
            } catch (error) {
              accessorRejected = /allowGlobal|accessor|data propert/i.test(String(error?.message ?? error));
            }
            if (!accessorRejected) throw new Error(label + '/' + method + ' accepted accessor authority');
            if (accessorReads !== 0) throw new Error(label + '/' + method + ' invoked authority accessor');
          }
        }
      `;
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: project,
        env: localEnv(home),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, outputText(result).stderr).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  test('CLI export, stats, ask, and build require and propagate explicit global permission', () => {
    for (const [label, launcher] of [
      ['source', sourceCli],
      ['built', builtCli],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v7-cli-authority-${label}-`));
      const home = join(fixture, 'home');
      const workspace = join(home, '.hasna', 'knowledge');
      mkdirSync(workspace, { recursive: true, mode: 0o700 });
      writeFileSync(join(workspace, 'db.json'), itemStore('CLI global sentinel'), { mode: 0o600 });
      try {
        const commands = [
          ['export', '--scope', 'global', '--json'],
          ['stats', '--scope', 'global', '--json'],
          ['ask', 'cli global sentinel', '--scope', 'global', '--json'],
          ['build', 'cli global sentinel', '--scope', 'global', '--json'],
        ];
        for (const args of commands) {
          const denied = runCli(launcher, args, fixture, home);
          const deniedText = outputText(denied);
          expect(denied.exitCode, `${label}/${args[0]} ${deniedText.stderr}`).toBe(1);
          expect(deniedText.stderr).toMatch(/explicit own allowGlobal=true|--allow-global/i);
          expect(deniedText.stdout).not.toContain('CLI global sentinel');

          const allowed = runCli(launcher, [...args, '--allow-global'], fixture, home);
          const allowedText = outputText(allowed);
          expect(allowed.exitCode, `${label}/${args[0]} ${allowedText.stderr}`).toBe(0);
          const payload = JSON.parse(allowedText.stdout);
          if (args[0] === 'stats') expect(payload.total).toBe(1);
          else expect(allowedText.stdout).toContain('CLI global sentinel');
        }
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }, 30_000);

  test('MCP context-pack, ask, and build use project startup scope and exact authorized global scope', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v7-mcp-authority-'));
    const project = join(fixture, 'project');
    const home = join(fixture, 'home');
    const projectWorkspace = join(project, '.hasna', 'knowledge');
    const globalWorkspace = join(home, '.hasna', 'knowledge');
    mkdirSync(projectWorkspace, { recursive: true, mode: 0o700 });
    mkdirSync(globalWorkspace, { recursive: true, mode: 0o700 });
    writeFileSync(join(projectWorkspace, 'db.json'), itemStore('MCP project sentinel'), { mode: 0o600 });
    writeFileSync(join(globalWorkspace, 'db.json'), itemStore('MCP global sentinel'), { mode: 0o600 });
    try {
      const script = `
        const modules = ${JSON.stringify([
          ['source', new URL('../src/mcp.js', import.meta.url).href],
          ['built', new URL('../dist/mcp-payload.js', import.meta.url).href],
        ])};
        const text = (result) => result.content?.[0]?.text ?? '';
        for (const [label, moduleUrl] of modules) {
          const { buildServer } = await import(moduleUrl);
          const server = buildServer({ cwd: ${JSON.stringify(project)}, scope: 'project', env: {} });
          const tools = server._registeredTools;
          for (const [name, projectInput, globalInput] of [
            [
              'knowledge_context_pack',
              { query: 'mcp project sentinel', from: 'search', max_items: 1 },
              { scope: 'global', query: 'mcp global sentinel', from: 'search', max_items: 1 },
            ],
            [
              'knowledge_ask',
              { prompt: 'mcp project sentinel' },
              { scope: 'global', prompt: 'mcp global sentinel' },
            ],
            [
              'knowledge_build',
              { prompt: 'mcp project sentinel' },
              { scope: 'global', prompt: 'mcp global sentinel' },
            ],
          ]) {
            const tool = tools?.[name];
            if (!tool) throw new Error(label + '/' + name + ' is not registered');
            if (!JSON.stringify(tool.inputSchema ?? tool).includes('allow_global')) {
              throw new Error(label + '/' + name + ' omits allow_global');
            }
            const projectResult = await tool.handler(projectInput);
            if (projectResult.isError || !text(projectResult).includes('MCP project sentinel')) {
              throw new Error(label + '/' + name + ' did not use project startup scope: ' + text(projectResult));
            }

            let accessorReads = 0;
            const inherited = Object.assign(Object.create({ allow_global: true }), globalInput);
            const accessor = { ...globalInput };
            Object.defineProperty(accessor, 'allow_global', {
              enumerable: true,
              get() { accessorReads += 1; return true; },
            });
            for (const input of [
              { ...globalInput },
              { ...globalInput, allow_global: false },
              inherited,
              accessor,
            ]) {
              const denied = await tool.handler(input);
              if (!denied.isError || !/own allow_global=true/i.test(text(denied))) {
                throw new Error(label + '/' + name + ' accepted unauthorized global input');
              }
            }
            if (accessorReads !== 0) throw new Error(label + '/' + name + ' invoked authority accessor');
            const allowed = await tool.handler({ ...globalInput, allow_global: true });
            if (allowed.isError || !text(allowed).includes('MCP global sentinel')) {
              throw new Error(label + '/' + name + ' rejected authorized global input: ' + text(allowed));
            }
          }
        }
      `;
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: project,
        env: localEnv(home),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, outputText(result).stderr).toBe(0);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  test('inventory retries a bounded identity race and remains consistent under ordinary concurrent writers', async () => {
    const deterministic = mkdtempSync(join(tmpdir(), 'knowledge-v7-inventory-race-'));
    const deterministicStore = join(deterministic, 'db.json');
    writeFileSync(deterministicStore, itemStore('Inventory first generation'), { mode: 0o600 });
    const service = createKnowledgeService({ scope: 'project', cwd: deterministic, env: {} } as never);
    let injected = false;
    setAnchoredFsTestHook((event, detail) => {
      if (event !== 'snapshot-after-read' || detail !== deterministicStore || injected) return;
      injected = true;
      setAnchoredFsTestHook(undefined);
      withLock(deterministicStore, () => {
        const store = loadStore(deterministicStore);
        store.items.push({
          id: 'k_inventory_second_generation',
          short_id: 'inventory-second',
          title: 'Inventory second generation',
          content: 'second generation content',
          url: null,
          tags: [],
          archived: false,
          created_at: '2026-07-19T00:00:01.000Z',
          updated_at: '2026-07-19T00:00:01.000Z',
        });
        saveStore(deterministicStore, store);
      });
    });
    try {
      const result = service.inventory({ storePath: deterministicStore });
      expect(injected).toBe(true);
      expect(result.summary.legacy_items).toBe(2);
      expect(result.legacy_store.total_items).toBe(2);
      expect(result.items).toHaveLength(2);
    } finally {
      setAnchoredFsTestHook(undefined);
      rmSync(deterministic, { recursive: true, force: true });
    }

    for (const [label, moduleUrl] of [
      ['source', new URL('../src/index.ts', import.meta.url).href],
      ['built', new URL('../dist/index.js', import.meta.url).href],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v7-inventory-stress-${label}-`));
      const storePath = join(fixture, 'db.json');
      writeFileSync(storePath, itemStore('Inventory seed'), { mode: 0o600 });
      const writerScript = `
        const { loadStore, saveStore, withLock } = await import(${JSON.stringify(sourceStoreUrl)});
        process.stdout.write('ready\\n');
        await Bun.stdin.text();
        for (let index = 0; index < 96; index += 1) {
          withLock(${JSON.stringify(storePath)}, () => {
            const store = loadStore(${JSON.stringify(storePath)});
            store.items.push({
              id: 'k_writer_' + index,
              short_id: 'writer-' + index,
              title: 'Writer ' + index,
              content: 'ordinary concurrent writer ' + index,
              url: null,
              tags: [],
              archived: false,
              created_at: new Date(1_000 + index).toISOString(),
              updated_at: new Date(1_000 + index).toISOString(),
            });
            saveStore(${JSON.stringify(storePath)}, store);
          });
        }
      `;
      const writer = Bun.spawn(['bun', '--eval', writerScript], {
        cwd: fixture,
        env: localEnv(join(fixture, 'home')),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const reader = writer.stdout.getReader();
        const ready = await reader.read();
        reader.releaseLock();
        expect(new TextDecoder().decode(ready.value)).toContain('ready');
        writer.stdin.write('go');
        writer.stdin.end();

        const { createKnowledgeService: createService } = await import(moduleUrl);
        const inventoryService = createService({ scope: 'project', cwd: fixture, env: {} });
        for (let index = 0; index < 512; index += 1) {
          const snapshot = inventoryService.inventory({ storePath, limit: 200 });
          expect(snapshot.summary.legacy_items).toBe(snapshot.legacy_store.total_items);
          expect(snapshot.items.length).toBeLessThanOrEqual(snapshot.summary.legacy_items);
        }
        const exitCode = await writer.exited;
        const stderr = await new Response(writer.stderr).text();
        expect(exitCode, stderr).toBe(0);
        expect(loadStore(storePath).items).toHaveLength(97);
      } finally {
        writer.kill();
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }, 60_000);

  test('generated verifier rejects descriptor, root, artifact alias, link, and special-file matrix', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'knowledge-v7-generated-aliases-'));
    const expectRejected = (label: string, mutate: (root: string) => void) => {
      const fixture = join(parent, label);
      copyGeneratedFixture(fixture);
      expect(runGeneratedVerifier(fixture).exitCode, `${label} baseline`).toBe(0);
      mutate(fixture);
      const result = runGeneratedVerifier(fixture);
      expect(result.exitCode, `${label} unexpectedly verified`).not.toBe(0);
    };
    try {
      expectRejected('manifest-symlink', (root) => {
        const path = join(root, 'generated-artifacts.json');
        const target = `${path}.real`;
        renameSync(path, target);
        symlinkSync(basename(target), path);
      });
      expectRejected('manifest-hardlink', (root) => {
        const path = join(root, 'generated-artifacts.json');
        const target = `${path}.real`;
        renameSync(path, target);
        linkSync(target, path);
      });
      expectRejected('repository-manifest-hardlink', (root) => {
        const path = join(root, 'repository-generated-artifacts.json');
        const target = `${path}.real`;
        renameSync(path, target);
        linkSync(target, path);
      });
      expectRejected('artifact-hardlink', (root) => {
        const path = join(root, 'dist', 'index.d.ts');
        const target = `${path}.real`;
        renameSync(path, target);
        linkSync(target, path);
      });
      expectRejected('artifact-symlink', (root) => {
        const path = join(root, 'dist', 'index.d.ts');
        const target = `${path}.real`;
        renameSync(path, target);
        symlinkSync(basename(target), path);
      });
      expectRejected('artifact-fifo', (root) => {
        const path = join(root, 'dist', 'index.d.ts');
        unlinkSync(path);
        const fifo = Bun.spawnSync(['mkfifo', path], { stdout: 'pipe', stderr: 'pipe' });
        if (fifo.exitCode !== 0) throw new Error(outputText(fifo).stderr);
      });

      const realRoot = join(parent, 'root-real');
      const aliasRoot = join(parent, 'root-alias');
      copyGeneratedFixture(realRoot);
      symlinkSync(basename(realRoot), aliasRoot, 'dir');
      expect(runGeneratedVerifier(aliasRoot).exitCode).not.toBe(0);

      const fifoRoot = join(parent, 'manifest-fifo');
      copyGeneratedFixture(fifoRoot);
      const manifest = join(fifoRoot, 'generated-artifacts.json');
      const source = `${manifest}.source`;
      renameSync(manifest, source);
      const fifo = Bun.spawnSync(['mkfifo', manifest], { stdout: 'pipe', stderr: 'pipe' });
      expect(fifo.exitCode, outputText(fifo).stderr).toBe(0);
      const writer = Bun.spawn([
        'bun', '--eval',
        `await Bun.write(${JSON.stringify(manifest)}, await Bun.file(${JSON.stringify(source)}).arrayBuffer());`,
      ], {
        cwd: fifoRoot,
        env: localEnv(join(fifoRoot, 'home')),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        expect(runGeneratedVerifier(fifoRoot).exitCode).not.toBe(0);
      } finally {
        writer.kill();
        await writer.exited;
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 30_000);

  test('default source and built CLI errors are stable and path-sanitized', () => {
    const outputs: string[] = [];
    for (const [label, launcher] of [
      ['source', sourceCli],
      ['built', builtCli],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v7-cli-errors-${label}-`));
      try {
        const result = runCli(launcher, ['--private-unknown-flag'], fixture, join(fixture, 'home'));
        const { stderr } = outputText(result);
        expect(result.exitCode).toBe(1);
        expect(stderr).not.toContain(fixture);
        expect(stderr).not.toContain(repositoryRoot);
        expect(stderr).not.toMatch(/\bat (?:file:\/\/)?\//);
        expect(stderr.trim().split('\n')).toEqual([
          "[ERROR] CLI error {\"message\":\"Unknown flag: --private-unknown-flag. Run 'knowledge --help' for valid options.\"}",
          "Error: Unknown flag: --private-unknown-flag. Run 'knowledge --help' for valid options.",
        ]);
        outputs.push(stderr);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
    expect(outputs[0]).toBe(outputs[1]);
  });

  test('project-panel forwards project/local/global scope and requires explicit global permission', () => {
    for (const [label, launcher] of [
      ['source', sourceCli],
      ['built', builtCli],
    ] as const) {
      const fixture = mkdtempSync(join(tmpdir(), `knowledge-v7-project-panel-${label}-`));
      const project = join(fixture, 'project');
      const home = join(fixture, 'home');
      const projectWorkspace = join(project, '.hasna', 'knowledge');
      const globalWorkspace = join(home, '.hasna', 'knowledge');
      mkdirSync(projectWorkspace, { recursive: true, mode: 0o700 });
      mkdirSync(globalWorkspace, { recursive: true, mode: 0o700 });
      writeFileSync(join(projectWorkspace, 'db.json'), itemStore('Panel project sentinel'), { mode: 0o600 });
      writeFileSync(join(globalWorkspace, 'db.json'), itemStore('Panel global sentinel'), { mode: 0o600 });
      try {
        for (const [scope, expected] of [
          ['project', 'Panel project sentinel'],
          ['local', 'Panel project sentinel'],
          ['global', 'Panel global sentinel'],
        ] as const) {
          const args = [
            'project-panel', '--project', 'scope-matrix', '--scope', scope, '--json',
            ...(scope === 'global' ? ['--allow-global'] : []),
          ];
          const result = runCli(launcher, args, project, home);
          const text = outputText(result);
          expect(result.exitCode, `${label}/${scope} ${text.stderr}`).toBe(0);
          const panel = JSON.parse(text.stdout);
          expect(panel.metadata.scope).toBe(scope);
          expect(panel.items[0]?.title).toBe(expected);
        }
        const denied = runCli(launcher, [
          'project-panel', '--project', 'scope-matrix', '--scope', 'global', '--json',
        ], project, home);
        expect(denied.exitCode).toBe(1);
        expect(outputText(denied).stderr).toMatch(/explicit own allowGlobal=true|--allow-global/i);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('build recovers deterministically after termination at every replacement sub-boundary', () => {
    const parent = mkdtempSync(join(tmpdir(), 'knowledge-v7-build-recovery-'));
    const workspace = join(parent, 'workspace');
    copyRepository(workspace);
    try {
      const before = generatedDigest(workspace);
      const events = [
        ...Array.from({ length: 5 }, (_, index) => `after-backup-${index + 1}`),
        ...Array.from({ length: 5 }, (_, index) => `replace-${index + 1}`),
      ];
      for (const event of events) {
        const interrupted = Bun.spawnSync(['bun', 'scripts/build.mjs'], {
          cwd: workspace,
          env: localEnv(join(parent, 'home'), {
            KNOWLEDGE_BUILD_INJECT_TERMINATION: event,
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(interrupted.exitCode, `${event} did not terminate abruptly`).not.toBe(0);
        expect(readdirSync(workspace).some((entry) => entry.startsWith('.knowledge-build-'))).toBe(true);

        const recovered = Bun.spawnSync(['bun', 'scripts/build.mjs'], {
          cwd: workspace,
          env: localEnv(join(parent, 'home')),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(recovered.exitCode, `${event}: ${outputText(recovered).stderr}`).toBe(0);
        const verified = runGeneratedVerifier(workspace);
        expect(verified.exitCode, `${event}: ${outputText(verified).stderr}`).toBe(0);
        expect(generatedDigest(workspace), event).toBe(before);
        expect(readdirSync(workspace).filter((entry) => entry.startsWith('.knowledge-build-')))
          .toEqual([]);
      }
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  }, 180_000);
});
