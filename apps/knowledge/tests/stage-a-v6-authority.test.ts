import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const repositoryRoot = join(import.meta.dir, '..');
const sourceCli = join(repositoryRoot, 'src', 'cli.ts');
const builtCli = join(repositoryRoot, 'bin', 'knowledge.js');

function itemStore(title: string, content = `${title} evidence`): string {
  return `${JSON.stringify({
    items: [{
      id: `k_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      short_id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      content,
      url: null,
      tags: [],
      archived: false,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
    }],
  }, null, 2)}\n`;
}

function localEnv(home: string): Record<string, string> {
  return sanitizedLocalTestEnv({
    HOME: home,
    USERPROFILE: home,
    BUN_CONFIG_INSTALL_AUTO: 'disable',
    CI: '1',
  });
}

function text(bytes: Uint8Array | undefined): string {
  return new TextDecoder().decode(bytes);
}

function runCli(
  launcher: string,
  args: string[],
  cwd: string,
  home: string,
  overrides: Record<string, string | undefined> = {},
) {
  return Bun.spawnSync(['bun', launcher, ...args], {
    cwd,
    env: { ...localEnv(home), ...overrides },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function writeGlobalStore(home: string, title: string): string {
  const workspace = join(home, '.hasna', 'knowledge');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  chmodSync(join(home, '.hasna'), 0o700);
  chmodSync(workspace, 0o700);
  const storePath = join(workspace, 'db.json');
  writeFileSync(storePath, itemStore(title), { mode: 0o600 });
  return storePath;
}

describe('Stage A V6 authority and scope regressions', () => {
  test('V6-1 public root context pack requires exact-own global-read authority in source and built output', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-root-context-'));
    const storePath = join(fixture, 'db.json');
    writeFileSync(storePath, itemStore('V6 ROOT GLOBAL SENTINEL'), { mode: 0o600 });
    const bypasses: string[] = [];
    let accessorReads = 0;
    try {
      for (const [surface, moduleUrl] of [
        ['source', new URL('../src/index.ts', import.meta.url).href],
        ['built', new URL('../dist/index.js', import.meta.url).href],
      ] as const) {
        const root = await import(moduleUrl);
        const fn = root.buildKnowledgeAgentContextPack;
        const base = {
          scope: 'global',
          dbPath: join(fixture, `${surface}.db`),
          legacyStorePath: storePath,
          query: 'V6 ROOT GLOBAL SENTINEL',
          source: 'search',
          maxTokens: 1200,
          maxItems: 1,
          env: {},
        };
        const invocations = [
          ['normal', (options: Record<string, unknown>) => fn(options)],
          ['bound', fn.bind(Object.freeze({ receiver: surface }))],
          ['direct', (options: Record<string, unknown>) => Reflect.apply(fn, Object.freeze({ receiver: surface }), [options])],
        ] as const;
        for (const [style, invoke] of invocations) {
          const inherited = Object.assign(Object.create({ allowGlobal: true }), base);
          const accessor = { ...base };
          Object.defineProperty(accessor, 'allowGlobal', {
            enumerable: true,
            get() {
              accessorReads += 1;
              return true;
            },
          });
          for (const [variant, options] of [
            ['missing', { ...base }],
            ['false', { ...base, allowGlobal: false }],
            ['inherited', inherited],
            ['accessor', accessor],
          ] as const) {
            try {
              const pack = await invoke(options);
              if (pack.evidence?.[0]?.title === 'V6 ROOT GLOBAL SENTINEL') {
                bypasses.push(`${surface}/${style}/${variant}=READ`);
              } else {
                bypasses.push(`${surface}/${style}/${variant}=CALL`);
              }
            } catch (error) {
              expect(String((error as Error)?.message ?? error)).toMatch(/explicit own allowGlobal=true|accessor/i);
            }
          }
          const authorized = await invoke({ ...base, allowGlobal: true });
          expect(authorized.evidence?.[0]?.title).toBe('V6 ROOT GLOBAL SENTINEL');
        }
      }
      expect(accessorReads).toBe(0);
      expect(bypasses).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('V6-2 CLI export and stats deny global reads unless --allow-global is present', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-cli-export-stats-'));
    const bypasses: string[] = [];
    try {
      for (const [surface, launcher] of [
        ['source', sourceCli],
        ['built', builtCli],
      ] as const) {
        const home = join(fixture, `home-${surface}`);
        mkdirSync(home, { mode: 0o700 });
        writeGlobalStore(home, 'V6 CLI GLOBAL SENTINEL');
        for (const command of ['export', 'stats'] as const) {
          const denied = runCli(launcher, [command, '--scope', 'global', '--json'], fixture, home);
          const combined = `${text(denied.stdout)}\n${text(denied.stderr)}`;
          if (denied.exitCode === 0 || combined.includes('V6 CLI GLOBAL SENTINEL')) {
            bypasses.push(`${surface}/${command}/missing`);
          } else {
            expect(combined).toMatch(/allowGlobal=true|allow-global/i);
          }
          const authorized = runCli(
            launcher,
            [command, '--scope', 'global', '--allow-global', '--json'],
            fixture,
            home,
          );
          expect(authorized.exitCode, text(authorized.stderr)).toBe(0);
          if (command === 'export') {
            expect(text(authorized.stdout)).toContain('V6 CLI GLOBAL SENTINEL');
          } else {
            expect(JSON.parse(text(authorized.stdout)).total).toBe(1);
          }
        }
      }
      expect(bypasses).toEqual([]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('V6-3 service runPrompt plus SDK, CLI, and MCP ask/build share global-read authority', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-prompt-authority-'));
    try {
      for (const [surface, rootUrl, mcpUrl, launcher] of [
        [
          'source',
          new URL('../src/index.ts', import.meta.url).href,
          new URL('../src/mcp.js', import.meta.url).href,
          sourceCli,
        ],
        [
          'built',
          new URL('../dist/index.js', import.meta.url).href,
          new URL('../dist/mcp-payload.js', import.meta.url).href,
          builtCli,
        ],
      ] as const) {
        const home = join(fixture, `home-${surface}`);
        const project = join(fixture, `project-${surface}`);
        mkdirSync(home, { mode: 0o700 });
        mkdirSync(project, { mode: 0o700 });
        const globalStore = writeGlobalStore(home, 'V6 PROMPT GLOBAL SENTINEL');
        const projectStore = join(project, '.hasna', 'knowledge', 'db.json');
        mkdirSync(join(project, '.hasna', 'knowledge'), { recursive: true, mode: 0o700 });
        writeFileSync(projectStore, itemStore('V6 PROMPT PROJECT SENTINEL'), { mode: 0o600 });
        const script = `
          const root = await import(${JSON.stringify(rootUrl)});
          const mcp = await import(${JSON.stringify(mcpUrl)});
          const bypasses = [];
          const schemaFailures = [];
          let accessorReads = 0;
          const rejected = async (invoke, label) => {
            try {
              const value = await invoke();
              bypasses.push(label + (JSON.stringify(value).includes('V6 PROMPT GLOBAL SENTINEL') ? '=READ' : '=CALL'));
            } catch (error) {
              if (!/explicit own allowGlobal=true|own allow_global=true|accessor/i.test(String(error?.message ?? error))) throw error;
            }
          };
          const service = root.createKnowledgeService({ scope: 'global', env: {} });
          const base = { prompt: 'V6 PROMPT GLOBAL SENTINEL', legacyStorePath: ${JSON.stringify(globalStore)}, limit: 1 };
          const serviceCalls = [
            ['normal', (options) => service.runPrompt(options)],
            ['bound', service.runPrompt.bind(service)],
            ['direct', (options) => Reflect.apply(service.runPrompt, service, [options])],
            ['prototype', (options) => root.KnowledgeService.prototype.runPrompt.call(service, options)],
          ];
          for (const [style, invoke] of serviceCalls) {
            const inherited = Object.assign(Object.create({ allowGlobal: true }), base);
            const accessor = { ...base };
            Object.defineProperty(accessor, 'allowGlobal', { enumerable: true, get() { accessorReads += 1; return true; } });
            await rejected(() => invoke({ ...base }), 'service/' + style + '/missing');
            await rejected(() => invoke({ ...base, allowGlobal: false }), 'service/' + style + '/false');
            await rejected(() => invoke(inherited), 'service/' + style + '/inherited');
            await rejected(() => invoke(accessor), 'service/' + style + '/accessor');
            const allowed = await invoke({ ...base, allowGlobal: true });
            if (!JSON.stringify(allowed).includes('V6 PROMPT GLOBAL SENTINEL')) throw new Error('authorized service prompt did not read global evidence');
          }
          const client = root.createKnowledgeClient({ scope: 'global', allowGlobal: true, env: {} });
          for (const method of ['ask', 'build']) {
            const allowedByConstructor = await client[method]('V6 PROMPT GLOBAL SENTINEL', { legacyStorePath: ${JSON.stringify(globalStore)}, limit: 1 });
            if (!JSON.stringify(allowedByConstructor).includes('V6 PROMPT GLOBAL SENTINEL')) throw new Error(method + ' constructor authority failed');
            await rejected(
              () => client[method]('V6 PROMPT GLOBAL SENTINEL', { legacyStorePath: ${JSON.stringify(globalStore)}, limit: 1, allowGlobal: false }),
              'sdk/' + method + '/false',
            );
            const allowed = await client[method]('V6 PROMPT GLOBAL SENTINEL', { legacyStorePath: ${JSON.stringify(globalStore)}, limit: 1, allowGlobal: true });
            if (!JSON.stringify(allowed).includes('V6 PROMPT GLOBAL SENTINEL')) throw new Error(method + ' explicit authority failed');
          }
          const server = mcp.buildServer({ cwd: ${JSON.stringify(project)}, scope: 'project', env: {} });
          for (const name of ['knowledge_ask', 'knowledge_build']) {
            const tool = server._registeredTools[name];
            if (!JSON.stringify(tool.inputSchema ?? tool).includes('allow_global')) schemaFailures.push(name);
            const call = (input) => tool.handler(input);
            for (const [variant, input] of [
              ['missing', { scope: 'global', prompt: 'V6 PROMPT GLOBAL SENTINEL', limit: 1 }],
              ['false', { scope: 'global', allow_global: false, prompt: 'V6 PROMPT GLOBAL SENTINEL', limit: 1 }],
              ['inherited', Object.assign(Object.create({ allow_global: true }), { scope: 'global', prompt: 'V6 PROMPT GLOBAL SENTINEL', limit: 1 })],
            ]) {
              const value = await call(input);
              if (!value.isError) bypasses.push('mcp/' + name + '/' + variant + '=CALL');
              else if (!/own allow_global=true/i.test(value.content?.[0]?.text ?? '')) throw new Error(name + ' returned the wrong denial');
            }
            const accessor = { scope: 'global', prompt: 'V6 PROMPT GLOBAL SENTINEL', limit: 1 };
            Object.defineProperty(accessor, 'allow_global', { enumerable: true, get() { accessorReads += 1; return true; } });
            const accessorResult = await call(accessor);
            if (!accessorResult.isError) bypasses.push('mcp/' + name + '/accessor=CALL');
            const allowed = await call({ scope: 'global', allow_global: true, prompt: 'V6 PROMPT GLOBAL SENTINEL', limit: 1 });
            if (allowed.isError || !(allowed.content?.[0]?.text ?? '').includes('V6 PROMPT GLOBAL SENTINEL')) throw new Error(name + ' explicit global authority failed');
            const omitted = await call({ prompt: 'V6 PROMPT PROJECT SENTINEL', limit: 1 });
            if (omitted.isError || !(omitted.content?.[0]?.text ?? '').includes('V6 PROMPT PROJECT SENTINEL')) {
              bypasses.push('mcp/' + name + '/omitted-not-project');
            }
          }
          console.log(JSON.stringify({ bypasses, schemaFailures, accessorReads }));
        `;
        const probe = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env: localEnv(home),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(probe.exitCode, text(probe.stderr)).toBe(0);
        const lines = text(probe.stdout).trim().split('\n');
        const payload = JSON.parse(lines.at(-1) ?? '{}');
        expect(payload.accessorReads).toBe(0);
        expect(payload.schemaFailures).toEqual([]);
        expect(payload.bypasses).toEqual([]);

        for (const command of ['ask', 'build']) {
          const denied = runCli(
            launcher,
            [command, 'V6 PROMPT GLOBAL SENTINEL', '--scope', 'global', '--json'],
            project,
            home,
          );
          expect(denied.exitCode).toBe(1);
          expect(text(denied.stderr)).toMatch(/allowGlobal=true|allow-global/i);
          expect(text(denied.stdout)).not.toContain('V6 PROMPT GLOBAL SENTINEL');
          const allowed = runCli(
            launcher,
            [command, 'V6 PROMPT GLOBAL SENTINEL', '--scope', 'global', '--allow-global', '--json'],
            project,
            home,
          );
          expect(allowed.exitCode, text(allowed.stderr)).toBe(0);
          expect(text(allowed.stdout)).toContain('V6 PROMPT GLOBAL SENTINEL');
        }
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);

  test('V6-4 MCP context pack exposes authority and defaults omitted scope to the bound project', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-mcp-context-'));
    try {
      for (const [surface, moduleUrl] of [
        ['source', new URL('../src/mcp.js', import.meta.url).href],
        ['built', new URL('../dist/mcp-payload.js', import.meta.url).href],
      ] as const) {
        const home = join(fixture, `home-${surface}`);
        const project = join(fixture, `project-${surface}`);
        mkdirSync(home, { mode: 0o700 });
        mkdirSync(join(project, '.hasna', 'knowledge'), { recursive: true, mode: 0o700 });
        writeGlobalStore(home, 'V6 MCP GLOBAL SENTINEL');
        writeFileSync(
          join(project, '.hasna', 'knowledge', 'db.json'),
          itemStore('V6 MCP PROJECT SENTINEL'),
          { mode: 0o600 },
        );
        const script = `
          const mod = await import(${JSON.stringify(moduleUrl)});
          const server = mod.buildServer({ cwd: ${JSON.stringify(project)}, scope: 'project', env: {} });
          const tool = server._registeredTools.knowledge_context_pack;
          const violations = [];
          let accessorReads = 0;
          if (!JSON.stringify(tool.inputSchema ?? tool).includes('allow_global')) violations.push('schema');
          const omitted = await tool.handler({ query: 'V6 MCP PROJECT SENTINEL', max_tokens: 1200, max_items: 1 });
          if (omitted.isError || !(omitted.content?.[0]?.text ?? '').includes('V6 MCP PROJECT SENTINEL')) violations.push('omitted-not-project');
          const projectResult = await tool.handler({ scope: 'project', query: 'V6 MCP PROJECT SENTINEL', max_tokens: 1200, max_items: 1 });
          if (projectResult.isError || !(projectResult.content?.[0]?.text ?? '').includes('V6 MCP PROJECT SENTINEL')) violations.push('explicit-project');
          const inherited = Object.assign(Object.create({ allow_global: true }), { scope: 'global', query: 'V6 MCP GLOBAL SENTINEL', max_tokens: 1200, max_items: 1 });
          const accessor = { scope: 'global', query: 'V6 MCP GLOBAL SENTINEL', max_tokens: 1200, max_items: 1 };
          Object.defineProperty(accessor, 'allow_global', { enumerable: true, get() { accessorReads += 1; return true; } });
          for (const [variant, input] of [
            ['missing', { scope: 'global', query: 'V6 MCP GLOBAL SENTINEL', max_tokens: 1200, max_items: 1 }],
            ['false', { scope: 'global', allow_global: false, query: 'V6 MCP GLOBAL SENTINEL', max_tokens: 1200, max_items: 1 }],
            ['inherited', inherited],
            ['accessor', accessor],
          ]) {
            const value = await tool.handler(input);
            if (!value.isError || !/own allow_global=true/i.test(value.content?.[0]?.text ?? '')) violations.push('global-' + variant);
          }
          const allowed = await tool.handler({ scope: 'global', allow_global: true, query: 'V6 MCP GLOBAL SENTINEL', max_tokens: 1200, max_items: 1 });
          if (allowed.isError || !(allowed.content?.[0]?.text ?? '').includes('V6 MCP GLOBAL SENTINEL')) violations.push('global-true');
          console.log(JSON.stringify({ violations, accessorReads }));
        `;
        const probe = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env: localEnv(home),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(probe.exitCode, text(probe.stderr)).toBe(0);
        const payload = JSON.parse(text(probe.stdout).trim().split('\n').at(-1) ?? '{}');
        expect(payload.accessorReads).toBe(0);
        expect(payload.violations).toEqual([]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('V6-8 routine CLI failures are stable and omit absolute launcher and store topology by default', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-cli-errors-'));
    try {
      for (const [surface, launcher] of [
        ['source', sourceCli],
        ['built', builtCli],
      ] as const) {
        const home = join(fixture, `home-${surface}`);
        mkdirSync(home, { mode: 0o700 });
        const candidateStore = join(fixture, `missing-${surface}`, 'candidate-store.json');
        for (const [label, args] of [
          ['invalid-flag', ['--definitely-invalid']],
          ['missing-store-parent', ['list', '--scope', 'project', '--store', candidateStore, '--json']],
        ] as const) {
          const result = runCli(launcher, [...args], fixture, home, { DEBUG: undefined, LOG_LEVEL: undefined });
          const stderr = text(result.stderr);
          expect(result.exitCode, `${surface}/${label}`).toBe(1);
          expect(stderr).toContain('Error:');
          expect(stderr).not.toContain(repositoryRoot);
          expect(stderr).not.toContain(fixture);
          expect(stderr).not.toContain(candidateStore);
          expect(stderr).not.toMatch(/\n\s*at\s+|"stack"\s*:/);
        }
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('V6-9 project panel keeps project/local/global scope coherent with exact global authority', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-v6-project-panel-'));
    try {
      for (const [surface, moduleUrl, launcher] of [
        ['source', new URL('../src/index.ts', import.meta.url).href, sourceCli],
        ['built', new URL('../dist/index.js', import.meta.url).href, builtCli],
      ] as const) {
        const home = join(fixture, `home-${surface}`);
        const project = join(fixture, `project-${surface}`);
        mkdirSync(home, { mode: 0o700 });
        mkdirSync(project, { mode: 0o700 });
        const globalStore = writeGlobalStore(home, 'V6 PANEL GLOBAL SENTINEL');
        const scopedStores = {
          project: join(fixture, `${surface}-project-store.json`),
          local: join(fixture, `${surface}-local-store.json`),
        };
        writeFileSync(scopedStores.project, itemStore('V6 PANEL PROJECT SENTINEL'), { mode: 0o600 });
        writeFileSync(scopedStores.local, itemStore('V6 PANEL LOCAL SENTINEL'), { mode: 0o600 });
        const script = `
          const root = await import(${JSON.stringify(moduleUrl)});
          const violations = [];
          let accessorReads = 0;
          for (const scope of ['project', 'local']) {
            const service = root.createKnowledgeService({ scope, cwd: ${JSON.stringify(project)}, env: {} });
            for (const [variant, authority] of [['missing', {}], ['false', { allowGlobal: false }], ['true', { allowGlobal: true }]]) {
              try {
                const panel = root.createKnowledgeProjectPanel('probe', { service, scope, cwd: ${JSON.stringify(project)}, storePath: ${JSON.stringify(scopedStores)}[scope], ...authority });
                if (!JSON.stringify(panel).includes('V6 PANEL ' + scope.toUpperCase() + ' SENTINEL')) violations.push(scope + '/' + variant + '/wrong-data');
              } catch (error) {
                violations.push(scope + '/' + variant + '/error:' + String(error?.message ?? error));
              }
            }
          }
          const globalService = root.createKnowledgeService({ scope: 'global', cwd: ${JSON.stringify(project)}, env: {} });
          const calls = [
            ['normal', (options) => root.createKnowledgeProjectPanel('probe', options)],
            ['bound', root.createKnowledgeProjectPanel.bind(Object.freeze({ receiver: 'panel' }), 'probe')],
            ['direct', (options) => Reflect.apply(root.createKnowledgeProjectPanel, Object.freeze({ receiver: 'panel' }), ['probe', options])],
          ];
          for (const [style, invoke] of calls) {
            const base = { service: globalService, scope: 'global', cwd: ${JSON.stringify(project)}, storePath: ${JSON.stringify(globalStore)} };
            const inherited = Object.assign(Object.create({ allowGlobal: true }), base);
            const accessor = { ...base };
            Object.defineProperty(accessor, 'allowGlobal', { enumerable: true, get() { accessorReads += 1; return true; } });
            for (const [variant, options] of [['missing', { ...base }], ['false', { ...base, allowGlobal: false }], ['inherited', inherited], ['accessor', accessor]]) {
              try {
                const panel = invoke(options);
                violations.push('global/' + style + '/' + variant + (JSON.stringify(panel).includes('V6 PANEL GLOBAL SENTINEL') ? '=READ' : '=CALL'));
              } catch (error) {
                if (!/explicit own allowGlobal=true|accessor/i.test(String(error?.message ?? error))) violations.push('global/' + style + '/' + variant + '/wrong-error');
              }
            }
            const allowed = invoke({ ...base, allowGlobal: true });
            if (!JSON.stringify(allowed).includes('V6 PANEL GLOBAL SENTINEL')) violations.push('global/' + style + '/true');
          }
          console.log(JSON.stringify({ violations, accessorReads }));
        `;
        const probe = Bun.spawnSync(['bun', '--eval', script], {
          cwd: project,
          env: localEnv(home),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(probe.exitCode, text(probe.stderr)).toBe(0);
        const payload = JSON.parse(text(probe.stdout).trim().split('\n').at(-1) ?? '{}');
        expect(payload.accessorReads).toBe(0);
        expect(payload.violations).toEqual([]);

        for (const [scope, storePath, title] of [
          ['project', scopedStores.project, 'V6 PANEL PROJECT SENTINEL'],
          ['local', scopedStores.local, 'V6 PANEL LOCAL SENTINEL'],
        ] as const) {
          for (const authority of [[], ['--allow-global']] as const) {
            const result = runCli(
              launcher,
              ['project-panel', '--project', 'probe', '--scope', scope, '--store', storePath, ...authority, '--json'],
              project,
              home,
            );
            expect(result.exitCode, text(result.stderr)).toBe(0);
            expect(text(result.stdout)).toContain(title);
          }
        }
        const denied = runCli(
          launcher,
          ['project-panel', '--project', 'probe', '--scope', 'global', '--store', globalStore, '--json'],
          project,
          home,
        );
        expect(denied.exitCode).toBe(1);
        expect(text(denied.stderr)).toMatch(/allowGlobal=true|allow-global/i);
        const allowed = runCli(
          launcher,
          ['project-panel', '--project', 'probe', '--scope', 'global', '--store', globalStore, '--allow-global', '--json'],
          project,
          home,
        );
        expect(allowed.exitCode, text(allowed.stderr)).toBe(0);
        expect(text(allowed.stdout)).toContain('V6 PANEL GLOBAL SENTINEL');
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});
