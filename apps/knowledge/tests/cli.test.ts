/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceRef } from '../src/source-ref';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.ts');
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

function runCli(args: string[], cwd?: string) {
  return Bun.spawnSync(['bun', CLI, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  });
}

describe('open-knowledge cli', () => {
  test('help and subcommand help work', () => {
    const result = runCli(['--help']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain('open-knowledge');
    expect(out).toContain('Commands:');

    const sub = runCli(['help', 'list']);
    expect(sub.exitCode).toBe(0);
    const subOut = new TextDecoder().decode(sub.stdout);
    expect(subOut).toContain('--sort created|title');
  });

  test('version flag works', () => {
    const result = runCli(['--version']);
    expect(result.exitCode).toBe(0);
    const out = new TextDecoder().decode(result.stdout);
    expect(out).toContain(packageJson.name);
    expect(out).toContain(packageJson.version);
  });

  test('unknown command includes suggestion', () => {
    const result = runCli(['lits']);
    expect(result.exitCode).toBe(1);
    const err = new TextDecoder().decode(result.stderr);
    expect(err).toContain("Did you mean 'list'");
  });

  test('add/list/get/update/archive/restore/untag/delete flow with json and confirmation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-cli-'));
    const store = join(dir, 'db.json');

    const addA = runCli(['add', 'TitleB', 'BodyA', '--store', store, '--json']);
    expect(addA.exitCode).toBe(0);
    const addAOut = JSON.parse(new TextDecoder().decode(addA.stdout));

    const addB = runCli(['add', 'TitleA', 'BodyB', '--store', store, '--json']);
    expect(addB.exitCode).toBe(0);
    const addBOut = JSON.parse(new TextDecoder().decode(addB.stdout));

    const list = runCli(['ls', '--store', store, '--json', '-p', '1', '-l', '10', '--sort', 'title']);
    expect(list.exitCode).toBe(0);
    const listOut = JSON.parse(new TextDecoder().decode(list.stdout));
    expect(listOut.total).toBe(2);
    expect(listOut.total_pages).toBe(1);
    expect(listOut.items[0].title).toBe('TitleA');

    const get = runCli(['get', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(get.exitCode).toBe(0);
    const getOut = JSON.parse(new TextDecoder().decode(get.stdout));
    expect(getOut.item.content).toBe('BodyA');

    const update = runCli(['update', '--id', getOut.item.id, '--store', store, '--tag', 'rust', '--json']);
    expect(update.exitCode).toBe(0);
    const updateOut = JSON.parse(new TextDecoder().decode(update.stdout));
    expect(updateOut.item.tags).toContain('rust');

    const untag = runCli(['untag', '--id', getOut.item.id, '--store', store, '--tag', 'rust', '--json']);
    expect(untag.exitCode).toBe(0);
    const untagOut = JSON.parse(new TextDecoder().decode(untag.stdout));
    expect(untagOut.item.tags).not.toContain('rust');

    const archive = runCli(['archive', '--id', getOut.item.id, '--store', store, '--json']);
    expect(archive.exitCode).toBe(0);
    const archivedList = runCli(['list', '--store', store, '--json']);
    expect(JSON.parse(new TextDecoder().decode(archivedList.stdout)).total).toBe(1);
    const onlyArchived = runCli(['list', '--store', store, '--archived', '--json']);
    expect(JSON.parse(new TextDecoder().decode(onlyArchived.stdout)).total).toBe(1);

    const restore = runCli(['restore', '--id', getOut.item.id, '--store', store, '--json']);
    expect(restore.exitCode).toBe(0);

    const delNoYes = runCli(['rm', '--id', addAOut.item.id, '--store', store, '--json']);
    expect(delNoYes.exitCode).toBe(1);
    const delErr = new TextDecoder().decode(delNoYes.stderr);
    expect(delErr).toContain('Refusing delete without --yes');

    const del = runCli(['delete', '--id', addAOut.item.id, '--store', store, '--json', '--yes']);
    expect(del.exitCode).toBe(0);
    const delOut = JSON.parse(new TextDecoder().decode(del.stdout));
    expect(delOut.ok).toBe(true);

    const del2 = runCli(['delete', '--id', addBOut.item.id, '--store', store, '--json', '--yes']);
    expect(del2.exitCode).toBe(0);

    const db = JSON.parse(readFileSync(store, 'utf8'));
    expect(db.items.length).toBe(0);
  });

  test('upsert creates and updates items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-upsert-'));
    const store = join(dir, 'db.json');

    const create = runCli(['upsert', 'Stable ID', 'Initial body', '--id', 'k_custom', '--store', store, '--json']);
    expect(create.exitCode).toBe(0);
    const createOut = JSON.parse(new TextDecoder().decode(create.stdout));
    expect(createOut.created).toBe(true);
    expect(createOut.item.short_id).toBe('custom');

    const update = runCli(['upsert', '--id', 'k_custom', '--content', 'Updated body', '--store', store, '--json']);
    expect(update.exitCode).toBe(0);
    const updateOut = JSON.parse(new TextDecoder().decode(update.stdout));
    expect(updateOut.created).toBe(false);
    expect(updateOut.item.content).toBe('Updated body');
  });

  test('project scope uses .hasna/apps/knowledge workspace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-workspace-'));

    const paths = runCli(['paths', '--scope', 'project', '--json'], dir);
    expect(paths.exitCode).toBe(0);
    const pathsOut = JSON.parse(new TextDecoder().decode(paths.stdout));
    expect(pathsOut.home).toBe(join(dir, '.hasna', 'apps', 'knowledge'));
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'config.json'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'runs'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'wiki'))).toBe(true);

    const add = runCli(['add', 'Project scoped', 'Stored in the Hasna app workspace', '--scope', 'project', '--json'], dir);
    expect(add.exitCode).toBe(0);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'db.json'))).toBe(true);
    expect(existsSync(join(dir, '.open-knowledge', 'db.json'))).toBe(false);
  });

  test('db init and stats create project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-db-cli-'));

    const init = runCli(['db', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.schema_version).toBe(2);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'knowledge.db'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.schema_version).toBe(2);
    expect(statsOut.sources).toBe(0);
    expect(statsOut.runs).toBe(0);
  });

  test('ingest manifest imports open-files refs into project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ingest-cli-'));
    const manifest = join(dir, 'manifest.jsonl');
    const outbox = join(dir, 'outbox.jsonl');
    writeFileSync(manifest, `${JSON.stringify({
      source_ref: 'open-files://file/file_123/revision/rev_cli',
      file_id: 'file_123',
      source_id: 'src_local',
      path: 'docs/handbook.md',
      name: 'handbook.md',
      mime: 'text/markdown',
      size: 64,
      hash: 'sha256:cli',
      status: 'active',
      updated_at: '2026-06-08T00:00:00.000Z',
      permissions: { mode: 'read_only' },
      extracted_text: 'This handbook was ingested from open-files.',
    })}\n`);

    const ingest = runCli(['ingest', 'manifest', manifest, '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);
    const ingestOut = JSON.parse(new TextDecoder().decode(ingest.stdout));
    expect(ingestOut.items_seen).toBe(1);
    expect(ingestOut.sources_upserted).toBe(1);
    expect(ingestOut.revisions_upserted).toBe(1);
    expect(ingestOut.chunks_inserted).toBe(1);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.sources).toBe(1);
    expect(statsOut.source_revisions).toBe(1);
    expect(statsOut.chunks).toBe(1);

    writeFileSync(outbox, `${JSON.stringify({
      event: 'deleted',
      source_ref: 'open-files://file/file_123/revision/rev_cli',
      status: 'deleted',
      hash: 'sha256:cli',
      updated_at: '2026-06-08T00:01:00.000Z',
    })}\n`);

    const reindex = runCli(['reindex', 'outbox', outbox, '--scope', 'project', '--json'], dir);
    expect(reindex.exitCode).toBe(0);
    const reindexOut = JSON.parse(new TextDecoder().decode(reindex.stdout));
    expect(reindexOut.events_seen).toBe(1);
    expect(reindexOut.chunks_deleted).toBe(1);
    expect(reindexOut.deleted_sources).toBe(1);

    const statsAfter = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(statsAfter.exitCode).toBe(0);
    const statsAfterOut = JSON.parse(new TextDecoder().decode(statsAfter.stdout));
    expect(statsAfterOut.chunks).toBe(0);
    expect(statsAfterOut.runs).toBe(1);
    expect(statsAfterOut.run_events).toBe(1);
  });

  test('wiki init creates scalable wiki artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-cli-'));

    const init = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.written).toContain('schemas/v1.md');
    expect(initOut.written).toContain('indexes/root.md');
    expect(initOut.written).toContain('wiki/README.md');
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'schemas', 'v1.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'indexes', 'root.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);
  });

  test('source refs cover open-files, s3, local files, and web URLs', () => {
    expect(parseSourceRef('open-files://file/file_123')).toMatchObject({
      kind: 'open-files',
      entity: 'file',
      id: 'file_123',
    });
    expect(parseSourceRef('open-files://file/file_123/revision/rev_456')).toMatchObject({
      kind: 'open-files',
      entity: 'file',
      id: 'file_123',
      revision_id: 'rev_456',
    });
    expect(parseSourceRef('open-files://source/src_123/path/docs/readme.md')).toMatchObject({
      kind: 'open-files',
      entity: 'source',
      id: 'src_123',
      path: 'docs/readme.md',
    });
    expect(parseSourceRef('s3://company-bucket/docs/handbook.pdf')).toMatchObject({
      kind: 's3',
      bucket: 'company-bucket',
      key: 'docs/handbook.pdf',
    });
    expect(parseSourceRef('file:///tmp/readme.md')).toMatchObject({ kind: 'file', path: '/tmp/readme.md' });
    expect(parseSourceRef('https://example.com/docs')).toMatchObject({ kind: 'web', url: 'https://example.com/docs' });
  });
});
