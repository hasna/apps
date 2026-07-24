import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sourceRoot from '../src/index.ts';
import * as builtRoot from '../dist/index.js';
import { KnowledgeApiClient as GeneratedKnowledgeApiClient } from '../src/generated/knowledge-api-client.ts';
import { KnowledgeService } from '../src/service.ts';
import { buildServer } from '../src/mcp.js';
import { MAX_INGEST_BODY_BYTES } from '../src/input-limits.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env';

const root = join(import.meta.dir, '..');

async function expectContained(operation: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await operation();
    throw new Error('expected Stage-A containment');
  } catch (error) {
    expect(error).toMatchObject({
      name: 'KnowledgeContainmentError',
      status: 503,
    });
  }
}

function hostile(reads: { count: number }): Record<string, unknown> {
  return new Proxy({}, {
    get() { reads.count += 1; throw new Error('hostile getter tripwire'); },
    ownKeys() { reads.count += 1; throw new Error('hostile enumeration tripwire'); },
    getOwnPropertyDescriptor() { reads.count += 1; throw new Error('hostile descriptor tripwire'); },
  });
}

function registeredTools(server: ReturnType<typeof buildServer>) {
  return (server as unknown as {
    _registeredTools: Record<string, {
      handler(input: unknown): Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;
    }>;
  })._registeredTools;
}

