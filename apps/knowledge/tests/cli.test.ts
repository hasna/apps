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

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return Bun.spawnSync(['bun', CLI, ...args], {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
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

    const storage = runCli(['storage', 'status', '--scope', 'project', '--json'], dir);
    expect(storage.exitCode).toBe(0);
    const storageOut = JSON.parse(new TextDecoder().decode(storage.stdout));
    expect(storageOut.local_layout.app_path).toBe(join('.hasna', 'apps', 'knowledge'));
    expect(storageOut.artifact_store.type).toBe('local');
    expect(storageOut.source_ownership.owner).toBe('open-files');
    expect(storageOut.source_ownership.raw_source_bytes_stored_in_open_knowledge).toBe(false);

    const validate = runCli(['storage', 'validate', '--scope', 'project', '--json'], dir);
    expect(validate.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(validate.stdout)).ok).toBe(true);

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
    expect(initOut.schema_version).toBe(4);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'knowledge.db'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.schema_version).toBe(4);
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
    expect(ingestOut.audit_events).toBeUndefined();

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.sources).toBe(1);
    expect(statsOut.source_revisions).toBe(1);
    expect(statsOut.chunks).toBe(1);

    const resolve = runCli(['source', 'resolve', 'open-files://file/file_123/revision/rev_cli', '--scope', 'project', '--json'], dir);
    expect(resolve.exitCode).toBe(0);
    const resolveOut = JSON.parse(new TextDecoder().decode(resolve.stdout));
    expect(resolveOut.resolved).toBe(true);
    expect(resolveOut.read_only).toBe(true);
    expect(resolveOut.content.bytes_exposed).toBe(false);
    expect(resolveOut.content.chunks_returned).toBe(1);
    expect(resolveOut.chunks[0].text).toContain('open-files');
    expect(resolveOut.chunks[0].evidence).toMatchObject({
      resolver: 'open-files-read-only',
      mode: 'local_catalog',
      purpose: 'knowledge_answer',
      read_only: true,
      source_uri: 'open-files://file/file_123',
      revision: 'rev_cli',
    });

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
    expect(statsAfterOut.audit_events).toBeGreaterThanOrEqual(4);
  });

  test('ingest source imports a read-only file ref into project knowledge.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ingest-source-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI source ingestion reads file refs without copying raw files.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);
    const ingestOut = JSON.parse(new TextDecoder().decode(ingest.stdout));
    expect(ingestOut.content_source).toBe('file');
    expect(ingestOut.source_ref).toBe(sourceRef);
    expect(ingestOut.chunks_inserted).toBe(1);
    expect(ingestOut.read_only).toBe(true);

    const resolve = runCli(['source', 'resolve', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(resolve.exitCode).toBe(0);
    const resolveOut = JSON.parse(new TextDecoder().decode(resolve.stdout));
    expect(resolveOut.resolved).toBe(true);
    expect(resolveOut.source.kind).toBe('file');
    expect(resolveOut.content.bytes_exposed).toBe(false);
    expect(resolveOut.chunks[0].text).toContain('CLI source ingestion');
  });

  test('embeddings commands index and search chunks with deterministic vectors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-embeddings-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI semantic embeddings should find this company wiki source.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const index = runCli(['embeddings', 'index', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(index.exitCode).toBe(0);
    const indexOut = JSON.parse(new TextDecoder().decode(index.stdout));
    expect(indexOut.chunks_embedded).toBe(1);
    expect(indexOut.vector_entries_upserted).toBe(1);

    const status = runCli(['embeddings', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.total_vector_entries).toBe(1);

    const search = runCli(['embeddings', 'search', 'company', 'wiki', 'source', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(search.exitCode).toBe(0);
    const searchOut = JSON.parse(new TextDecoder().decode(search.stdout));
    expect(searchOut.results).toHaveLength(1);
    expect(searchOut.results[0].provenance.source_uri).toBe(sourceRef);
  });

  test('search command returns hybrid source, wiki, and semantic results', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-search-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI hybrid search should find source-governed company wiki content.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const wiki = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(wiki.exitCode).toBe(0);

    const sourceSearch = runCli(['search', 'source', 'company', 'wiki', '--scope', 'project', '--json'], dir);
    expect(sourceSearch.exitCode).toBe(0);
    const sourceSearchOut = JSON.parse(new TextDecoder().decode(sourceSearch.stdout));
    expect(sourceSearchOut.mode.semantic).toBe(false);
    expect(sourceSearchOut.results.some((entry: any) => entry.kind === 'source_chunk' && entry.source.uri === sourceRef)).toBe(true);

    const wikiSearch = runCli(['search', 'durable', 'knowledge', 'pages', '--scope', 'project', '--json'], dir);
    expect(wikiSearch.exitCode).toBe(0);
    const wikiSearchOut = JSON.parse(new TextDecoder().decode(wikiSearch.stdout));
    expect(wikiSearchOut.results.some((entry: any) => entry.kind === 'wiki_chunk' && entry.artifact.path === 'wiki/README.md')).toBe(true);

    const index = runCli(['embeddings', 'index', '--scope', 'project', '--fake', '--dimensions', '8', '--json'], dir);
    expect(index.exitCode).toBe(0);

    const semantic = runCli(['search', 'company', 'wiki', 'content', '--scope', 'project', '--semantic', '--fake', '--dimensions', '8', '--json'], dir);
    expect(semantic.exitCode).toBe(0);
    const semanticOut = JSON.parse(new TextDecoder().decode(semantic.stdout));
    expect(semanticOut.mode.semantic).toBe(true);
    expect(semanticOut.counts.semantic_results).toBeGreaterThan(0);

    const context = runCli(['search', 'company', 'wiki', 'content', '--context', '--scope', 'project', '--semantic', '--fake', '--dimensions', '8', '--json'], dir);
    expect(context.exitCode).toBe(0);
    const contextOut = JSON.parse(new TextDecoder().decode(context.stdout));
    expect(contextOut.excerpts.length).toBeGreaterThan(0);
    expect(contextOut.citations[0].provenance.source_owner).toBe('open-files');
  });

  test('ask and knowledge commands build citation drafts with run ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-ask-cli-'));
    const source = join(dir, 'source.md');
    writeFileSync(source, 'CLI ask command should cite company handbook source context.');
    const sourceRef = `file://${source}`;

    const ingest = runCli(['ingest', 'source', sourceRef, '--purpose', 'knowledge_index', '--scope', 'project', '--json'], dir);
    expect(ingest.exitCode).toBe(0);

    const ask = runCli(['ask', 'How', 'should', 'we', 'cite', 'the', 'handbook?', '--scope', 'project', '--json'], dir);
    expect(ask.exitCode).toBe(0);
    const askOut = JSON.parse(new TextDecoder().decode(ask.stdout));
    expect(askOut.generated).toBe(false);
    expect(askOut.citations[0].source_uri).toBe(sourceRef);
    expect(askOut.write_policy.durable_writes_performed).toBe(false);

    const knowledge = runCli(['knowledge', 'Generate', 'fake', 'answer', '--scope', 'project', '--generate', '--fake', '--model', 'openai:gpt-5-mini', '--json'], dir);
    expect(knowledge.exitCode).toBe(0);
    const knowledgeOut = JSON.parse(new TextDecoder().decode(knowledge.stdout));
    expect(knowledgeOut.generated).toBe(true);
    expect(knowledgeOut.answer).toContain('Fake generated answer');

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.runs).toBe(2);
  });

  test('safety commands expose policy, approvals, redaction, audit, and S3 denial', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-safety-cli-'));

    const status = runCli(['safety', 'status', '--scope', 'project', '--json'], dir);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.network.webSearchEnabled).toBe(false);
    expect(statusOut.network.s3ReadsEnabled).toBe(false);
    expect(statusOut.redaction.enabled).toBe(true);

    const check = runCli(['safety', 'check', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(check.exitCode).toBe(0);
    const checkOut = JSON.parse(new TextDecoder().decode(check.stdout));
    expect(checkOut.approval_required).toBe(true);
    expect(checkOut.decision).toBe('requires_approval');

    const approve = runCli(['safety', 'approve', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(approve.exitCode).toBe(0);
    const approveOut = JSON.parse(new TextDecoder().decode(approve.stdout));
    expect(approveOut.status).toBe('approved');

    const checkAfter = runCli(['safety', 'check', 'generated_write', 'wiki://answer', '--scope', 'project', '--json'], dir);
    expect(checkAfter.exitCode).toBe(0);
    const checkAfterOut = JSON.parse(new TextDecoder().decode(checkAfter.stdout));
    expect(checkAfterOut.decision).toBe('allow');

    const redact = runCli(['safety', 'redact', 'token=sk-testsecretkeyvalue1234567890', '--scope', 'project', '--json'], dir);
    expect(redact.exitCode).toBe(0);
    const redactOut = JSON.parse(new TextDecoder().decode(redact.stdout));
    expect(redactOut.text).toBe('[REDACTED:secret_assignment]');
    expect(redactOut.findings).toHaveLength(1);

    const audit = runCli(['safety', 'audit', '--scope', 'project', '--json'], dir);
    expect(audit.exitCode).toBe(0);
    const auditOut = JSON.parse(new TextDecoder().decode(audit.stdout));
    expect(auditOut.events.length).toBeGreaterThanOrEqual(4);

    const denied = runCli(['ingest', 'manifest', 's3://not-allowed/manifest.jsonl', '--scope', 'project', '--json'], dir);
    expect(denied.exitCode).toBe(1);
    expect(new TextDecoder().decode(denied.stderr)).toContain('Safety policy denied S3 read');
  });

  test('providers commands expose model aliases and credential checks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-providers-cli-'));
    const env = { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '' };

    const status = runCli(['providers', 'status', '--scope', 'project', '--json'], dir, env);
    expect(status.exitCode).toBe(0);
    const statusOut = JSON.parse(new TextDecoder().decode(status.stdout));
    expect(statusOut.default_model).toBe('openai:gpt-5.2');
    expect(statusOut.providers).toHaveLength(3);
    expect(statusOut.providers.find((entry: any) => entry.provider === 'openai').configured).toBe(false);

    const models = runCli(['providers', 'models', '--scope', 'project', '--json'], dir, env);
    expect(models.exitCode).toBe(0);
    const modelsOut = JSON.parse(new TextDecoder().decode(models.stdout));
    expect(modelsOut.models.find((entry: any) => entry.alias === 'deepseek-reasoning')).toMatchObject({
      model_ref: 'deepseek:deepseek-reasoner',
      provider: 'deepseek',
    });

    const missing = runCli(['providers', 'check', 'default', '--scope', 'project', '--json'], dir, env);
    expect(missing.exitCode).toBe(1);
    expect(new TextDecoder().decode(missing.stderr)).toContain('Missing OPENAI_API_KEY');
  });

  test('wiki init creates scalable wiki artifacts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ok-wiki-cli-'));

    const init = runCli(['wiki', 'init', '--scope', 'project', '--json'], dir);
    expect(init.exitCode).toBe(0);
    const initOut = JSON.parse(new TextDecoder().decode(init.stdout));
    expect(initOut.written).toContain('schemas/v1.md');
    expect(initOut.written).toContain('indexes/root.md');
    expect(initOut.written).toContain('wiki/README.md');
    expect(initOut.artifacts).toHaveLength(4);
    expect(initOut.artifacts.every((entry: any) => entry.hash.startsWith('sha256:'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'schemas', 'v1.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'indexes', 'root.md'))).toBe(true);
    expect(existsSync(join(dir, '.hasna', 'apps', 'knowledge', 'artifacts', 'wiki', 'README.md'))).toBe(true);

    const stats = runCli(['db', 'stats', '--scope', 'project', '--json'], dir);
    expect(stats.exitCode).toBe(0);
    const statsOut = JSON.parse(new TextDecoder().decode(stats.stdout));
    expect(statsOut.storage_objects).toBe(4);
    expect(statsOut.wiki_pages).toBe(1);
    expect(statsOut.indexes).toBe(1);
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
