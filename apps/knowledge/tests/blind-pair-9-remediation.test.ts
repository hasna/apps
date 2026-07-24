import { describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as rootApi from '../src/index.ts';
import { assertAppWikiWriteAllowed } from '../src/app-wiki.ts';
import { MAX_INGEST_BODY_BYTES } from '../src/input-limits.ts';
import { openKnowledgeDb } from '../src/knowledge-db.ts';
import { ingestOpenFilesManifestItems } from '../src/manifest-ingest.ts';
import { consumeOpenFilesOutbox, mergeOutboxMetadata } from '../src/outbox-consume.ts';
import { createKnowledgeProjectPanel } from '../src/project-panel.ts';
import { assertS3ReadAllowed } from '../src/safety.ts';
import { resolveScopedWorkspace } from '../src/workspace.ts';
import { sanitizedLocalTestEnv } from './helpers/sanitized-env.ts';

const root = join(import.meta.dir, '..');
const INVALID_SCOPES = [
  '',
  'default',
  'workspace',
  'GLOBAL',
  'global ',
  ' global',
  'project\n',
  'ｇｌｏｂａｌ',
  'global\u200b',
] as const;

function runCli(args: string[], cwd: string, home: string) {
  return Bun.spawnSync(['bun', join(root, 'src', 'cli.ts'), ...args], {
    cwd,
    env: sanitizedLocalTestEnv({ HOME: home, USERPROFILE: home }),
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

describe('blind pair 9 remediation', () => {
  test('warm root and direct workspace imports reject every noncanonical scope', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-warm-scope-'));
    try {
      expect(resolveScopedWorkspace('project', fixture).home)
        .toBe(join(fixture, '.hasna', 'knowledge'));
      expect(rootApi.resolveScopedWorkspace('local', fixture).home)
        .toBe(join(fixture, '.hasna', 'knowledge'));

      for (const scope of INVALID_SCOPES) {
        expect(() => resolveScopedWorkspace(scope, fixture), `direct:${JSON.stringify(scope)}`)
          .toThrow('Invalid knowledge scope');
        expect(() => rootApi.resolveScopedWorkspace(scope, fixture), `root:${JSON.stringify(scope)}`)
          .toThrow('Invalid knowledge scope');
      }
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('cold root import and direct service construction reject before workspace access', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-cold-scope-'));
    const home = join(fixture, 'home');
    const sourceRoot = pathToFileURL(join(root, 'src', 'index.ts')).href;
    const directService = pathToFileURL(join(root, 'src', 'service.ts')).href;
    const directWorkspace = pathToFileURL(join(root, 'src', 'workspace.ts')).href;
    const script = `
      const invalid = ${JSON.stringify(INVALID_SCOPES)};
      const root = await import(${JSON.stringify(sourceRoot)});
      const service = await import(${JSON.stringify(directService)});
      const workspace = await import(${JSON.stringify(directWorkspace)});
      let rejected = 0;
      for (let pass = 0; pass < 2; pass += 1) {
        for (const scope of invalid) {
          for (const operation of [
            () => root.createKnowledgeService({ scope, cwd: process.cwd(), env: {} }),
            () => service.createKnowledgeService({ scope, cwd: process.cwd(), env: {} }),
            () => root.resolveScopedWorkspace(scope, process.cwd()),
            () => workspace.resolveScopedWorkspace(scope, process.cwd()),
          ]) {
            try { operation(); }
            catch (error) {
              if (!String(error).includes('Invalid knowledge scope')) throw error;
              rejected += 1;
              continue;
            }
            throw new Error('noncanonical scope unexpectedly succeeded');
          }
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
      expect(JSON.parse(new TextDecoder().decode(result.stdout))).toEqual({
        rejected: INVALID_SCOPES.length * 4 * 2,
      });
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
      expect(existsSync(join(home, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('CLI rejects missing and noncanonical --scope values before workspace or store access', () => {
    for (const scope of [undefined, ...INVALID_SCOPES] as const) {
      const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-cli-scope-'));
      const home = join(fixture, 'home');
      try {
        const args = ['paths', '--scope'];
        if (scope !== undefined) args.push(scope);
        args.push('--json');
        const result = runCli(args, fixture, home);
        expect(result.exitCode, `scope=${JSON.stringify(scope)}`).toBe(1);
        expect(new TextDecoder().decode(result.stderr)).toContain('Invalid knowledge scope');
        const appWikiArgs = ['app-wiki', 'init', '--scope'];
        if (scope !== undefined) appWikiArgs.push(scope);
        appWikiArgs.push('--allow-global', '--json');
        const appWikiResult = runCli(appWikiArgs, fixture, home);
        expect(appWikiResult.exitCode, `app-wiki scope=${JSON.stringify(scope)}`).toBe(1);
        expect(new TextDecoder().decode(appWikiResult.stderr))
          .toContain('Invalid knowledge scope');
        expect(existsSync(join(fixture, '.hasna'))).toBe(false);
        expect(existsSync(join(home, '.hasna'))).toBe(false);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test('direct app-wiki guard validates scope before global authority and workspace inspection', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-app-wiki-scope-'));
    const globalWorkspace = resolveScopedWorkspace('global');
    try {
      for (const scope of INVALID_SCOPES) {
        expect(() => assertAppWikiWriteAllowed({
          scope,
          workspace: globalWorkspace,
          allowGlobal: true,
        }), JSON.stringify(scope)).toThrow('Invalid knowledge scope');
      }
      expect(() => assertAppWikiWriteAllowed({
        scope: 'global',
        workspace: globalWorkspace,
      })).toThrow(/Global app-wiki (?:writes|access) require/);
      expect(() => assertAppWikiWriteAllowed({
        scope: undefined,
        workspace: globalWorkspace,
      } as never)).toThrow(/Global app-wiki (?:writes|access) require/);
      expect(() => assertAppWikiWriteAllowed({
        scope: 'global',
        workspace: globalWorkspace,
        allowGlobal: true,
      })).not.toThrow();
      expect(() => assertAppWikiWriteAllowed({
        scope: undefined,
        workspace: globalWorkspace,
        allowGlobal: true,
      } as never)).not.toThrow();
      expect(existsSync(join(fixture, '.hasna'))).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('project-panel validates a supplied scope even when a service is injected', () => {
    let inventoryCalls = 0;
    const service = {
      inventory() {
        inventoryCalls += 1;
        throw new Error('inventory tripwire');
      },
    };
    for (const scope of INVALID_SCOPES) {
      expect(() => createKnowledgeProjectPanel('pair-9', {
        scope,
        service: service as never,
      })).toThrow('Invalid knowledge scope');
      expect(() => rootApi.createKnowledgeProjectPanel('pair-9', {
        scope,
        service: service as never,
      })).toThrow('Invalid knowledge scope');
    }
    expect(inventoryCalls).toBe(0);
  });

  test('manifest chunking proves bounded monotonic progress at 500/499 boundaries', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-chunk-progress-'));
    const sourceRef = pathToFileURL(join(fixture, 'source.txt')).href;
    const ingest = (name: string, text: string, overlap: number) =>
      ingestOpenFilesManifestItems({
        dbPath: join(fixture, `${name}.db`),
        sourceLabel: name,
        items: [{ source_ref: sourceRef, revision: name, extracted_text: text }],
        maxChunkChars: 500,
        chunkOverlapChars: overlap,
      });
    try {
      await expect(ingest('empty', ' \r\n ', 499)).resolves.toMatchObject({
        chunks_inserted: 0,
      });
      await expect(ingest('off-by-one-progress', `${'x'.repeat(499)}. `, 499))
        .resolves.toMatchObject({ chunks_inserted: 2 });
      await expect(ingest('boundary-progress', `${'x'.repeat(498)}. y`, 498))
        .resolves.toMatchObject({ chunks_inserted: 2 });
      await expect(ingest('equal-start', `${'x'.repeat(498)}. y`, 499))
        .rejects.toThrow('Manifest chunking failed to make monotonic progress.');
      await expect(ingest('bounded-large', 'x'.repeat(5_000), 499))
        .rejects.toThrow('Manifest chunking exceeds the 4096 iteration hard limit.');
      await expect(ingest('max-equal', 'x'.repeat(501), 500))
        .rejects.toThrow('chunkOverlapChars must be less than maxChunkChars.');
      await expect(ingestOpenFilesManifestItems({
        dbPath: join(fixture, 'fractional.db'),
        sourceLabel: 'fractional',
        items: [],
        maxChunkChars: 500.5,
        chunkOverlapChars: 499,
      })).rejects.toThrow('maxChunkChars must be an integer');
      await expect(ingestOpenFilesManifestItems({
        dbPath: join(fixture, 'fractional-overlap.db'),
        sourceLabel: 'fractional-overlap',
        items: [],
        maxChunkChars: 500,
        chunkOverlapChars: 499.5,
      })).rejects.toThrow('chunkOverlapChars must be an integer');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('outbox metadata merge enforces canonical JSON and the final UTF-8 ceiling', () => {
    const asciiBoundary = 'x'.repeat(MAX_INGEST_BODY_BYTES - 8);
    const asciiAtLimit = mergeOutboxMetadata(null, { a: asciiBoundary });
    expect(Buffer.byteLength(asciiAtLimit, 'utf8')).toBe(MAX_INGEST_BODY_BYTES);
    expect(() => mergeOutboxMetadata(null, { a: `${asciiBoundary}x` }))
      .toThrow('byte hard limit');

    const multibyteBoundary = '€'.repeat((MAX_INGEST_BODY_BYTES - 8) / 3);
    const multibyteAtLimit = mergeOutboxMetadata(null, { a: multibyteBoundary });
    expect(Buffer.byteLength(multibyteAtLimit, 'utf8')).toBe(MAX_INGEST_BODY_BYTES);
    expect(() => mergeOutboxMetadata(null, { a: `${multibyteBoundary}€` }))
      .toThrow('byte hard limit');

    const sharedBaseBytes = Buffer.byteLength(JSON.stringify({
      left: { value: '' },
      right: { value: '' },
    }));
    const sharedText = 's'.repeat(Math.floor((MAX_INGEST_BODY_BYTES - sharedBaseBytes) / 2));
    const shared = { value: sharedText };
    const sharedOutput = mergeOutboxMetadata(null, { left: shared, right: shared });
    expect(Buffer.byteLength(sharedOutput)).toBeLessThanOrEqual(MAX_INGEST_BODY_BYTES);
    const sharedOverflow = { value: `${sharedText}x` };
    expect(() => mergeOutboxMetadata(null, {
      left: sharedOverflow,
      right: sharedOverflow,
    })).toThrow('byte hard limit');

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse: unknown[] = new Array(2);
    sparse[0] = 'first';
    const nonIndex = ['first'] as unknown[] & { extra?: string };
    nonIndex.extra = 'blocked';
    for (const value of [cycle, undefined, sparse, nonIndex]) {
      expect(() => mergeOutboxMetadata(null, { nested: value }))
        .toThrow();
    }
    expect(() => mergeOutboxMetadata('{', { valid: true })).toThrow();
    expect(() => mergeOutboxMetadata('', { valid: true })).toThrow();
    expect(() => mergeOutboxMetadata('[]', { valid: true }))
      .toThrow('must be a JSON object');
  });

  test('outbox final metadata overflow fails before the transactional SQLite write', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'knowledge-pair-9-outbox-write-'));
    const dbPath = join(fixture, 'knowledge.db');
    const outboxPath = join(fixture, 'outbox.jsonl');
    const sourceRef = 'open-files://file/pair_9/revision/rev_1';
    const exactMetadata = mergeOutboxMetadata(null, {
      a: 'x'.repeat(MAX_INGEST_BODY_BYTES - 8),
    });
    try {
      await ingestOpenFilesManifestItems({
        dbPath,
        sourceLabel: 'pair-9-seed',
        items: [{ source_ref: sourceRef, revision: 'rev_1' }],
      });
      let db = openKnowledgeDb(dbPath);
      db.run('UPDATE sources SET metadata_json = ?', [exactMetadata]);
      db.close();
      writeFileSync(outboxPath, `${JSON.stringify({
        event: 'updated',
        source_ref: sourceRef,
        updated_at: '2026-07-18T00:00:00.000Z',
      })}\n`);

      await expect(consumeOpenFilesOutbox({ dbPath, input: outboxPath }))
        .rejects.toThrow('byte hard limit');
      db = openKnowledgeDb(dbPath);
      try {
        const row = db.query<{ metadata_json: string }, []>(
          'SELECT metadata_json FROM sources LIMIT 1',
        ).get();
        expect(row?.metadata_json).toBe(exactMetadata);
        expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM runs').get()?.n)
          .toBe(0);
      } finally {
        db.close();
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test('release docs and help dynamically reject contradictory Stage-A hosted or S3 enablement', () => {
    const rootMarkdown = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(root, entry.name));
    const files = [...rootMarkdown, ...markdownFiles(join(root, 'docs'))].sort();
    expect(files.length).toBeGreaterThan(10);
    const unconditionalContradictions = [
      /HASNA_KNOWLEDGE_ALLOW_S3_READS\s*=\s*(?:1|true)/i,
      /\bEnable S3 reads\b/i,
      /\bGenerated artifacts may use S3 when configured\b/i,
      /\bFile, S3, and web refs are useful\b/i,
      /\bknowledge\b[^\n]*(?:ingest|reindex|source)[^\n]*s3:\/\//i,
      /\.hasna\/apps\/knowledge/,
    ];
    const activeClaim = /\b(?:can|may|enable(?:d)?|useful|accepts?|appl(?:y|ies)|supports?|writes?|reads?)\b/i;
    const containmentContext = /\b(?:future|post-stage-a|defer(?:red)?|contain(?:ed|ment)?|unavailable|metadata|compatib(?:ility|le)|reject(?:ed|s)?|cannot|not executable|fail(?:s|ed)? closed)\b/i;
    const hostedSurface = /\b(?:hosted mode|setup --mode hosted|knowledge (?:auth|remote)|remote contracts|KNOWLEDGE_(?:API_URL|API_KEY))\b/i;
    const hostedEnablement = /\b(?:can|may|select(?:ed|s)?|record(?:ed|s)?|override(?:s)?|enable(?:d|s)?|use(?:d|s)?|connect(?:ed|s)?|construct(?:ed|s)?|print(?:ed|s)?|publish(?:ed|es)?|read(?:s)?|write(?:s)?)\b/i;
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      for (const contradiction of unconditionalContradictions) {
        expect(text, `${path}: ${contradiction}`).not.toMatch(contradiction);
      }
      for (const paragraph of text.split(/\n\s*\n/)) {
        if (/\bS3\b|s3:\/\//i.test(paragraph) && activeClaim.test(paragraph)) {
          expect(paragraph, `${path}: active S3 claim lacks containment context`)
            .toMatch(containmentContext);
        }
        if (hostedSurface.test(paragraph) && hostedEnablement.test(paragraph)) {
          expect(paragraph, `${path}: active hosted claim lacks containment context`)
            .toMatch(containmentContext);
        }
      }
    }

    const cli = readFileSync(join(root, 'src', 'cli.ts'), 'utf8');
    const mcp = readFileSync(join(root, 'src', 'mcp.js'), 'utf8');
    expect(cli).not.toContain('Configure OSS local or hosted-aware mode');
    expect(cli).toContain('hosted is contained compatibility metadata');
    expect(mcp).not.toContain('Inspect local/S3 artifact storage');
    expect(mcp).toContain('contained S3 compatibility metadata');
  });

  test('retained S3 safety inputs cannot enable execution or inspect policy state', () => {
    let policyReads = 0;
    const hostilePolicy = new Proxy({}, {
      get() {
        policyReads += 1;
        throw new Error('policy tripwire');
      },
    });
    expect(() => assertS3ReadAllowed(
      's3://synthetic-stage-a-bucket/manifest.jsonl',
      hostilePolicy as never,
    )).toThrow(expect.objectContaining({
      code: 'KNOWLEDGE_HOSTED_CONTAINED',
      status: 503,
    }));
    expect(policyReads).toBe(0);
  });
});