describe('blind-pair-6 public compatibility boundaries', () => {
  test('generated and root API clients reject before state retention, options, or fetch', async () => {
    for (const Client of [GeneratedKnowledgeApiClient, sourceRoot.KnowledgeApiClient, builtRoot.KnowledgeApiClient]) {
      const reads = { count: 0 };
      await expectContained(() => new Client(hostile(reads) as never));
      expect(reads.count).toBe(0);

      const receiver = Object.create(Client.prototype);
      await expectContained(() => Client.prototype.listNotes.call(receiver, hostile(reads), hostile(reads)));
      expect(reads.count).toBe(0);
      expect(Object.getOwnPropertyNames(receiver)).toEqual([]);
    }
  });

  test('NoteRepo preserves an inert base client property and contains before argument inspection', async () => {
    for (const Repo of [sourceRoot.NoteRepo, builtRoot.NoteRepo]) {
      const reads = { count: 0 };
      const repo = new Repo(hostile(reads) as never);
      expect(Object.getOwnPropertyNames(repo)).toContain('client');
      expect(Object.getOwnPropertyDescriptor(repo, 'client')).toMatchObject({
        value: undefined,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      for (const operation of [
        () => repo.create(hostile(reads) as never),
        () => repo.list(hostile(reads) as never),
        () => repo.get(hostile(reads) as never),
        () => repo.update(hostile(reads) as never, hostile(reads) as never),
        () => repo.delete(hostile(reads) as never),
      ]) await expectContained(operation);
      expect(reads.count).toBe(0);
    }

    const source = readFileSync(join(root, 'src', 'serve.ts'), 'utf8');
    const declaration = readFileSync(join(root, 'dist', 'serve.d.ts'), 'utf8');
    const built = readFileSync(join(root, 'dist', 'serve.js'), 'utf8');
    const bin = readFileSync(join(root, 'bin', 'knowledge-serve.js'), 'utf8');
    for (const text of [source, declaration, built, bin]) {
      expect(text).not.toMatch(/INSERT INTO knowledge_items|SELECT \* FROM knowledge_items|DELETE FROM knowledge_items/);
    }
  });

  test('public storage declarations preserve inert base SQL type vocabulary', () => {
    const declaration = readFileSync(join(root, 'dist', 'storage.d.ts'), 'utf8');
    expect(declaration).toContain("from './generated/storage-kit/index.js'");
    expect(declaration).toContain('MigrationLedger');
    expect(readFileSync(join(root, 'dist', 'generated', 'storage-kit', 'query.d.ts'), 'utf8'))
      .toMatch(/\bquery\s*</);
    expect(readFileSync(join(root, 'dist', 'generated', 'storage-kit', 'migrations.d.ts'), 'utf8'))
      .toMatch(/\bsql\s*:\s*string\b/);
  });

  test('source, dist, CLI, and MCP web entrypoints are unconditional zero-read containment', async () => {
    for (const operation of [
      (input: unknown) => sourceRoot.runProviderWebSearch(input as never),
      (input: unknown) => builtRoot.runProviderWebSearch(input as never),
      (input: unknown) => KnowledgeService.prototype.webSearch.call({}, input),
    ]) {
      const reads = { count: 0 };
      await expectContained(() => operation(hostile(reads)));
      expect(reads.count).toBe(0);
    }

    for (const entry of ['src/cli.ts', 'bin/knowledge.js']) {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-web-cli-contained-'));
      const home = join(fixture, 'home');
      try {
        const result = Bun.spawnSync(['bun', join(root, entry), 'web', 'search', 'synthetic', '--fake', '--json'], {
          cwd: fixture,
          env: sanitizedLocalTestEnv({
            HOME: home,
            USERPROFILE: home,
            BUN_CONFIG_INSTALL_AUTO: 'disable',
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
        expect(result.exitCode).toBe(1);
        expect(output).toContain('KNOWLEDGE_HOSTED_CONTAINED');
        expect(existsSync(join(fixture, '.hasna'))).toBe(false);
        expect(existsSync(join(home, '.hasna'))).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }

    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-web-mcp-contained-'));
    try {
      const tools = registeredTools(buildServer({ cwd: fixture, env: {} }));
      for (const name of ['knowledge_web_search', 'ok_web_search']) {
        const reads = { count: 0 };
        const result = await tools[name].handler(hostile(reads));
        expect(result.isError).toBe(true);
        expect(result.content?.[0]?.text).toContain('KNOWLEDGE_HOSTED_CONTAINED');
        expect(reads.count).toBe(0);
      }
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('camelCase, acronym, snake_case, and unknown ref-like aliases fail before storage', async () => {
    const aliases = [
      'sourceUrl', 'sourceURL', 'source_url', 'sourceUri', 'sourceURI',
      'extractedTextRef', 'extractedTextURI', 'unknownURL', 'unknown_uri', 'mysteryRef',
    ];
    for (const [surface, api] of [['source', sourceRoot], ['dist', builtRoot]] as const) {
      for (const alias of aliases) {
        const fixture = mkdtempSync(join(tmpdir(), `knowledge-ref-alias-${surface}-`));
        const dbPath = join(fixture, 'knowledge.db');
        try {
          await expectContained(() => api.ingestOpenFilesManifestItems({
            dbPath,
            sourceLabel: 'synthetic-alias',
            items: [{
              source_ref: pathToFileURL(join(fixture, 'source.txt')).href,
              extracted_text: 'synthetic local text',
              [alias]: 'https://remote.invalid/blocked',
            }],
          } as never));
          expect(existsSync(dbPath), `${surface}:${alias}`).toBe(false);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    }

    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-ref-alias-surfaces-'));
    const localRef = pathToFileURL(join(fixture, 'source.txt')).href;
    const dbPath = join(fixture, 'knowledge.db');
    try {
      const tools = registeredTools(buildServer({ cwd: fixture, env: {} }));
      for (const alias of aliases) {
        const payload = {
          scope: 'project',
          source_ref: localRef,
          sourceRef: localRef,
          workspace: {
            home: join(fixture, '.hasna', 'knowledge'),
            knowledgeDbPath: dbPath,
          },
          [alias]: 'https://remote.invalid/blocked',
        };
        await expectContained(() => sourceRoot.ingestSourceRef({
          dbPath,
          sourceRef: localRef,
          [alias]: 'https://remote.invalid/blocked',
        } as never));
        await expectContained(() => sourceRoot.ingestAppWikiSourceRef(payload as never));
        await expectContained(() => KnowledgeService.prototype.addAppWikiSourceRef.call({}, payload));
        const mcp = await tools.knowledge_app_wiki_source_add.handler(payload);
        expect(mcp.isError, alias).toBe(true);
        expect(mcp.content?.[0]?.text).toContain('KNOWLEDGE_HOSTED_CONTAINED');
        expect(existsSync(dbPath), alias).toBe(false);
      }
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('CLI URL and manifest aliases fail without creating workspace or store state', () => {
    const aliases = [
      'sourceUrl', 'sourceURL', 'source_url', 'sourceUri', 'sourceURI',
      'extractedTextRef', 'extractedTextURI', 'unknownURL', 'unknown_uri', 'mysteryRef',
    ];
    for (const entry of ['src/cli.ts', 'bin/knowledge.js']) {
      for (const alias of aliases) {
        const fixture = mkdtempSync(join(tmpdir(), 'knowledge-cli-ref-alias-'));
        const manifest = join(fixture, 'manifest.json');
        const home = join(fixture, 'home');
        writeFileSync(manifest, JSON.stringify([{
          source_ref: pathToFileURL(join(fixture, 'source.txt')).href,
          extracted_text: 'synthetic local text',
          [alias]: 'https://remote.invalid/blocked',
        }]));
        try {
          const result = Bun.spawnSync([
            'bun', join(root, entry), 'ingest', 'manifest', manifest, '--scope', 'project', '--json',
          ], {
            cwd: fixture,
            env: sanitizedLocalTestEnv({ HOME: home, USERPROFILE: home }),
            stdout: 'pipe',
            stderr: 'pipe',
          });
          const output = `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;
          expect(result.exitCode, `${entry}:${alias}:${output}`).toBe(1);
          expect(output).toContain('KNOWLEDGE_HOSTED_CONTAINED');
          expect(existsSync(join(fixture, '.hasna')), `${entry}:${alias}`).toBe(false);
          expect(existsSync(join(home, '.hasna')), `${entry}:${alias}`).toBe(false);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    }

    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-cli-url-contained-'));
    const storePath = join(fixture, 'store.json');
    try {
      const result = Bun.spawnSync([
        'bun', join(root, 'src', 'cli.ts'), 'add', 'Synthetic', 'Body',
        '--url', 'https://remote.invalid/blocked', '--store', storePath,
      ], {
        cwd: fixture,
        env: sanitizedLocalTestEnv(),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(result.exitCode).toBe(1);
      expect(existsSync(storePath)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('MCP import and batch reject aggregate bytes and strings before store mutation', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-mcp-bounds-'));
    const storePath = join(fixture, 'store.json');
    const importPath = join(fixture, 'oversized.json');
    try {
      writeFileSync(importPath, JSON.stringify({
        items: [],
        padding: 'x'.repeat(MAX_INGEST_BODY_BYTES),
      }));
      const tools = registeredTools(buildServer({ cwd: fixture, env: {} }));
      const imported = await tools.ok_import.handler({ file: importPath, store_path: storePath });
      expect(imported.isError).toBe(true);
      expect(imported.content?.[0]?.text).toContain('hard limit');
      expect(existsSync(storePath)).toBe(false);

      const batched = await tools.ok_batch.handler({
        store_path: storePath,
        items: [{ title: 'x'.repeat(MAX_INGEST_BODY_BYTES + 1), content: 'synthetic' }],
      });
      expect(batched.isError).toBe(true);
      expect(batched.content?.[0]?.text).toContain('hard limit');
      expect(existsSync(storePath)).toBe(false);

      const source = readFileSync(join(root, 'src', 'mcp.js'), 'utf8');
      expect(source).toContain('.max(MAX_INGEST_BATCH_ITEMS)');
      expect(source).toContain('readAnchoredRegularFileSnapshot');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
