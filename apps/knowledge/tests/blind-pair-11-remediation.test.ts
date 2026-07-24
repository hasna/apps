import { describe, expect, test } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../src/service.ts';
import { buildServer } from '../src/mcp.js';
import { buildServer as builtBuildServer } from '../dist/mcp-payload.js';
import {
  setKnowledgeDbTestHook,
  type KnowledgeDbTestEvent,
} from '../src/knowledge-db.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const root = join(import.meta.dir, '..');
const cli = join(root, 'src', 'cli.ts');

function runCli(args: string[], cwd: string, home: string) {
  return Bun.spawnSync(['bun', cli, ...args], {
    cwd,
    env: sanitizedLocalTestEnv({
      HOME: home,
      USERPROFILE: home,
      BUN_CONFIG_INSTALL_AUTO: 'disable',
    }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('blind pair 11 remediation', () => {
  test('CLI global app-wiki list, get, search, and query require explicit --allow-global before workspace access', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-11-cli-global-'));
    const project = join(fixture, 'project');
    const home = join(fixture, 'home');
    mkdirSync(project);
    mkdirSync(home);
    try {
      const commands = [
        ['list', '--scope', 'global', '--json'],
        ['get', '--id', 'missing', '--scope', 'global', '--json'],
        ['search', 'missing', '--scope', 'global', '--json'],
        ['app-wiki', 'note', 'list', '--scope', 'global', '--json'],
        ['app-wiki', 'note', 'get', 'missing', '--scope', 'global', '--json'],
        ['app-wiki', 'search', 'missing', '--scope', 'global', '--json'],
        ['app-wiki', 'query', 'missing', '--scope', 'global', '--json'],
      ];
      for (const args of commands) {
        const result = runCli(args, project, home);
        expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(1);
        expect(new TextDecoder().decode(result.stderr)).toMatch(/global.*(?:allow-global|allowGlobal)/i);
        expect(existsSync(join(home, '.hasna'))).toBe(false);
        expect(existsSync(join(project, '.hasna'))).toBe(false);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('service workspace and project inode replacement permanently revoke every property and operation', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-11-service-identity-'));
    const project = join(fixture, 'project');
    const movedProject = join(fixture, 'project-original');
    const replacementProject = join(fixture, 'project-replacement');
    mkdirSync(project);
    const service = createKnowledgeService({ scope: 'project', cwd: project, env: {} } as never);
    try {
      expect(service.scope).toBe('project');
      renameSync(project, movedProject);
      mkdirSync(project);
      expect(() => service.workspace).toThrow(/identity|project root|permanently invalid/i);

      renameSync(project, replacementProject);
      renameSync(movedProject, project);
      expect(() => service.paths()).toThrow(/identity|project root|permanently invalid/i);
      expect(() => service.scope).toThrow(/identity|project root|permanently invalid/i);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('direct global service reads reject missing, inherited, accessor, and non-true authority before store access', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-11-service-global-'));
    const home = join(fixture, 'home');
    mkdirSync(home);
    const script = `
      const { createKnowledgeService } = await import(${JSON.stringify(
        new URL('../src/service.ts', import.meta.url).href,
      )});
      const service = createKnowledgeService({ scope: 'global', env: {} });
      const inherited = Object.create({ allowGlobal: true });
      const accessor = Object.defineProperty({}, 'allowGlobal', {
        get() { throw new Error('authority accessor invoked'); },
      });
      const queryOptions = (options) => Object.defineProperty(
        Object.create(
          Object.getPrototypeOf(options ?? {}),
          Object.getOwnPropertyDescriptors(options ?? {}),
        ),
        'query',
        { value: 'missing', enumerable: true, configurable: true },
      );
      const invalid = [undefined, {}, { allowGlobal: false }, { allowGlobal: 'true' }, inherited, accessor];
      let rejected = 0;
      for (const options of invalid) {
        for (const invoke of [
          () => service.listAppWikiNotes(options),
          () => service.getAppWikiNote('missing', options),
          () => service.searchAppWiki(queryOptions(options)),
          () => service.queryAppWiki(queryOptions(options)),
          () => service.search(queryOptions(options)),
          () => service.retrieveContext(queryOptions(options)),
        ]) {
          try { await invoke(); }
          catch (error) {
            if (!String(error).match(/own allowGlobal=true/i)) throw error;
            rejected += 1;
            continue;
          }
          throw new Error('global read unexpectedly succeeded');
        }
      }
      process.stdout.write(JSON.stringify({ rejected }));
    `;
    try {
      const result = Bun.spawnSync(['bun', '--eval', script], {
        cwd: fixture,
        env: sanitizedLocalTestEnv({ HOME: home, USERPROFILE: home }),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({ rejected: 36 });
      expect(existsSync(join(home, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('source and built root SDKs require exact-own global authority and propagate one valid grant', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-11-sdk-global-'));
    const home = join(fixture, 'home');
    mkdirSync(home);
    try {
      for (const moduleUrl of [
        new URL('../src/index.ts', import.meta.url).href,
        new URL('../dist/index.js', import.meta.url).href,
      ]) {
        const script = `
          const root = await import(${JSON.stringify(moduleUrl)});
          const inherited = Object.assign(Object.create({ allowGlobal: true }), { scope: 'global' });
          const accessor = Object.defineProperties({}, {
            scope: { value: 'global', enumerable: true },
            allowGlobal: { get() { throw new Error('authority accessor invoked'); }, enumerable: true },
          });
          let rejected = 0;
          for (const options of [
            { scope: 'global' },
            { scope: 'global', allowGlobal: false },
            { scope: 'global', allowGlobal: 'true' },
            inherited,
            accessor,
          ]) {
            for (const create of [root.createKnowledgeClient, root.createKnowledgeSdk, root.createAppWikiScope]) {
              try { create(options); }
              catch (error) {
                if (!String(error).match(/own allowGlobal=true/i) && !String(error).match(/unsupported|accessor|prototype|runtime intent/i)) throw error;
                rejected += 1;
                continue;
              }
              throw new Error('global SDK construction unexpectedly succeeded');
            }
          }
          for (const operation of [root.hybridSearch, root.retrieveKnowledgeContext]) {
            for (const options of [
              { scope: 'global', dbPath: '/must-not-open.db', query: 'missing' },
              { scope: 'global', allowGlobal: false, dbPath: '/must-not-open.db', query: 'missing' },
            ]) {
              try { await operation(options); }
              catch (error) {
                if (!String(error).match(/own allowGlobal=true/i)) throw error;
                rejected += 1;
                continue;
              }
              throw new Error('global root read unexpectedly succeeded');
            }
          }
          const client = root.createKnowledgeClient({ scope: 'global', allowGlobal: true, env: {} });
          const notes = client.appWiki.notes.list();
          const search = await client.search({ query: 'missing' });
          const context = await client.retrieveContext({ query: 'missing' });
          process.stdout.write(JSON.stringify({ rejected, notes: notes.length, results: search.results.length, excerpts: context.excerpts.length }));
        `;
        const result = Bun.spawnSync(['bun', '--eval', script], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({
            HOME: home,
            USERPROFILE: home,
            BUN_CONFIG_INSTALL_AUTO: 'disable',
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(result.exitCode, `${moduleUrl}\n${new TextDecoder().decode(result.stderr)}`).toBe(0);
        expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
          rejected: 19,
          notes: 0,
          results: 0,
          excerpts: 0,
        });
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('MCP app-wiki and root search/query schemas require own allow_global for global scope', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-11-mcp-global-'));
    try {
      for (const createServer of [buildServer, builtBuildServer]) {
        const server = createServer({ cwd: fixture, env: {}, scope: 'project' });
        const tools = (server as unknown as {
          _registeredTools: Record<string, {
            handler(input: unknown): Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;
          }>;
        })._registeredTools;
        for (const name of [
          'knowledge_app_wiki_search',
          'knowledge_app_wiki_query',
          'ok_list',
          'ok_get',
          'ok_search',
          'knowledge_search',
        ]) {
          const schema = (tools[name] as any).inputSchema;
          expect(JSON.stringify(schema ?? tools[name])).toContain('allow_global');
          for (const input of [
            { scope: 'global', query: 'missing', id: 'missing' },
            { scope: 'global', query: 'missing', id: 'missing', allow_global: false },
            Object.assign(Object.create({ allow_global: true }), { scope: 'global', query: 'missing', id: 'missing' }),
          ]) {
            const result = await tools[name].handler(input);
            expect(result.isError).toBe(true);
            expect(result.content?.[0]?.text).toMatch(/own allow_global=true/i);
          }
        }
        const projectResult = await tools.knowledge_app_wiki_search.handler({
          scope: 'project',
          query: 'missing',
        });
        expect(projectResult.isError).not.toBe(true);
        for (const [name, input] of [
          ['ok_list', {}],
          ['ok_get', { id: 'missing' }],
          ['ok_search', { query: 'missing' }],
          ['knowledge_search', { query: 'missing' }],
        ] as const) {
          const result = await tools[name].handler(input);
          expect(result.isError).toBe(true);
          expect(result.content?.[0]?.text).toMatch(/own allow_global=true/i);
        }
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  for (const event of ['database-before-constructor', 'database-before-migration'] as const) {
    for (const mutation of ['replace', 'symlink', 'hardlink', 'grow'] as const) {
      test(`app-wiki identity-bound DB open rejects ${mutation} at ${event}`, async () => {
        const fixture = mkdtempSync(join(tmpdir(), `knowledge-pair-11-db-${event}-${mutation}-`));
        const project = join(fixture, 'project');
        mkdirSync(project);
        const service = createKnowledgeService({ scope: 'project', cwd: project, env: {} } as never);
        const dbPath = join(project, '.hasna', 'knowledge', 'knowledge.db');
        const displaced = join(project, '.hasna', 'knowledge', 'knowledge.displaced.db');
        const outside = join(fixture, 'outside.db');
        let injected = false;
        setKnowledgeDbTestHook((observed: KnowledgeDbTestEvent, detail: string) => {
          if (observed !== event || detail !== dbPath || injected) return;
          injected = true;
          if (mutation === 'replace') {
            renameSync(dbPath, displaced);
            writeFileSync(dbPath, 'replacement-sentinel', { mode: 0o600 });
          }
          if (mutation === 'symlink') {
            renameSync(dbPath, displaced);
            writeFileSync(outside, 'outside-sentinel', { mode: 0o600 });
            symlinkSync(outside, dbPath);
          }
          if (mutation === 'hardlink') linkSync(dbPath, displaced);
          if (mutation === 'grow') appendFileSync(dbPath, 'race-growth');
        });
        try {
          await expect(service.initAppWiki()).rejects.toThrow(/anchored database|identity|contents|hard link/i);
          expect(injected).toBe(true);
          if (mutation === 'replace') expect(readFileSync(dbPath, 'utf8')).toBe('replacement-sentinel');
          if (mutation === 'symlink') expect(readFileSync(outside, 'utf8')).toBe('outside-sentinel');
          if (mutation === 'hardlink') expect(statSync(dbPath).nlink).toBe(2);
          const inspected = mutation === 'replace'
            ? readFileSync(displaced)
            : mutation === 'symlink'
              ? readFileSync(displaced)
              : readFileSync(dbPath);
          expect(inspected.includes(Buffer.from('schema_versions'))).toBe(false);
        } finally {
          setKnowledgeDbTestHook(undefined);
          rmSync(fixture, { recursive: true, force: true });
        }
      });
    }
  }
});
