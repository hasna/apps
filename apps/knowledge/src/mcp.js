#!/usr/bin/env bun
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pkg from '../package.json' with { type: 'json' };
import { migrateKnowledgeDb, openKnowledgeDb } from './knowledge-db.ts';
import { defaultStorePath, loadStore, saveStore, makeId, withLock } from './store.ts';
import { parseSourceRef } from './source-ref.ts';
import { createKnowledgeService } from './service.ts';
import {
  getStorageStatus as getDatabaseStorageStatus,
  storagePull as databaseStoragePull,
  storagePush as databaseStoragePush,
  storageSync as databaseStorageSync,
} from './storage.ts';

const storePathField = z.string().optional().describe('Path to the JSON store file');
const scopeField = z.enum(['local', 'global', 'project']).optional().describe('Workspace scope');

function jsonText(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorText(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function shortIdFor(id) {
  return id.replace(/^k_/, '').slice(0, 12);
}

function resolveStorePath(storePath, scope) {
  if (storePath) return storePath;
  if (scope === 'project' || scope === 'local') {
    return createKnowledgeService({ scope }).jsonStorePath();
  }
  return defaultStorePath();
}

function readStoreLocked(storePath, fn) {
  return withLock(storePath, () => fn(loadStore(storePath)));
}

function writeStoreLocked(storePath, fn) {
  return withLock(storePath, () => {
    const db = loadStore(storePath);
    const result = fn(db);
    saveStore(storePath, db);
    return result;
  });
}

function findItem(db, id) {
  return db.items.find((item) => item.id === id || item.short_id === id);
}

function sortItems(items, sort = 'created', desc = false) {
  const sorted = [...items].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return a.created_at.localeCompare(b.created_at);
  });
  if (desc) sorted.reverse();
  return sorted;
}

function activeItems(items, includeArchived) {
  return includeArchived ? items : items.filter((item) => !item.archived);
}

function limitNumber(value, fallback = 20, max = 100) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonResource(uri, data) {
  return {
    contents: [{
      uri: uri.toString(),
      mimeType: 'application/json',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function registerTool(server, name, title, description, inputSchema, handler) {
  server.registerTool(name, { title, description, inputSchema }, handler);
}

function registerJsonResource(server, name, uri, title, description, read) {
  server.registerResource(name, uri, {
    title,
    description,
    mimeType: 'application/json',
  }, async (resourceUri) => jsonResource(resourceUri, await read(resourceUri)));
}

function registerJsonTemplate(server, name, template, title, description, list, read) {
  server.registerResource(name, new ResourceTemplate(template, { list }), {
    title,
    description,
    mimeType: 'application/json',
  }, async (resourceUri, variables) => jsonResource(resourceUri, await read(resourceUri, variables)));
}

function projectService() {
  return createKnowledgeService({ scope: 'project' });
}

function openProjectDb(service = projectService()) {
  const workspace = service.ensureWorkspace();
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return openKnowledgeDb(workspace.knowledgeDbPath);
}

function itemResources(storePath = createKnowledgeService({ scope: 'project' }).jsonStorePath()) {
  return readStoreLocked(storePath, (db) => activeItems(db.items, false).slice(0, 100).map((item) => ({
    uri: `knowledge://project/items/${encodeURIComponent(item.id)}`,
    name: item.title,
    description: `Knowledge item ${item.id}`,
    mimeType: 'application/json',
  })));
}

function listRows(db, sql, params = []) {
  return db.query(sql).all(...params);
}

function rowWithJson(row, fields = ['metadata_json', 'acl_json']) {
  if (!row) return null;
  const next = { ...row };
  for (const field of fields) {
    if (field in next) {
      const name = field.endsWith('_json') ? field.slice(0, -5) : field;
      next[name] = parseJsonObject(next[field]);
      delete next[field];
    }
  }
  return next;
}

function dbStatsSnapshot(service = projectService()) {
  const stats = service.dbStats();
  const db = openProjectDb(service);
  try {
    return {
      ok: true,
      scope: 'project',
      path: service.workspace.knowledgeDbPath,
      stats,
      schema_versions: listRows(db, 'SELECT version, applied_at FROM schema_versions ORDER BY version ASC'),
    };
  } finally {
    db.close();
  }
}

function storageSnapshot(service = projectService()) {
  const validation = service.validateStorage();
  return {
    ok: validation.ok,
    scope: 'project',
    paths: service.paths(),
    storage: service.storageContract(),
    validation,
  };
}

function configSnapshot(service = projectService()) {
  return {
    ok: true,
    scope: 'project',
    package: {
      name: pkg.name,
      version: pkg.version,
    },
    paths: service.paths(),
    storage: service.storageContract(),
    provider_status: service.providerStatus(),
    model_registry: service.modelRegistry(),
  };
}

function sourceRows(limit = 50, service = projectService()) {
  const db = openProjectDb(service);
  try {
    return listRows(db, `
      SELECT
        s.id,
        s.uri,
        s.kind,
        s.title,
        s.metadata_json,
        s.acl_json,
        s.created_at,
        s.updated_at,
        COUNT(DISTINCT sr.id) AS revisions,
        COUNT(DISTINCT c.id) AS chunks
      FROM sources s
      LEFT JOIN source_revisions sr ON sr.source_id = s.id
      LEFT JOIN chunks c ON c.source_revision_id = sr.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT ?
    `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row));
  } finally {
    db.close();
  }
}

function sourceSnapshot(id, { limit = 10, service = projectService() } = {}) {
  const db = openProjectDb(service);
  try {
    const source = rowWithJson(db.query(`
      SELECT id, uri, kind, title, metadata_json, acl_json, created_at, updated_at
      FROM sources
      WHERE id = ? OR uri = ?
    `).get(id, id));
    if (!source) return null;
    const revisions = listRows(db, `
      SELECT id, revision, hash, extracted_text_uri, metadata_json, created_at
      FROM source_revisions
      WHERE source_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [source.id, limitNumber(limit, 10, 100)]).map((row) => rowWithJson(row, ['metadata_json']));
    const chunks = listRows(db, `
      SELECT c.id, c.kind, c.ordinal, c.text, c.token_count, c.start_offset, c.end_offset, c.metadata_json, c.created_at,
             sr.revision, sr.hash
      FROM chunks c
      JOIN source_revisions sr ON sr.id = c.source_revision_id
      WHERE sr.source_id = ?
      ORDER BY sr.created_at DESC, c.ordinal ASC
      LIMIT ?
    `, [source.id, limitNumber(limit, 10, 50)]).map((row) => rowWithJson(row, ['metadata_json']));
    return { source, revisions, chunks };
  } finally {
    db.close();
  }
}

function openFilesSnapshot(service = projectService()) {
  const db = openProjectDb(service);
  try {
    const rows = listRows(db, `
      SELECT
        s.id,
        s.uri,
        s.title,
        sr.revision,
        sr.hash,
        c.metadata_json,
        COUNT(c.id) AS chunks
      FROM sources s
      JOIN source_revisions sr ON sr.source_id = s.id
      LEFT JOIN chunks c ON c.source_revision_id = sr.id
      WHERE s.uri LIKE 'open-files://%'
      GROUP BY s.id, sr.id
      ORDER BY s.updated_at DESC
      LIMIT 100
    `);
    return {
      ok: true,
      scope: 'project',
      source_ownership: 'open-files',
      raw_source_bytes_exposed: false,
      refs: rows.map((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        return {
          id: row.id,
          uri: row.uri,
          source_ref: typeof metadata.source_ref === 'string' ? metadata.source_ref : row.uri,
          title: row.title,
          revision: row.revision,
          hash: row.hash,
          chunks: row.chunks,
        };
      }),
    };
  } finally {
    db.close();
  }
}

function wikiRows(limit = 50, service = projectService()) {
  const db = openProjectDb(service);
  try {
    return listRows(db, `
      SELECT id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at
      FROM wiki_pages
      ORDER BY updated_at DESC
      LIMIT ?
    `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json']));
  } finally {
    db.close();
  }
}

async function wikiSnapshot(id, { includeContent = true, service = projectService() } = {}) {
  const db = openProjectDb(service);
  try {
    const page = rowWithJson(db.query(`
      SELECT id, path, title, artifact_uri, content_hash, status, metadata_json, created_at, updated_at
      FROM wiki_pages
      WHERE id = ? OR path = ?
    `).get(id, id), ['metadata_json']);
    if (!page) return null;
    const citations = listRows(db, `
      SELECT id, chunk_id, source_uri, quote, start_offset, end_offset, metadata_json, created_at
      FROM citations
      WHERE wiki_page_id = ?
      ORDER BY created_at ASC
      LIMIT 100
    `, [page.id]).map((row) => rowWithJson(row, ['metadata_json']));
    let content = null;
    if (includeContent) {
      const artifactKey = page.metadata?.artifact_key ?? page.path;
      if (typeof artifactKey === 'string') {
        try {
          content = await service.artifactStore().getText(artifactKey);
        } catch {
          content = null;
        }
      }
    }
    return { page, citations, content };
  } finally {
    db.close();
  }
}

function indexRows(limit = 50, service = projectService()) {
  const db = openProjectDb(service);
  try {
    return listRows(db, `
      SELECT id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at
      FROM knowledge_indexes
      ORDER BY updated_at DESC
      LIMIT ?
    `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json']));
  } finally {
    db.close();
  }
}

function indexSnapshot(id, service = projectService()) {
  const db = openProjectDb(service);
  try {
    const index = rowWithJson(db.query(`
      SELECT id, kind, name, artifact_uri, shard_key, metadata_json, created_at, updated_at
      FROM knowledge_indexes
      WHERE id = ? OR name = ? OR shard_key = ?
    `).get(id, id, id), ['metadata_json']);
    if (!index) return null;
    const vector_counts = listRows(db, `
      SELECT provider, model, dimensions, status, COUNT(*) AS entries
      FROM vector_index_entries
      GROUP BY provider, model, dimensions, status
      ORDER BY entries DESC
      LIMIT 50
    `);
    return { index, vector_counts };
  } finally {
    db.close();
  }
}

function runRows(limit = 50, service = projectService()) {
  const db = openProjectDb(service);
  try {
    return listRows(db, `
      SELECT id, type, prompt, status, provider, model, cost_tokens, cost_usd, metadata_json, created_at, updated_at
      FROM runs
      ORDER BY updated_at DESC
      LIMIT ?
    `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json']));
  } finally {
    db.close();
  }
}

function runSnapshot(id, { limit = 50, service = projectService() } = {}) {
  const db = openProjectDb(service);
  try {
    const run = rowWithJson(db.query(`
      SELECT id, type, prompt, status, provider, model, cost_tokens, cost_usd, metadata_json, created_at, updated_at
      FROM runs
      WHERE id = ?
    `).get(id), ['metadata_json']);
    if (!run) return null;
    const events = listRows(db, `
      SELECT id, level, event, metadata_json, created_at
      FROM run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `, [id, limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json']));
    const usage = listRows(db, `
      SELECT id, provider, model, input_tokens, output_tokens, cost_usd, metadata_json, created_at
      FROM provider_usage
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT 100
    `, [id]).map((row) => rowWithJson(row, ['metadata_json']));
    return { run, events, usage };
  } finally {
    db.close();
  }
}

function decisionsSnapshot(limit = 50, service = projectService()) {
  const db = openProjectDb(service);
  try {
    return {
      ok: true,
      scope: 'project',
      approval_gates: listRows(db, `
        SELECT id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at
        FROM approval_gates
        ORDER BY updated_at DESC
        LIMIT ?
      `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json'])),
      audit_events: listRows(db, `
        SELECT id, event_type, action, target_uri, decision, metadata_json, created_at
        FROM audit_events
        ORDER BY created_at DESC
        LIMIT ?
      `, [limitNumber(limit, 50, 200)]).map((row) => rowWithJson(row, ['metadata_json'])),
    };
  } finally {
    db.close();
  }
}

function decisionSnapshot(id, service = projectService()) {
  const db = openProjectDb(service);
  try {
    const approval = rowWithJson(db.query(`
      SELECT id, action, target_uri, status, reason, approved_by, metadata_json, created_at, updated_at
      FROM approval_gates
      WHERE id = ? OR target_uri = ?
    `).get(id, id), ['metadata_json']);
    if (approval) return { kind: 'approval_gate', decision: approval };
    const audit = rowWithJson(db.query(`
      SELECT id, event_type, action, target_uri, decision, metadata_json, created_at
      FROM audit_events
      WHERE id = ? OR target_uri = ?
    `).get(id, id), ['metadata_json']);
    return audit ? { kind: 'audit_event', decision: audit } : null;
  } finally {
    db.close();
  }
}

async function getKnowledgeRecord(kind, id, options = {}) {
  const normalized = kind ?? 'auto';
  const service = createKnowledgeService({ scope: options.scope });
  const attempts = normalized === 'auto'
    ? ['item', 'source', 'wiki_page', 'run', 'index', 'decision']
    : [normalized];

  for (const entry of attempts) {
    if (entry === 'item') {
      const storePath = resolveStorePath(options.store_path, options.scope);
      const item = readStoreLocked(storePath, (db) => findItem(db, id));
      if (item) return { kind: 'item', item, store_path: storePath };
    }
    if (entry === 'source') {
      const source = sourceSnapshot(id, { limit: options.limit, service });
      if (source) return { kind: 'source', ...source };
    }
    if (entry === 'wiki_page') {
      const page = await wikiSnapshot(id, { includeContent: options.include_content !== false, service });
      if (page) return { kind: 'wiki_page', ...page };
    }
    if (entry === 'run') {
      const run = runSnapshot(id, { limit: options.limit, service });
      if (run) return { kind: 'run', ...run };
    }
    if (entry === 'index') {
      const index = indexSnapshot(id, service);
      if (index) return { kind: 'index', ...index };
    }
    if (entry === 'decision') {
      const decision = decisionSnapshot(id, service);
      if (decision) return { kind: 'decision', ...decision };
    }
  }

  return null;
}

function registerKnowledgeResources(server) {
  registerJsonResource(
    server,
    'knowledge-project-config',
    'knowledge://project/config',
    'Project knowledge config',
    'Resolved project workspace config, provider registry, and storage contract',
    async () => configSnapshot(),
  );
  registerJsonResource(
    server,
    'knowledge-project-storage',
    'knowledge://project/storage',
    'Project knowledge storage',
    'Artifact storage contract and validation for project knowledge',
    async () => storageSnapshot(),
  );
  registerJsonResource(
    server,
    'knowledge-project-machines',
    'knowledge://project/machines',
    'Project machine topology',
    'Optional machine topology for project knowledge sync planning',
    async () => await projectService().machineTopology({ includeTailscale: false }),
  );
  registerJsonResource(
    server,
    'knowledge-project-sync',
    'knowledge://project/sync',
    'Project sync status',
    'Machine registry, sync snapshot, change ledger, and conflict summary',
    async () => projectService().syncStatus(),
  );
  registerJsonResource(
    server,
    'knowledge-project-schema',
    'knowledge://project/schema',
    'Project knowledge schema',
    'SQLite schema version and table counts for project knowledge',
    async () => dbStatsSnapshot(),
  );
  registerJsonResource(
    server,
    'knowledge-project-sources',
    'knowledge://project/sources',
    'Project knowledge sources',
    'Indexed source refs and revision/chunk counts without raw source bytes',
    async () => ({ ok: true, scope: 'project', sources: sourceRows() }),
  );
  registerJsonResource(
    server,
    'knowledge-project-open-files',
    'knowledge://project/open-files',
    'Project open-files refs',
    'Open-files source refs known to the project knowledge catalog',
    async () => openFilesSnapshot(),
  );
  registerJsonResource(
    server,
    'knowledge-project-wiki-pages',
    'knowledge://project/wiki/pages',
    'Project wiki pages',
    'Generated wiki pages and citation artifact metadata',
    async () => ({ ok: true, scope: 'project', pages: wikiRows() }),
  );
  registerJsonResource(
    server,
    'knowledge-project-indexes',
    'knowledge://project/indexes',
    'Project knowledge indexes',
    'Sharded knowledge indexes and vector-index status',
    async () => ({
      ok: true,
      scope: 'project',
      indexes: indexRows(),
      embeddings: projectService().embeddingStatus(),
    }),
  );
  registerJsonResource(
    server,
    'knowledge-project-runs',
    'knowledge://project/runs',
    'Project knowledge runs',
    'Recent prompt, ingestion, web search, and reindex run ledger entries',
    async () => ({ ok: true, scope: 'project', runs: runRows() }),
  );
  registerJsonResource(
    server,
    'knowledge-project-decisions',
    'knowledge://project/decisions',
    'Project knowledge decisions',
    'Approval gates and audit decisions for generated knowledge operations',
    async () => decisionsSnapshot(),
  );

  registerJsonTemplate(
    server,
    'knowledge-project-items',
    'knowledge://project/items/{id}',
    'Project knowledge item',
    'Read a compatibility JSON-store item by id',
    async () => ({ resources: itemResources() }),
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = await getKnowledgeRecord('item', id, { scope: 'project' });
      return record ? { ok: true, ...record } : { ok: false, error: `Item not found: ${id}` };
    },
  );
  registerJsonTemplate(
    server,
    'knowledge-project-source',
    'knowledge://project/sources/{id}',
    'Project source',
    'Read indexed source metadata, revisions, and derived chunks',
    async () => ({
      resources: sourceRows().map((source) => ({
        uri: `knowledge://project/sources/${encodeURIComponent(source.id)}`,
        name: source.title ?? source.uri,
        description: `${source.kind} source with ${source.chunks} chunk(s)`,
        mimeType: 'application/json',
      })),
    }),
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = sourceSnapshot(id);
      return record ? { ok: true, kind: 'source', ...record } : { ok: false, error: `Source not found: ${id}` };
    },
  );
  registerJsonTemplate(
    server,
    'knowledge-project-wiki-page',
    'knowledge://project/wiki/pages/{id}',
    'Project wiki page',
    'Read generated wiki page metadata, citations, and artifact text',
    async () => ({
      resources: wikiRows().map((page) => ({
        uri: `knowledge://project/wiki/pages/${encodeURIComponent(page.id)}`,
        name: page.title,
        description: page.path,
        mimeType: 'application/json',
      })),
    }),
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = await wikiSnapshot(id);
      return record ? { ok: true, kind: 'wiki_page', ...record } : { ok: false, error: `Wiki page not found: ${id}` };
    },
  );
  registerJsonTemplate(
    server,
    'knowledge-project-index',
    'knowledge://project/indexes/{id}',
    'Project knowledge index',
    'Read a knowledge index row and vector-count snapshot',
    async () => ({
      resources: indexRows().map((index) => ({
        uri: `knowledge://project/indexes/${encodeURIComponent(index.id)}`,
        name: index.name,
        description: `${index.kind} index${index.shard_key ? ` shard ${index.shard_key}` : ''}`,
        mimeType: 'application/json',
      })),
    }),
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = indexSnapshot(id);
      return record ? { ok: true, kind: 'index', ...record } : { ok: false, error: `Index not found: ${id}` };
    },
  );
  registerJsonTemplate(
    server,
    'knowledge-project-run',
    'knowledge://project/runs/{id}',
    'Project run',
    'Read a knowledge run ledger entry with events and usage',
    async () => ({
      resources: runRows().map((run) => ({
        uri: `knowledge://project/runs/${encodeURIComponent(run.id)}`,
        name: `${run.type}: ${run.status}`,
        description: run.prompt ?? run.id,
        mimeType: 'application/json',
      })),
    }),
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = runSnapshot(id);
      return record ? { ok: true, kind: 'run', ...record } : { ok: false, error: `Run not found: ${id}` };
    },
  );
  registerJsonTemplate(
    server,
    'knowledge-project-decision',
    'knowledge://project/decisions/{id}',
    'Project decision',
    'Read an approval gate or audit decision',
    async () => {
      const decisions = decisionsSnapshot();
      return {
        resources: [
          ...decisions.approval_gates.map((entry) => ({
            uri: `knowledge://project/decisions/${encodeURIComponent(entry.id)}`,
            name: `${entry.action}: ${entry.status}`,
            description: entry.target_uri ?? entry.id,
            mimeType: 'application/json',
          })),
          ...decisions.audit_events.map((entry) => ({
            uri: `knowledge://project/decisions/${encodeURIComponent(entry.id)}`,
            name: `${entry.action}: ${entry.decision}`,
            description: entry.target_uri ?? entry.id,
            mimeType: 'application/json',
          })),
        ],
      };
    },
    async (_uri, variables) => {
      const id = decodeURIComponent(String(variables.id));
      const record = decisionSnapshot(id);
      return record ? { ok: true, ...record } : { ok: false, error: `Decision not found: ${id}` };
    },
  );
}

export function buildServer() {
  const server = new McpServer({
    name: 'knowledge',
    version: pkg.version,
  });

  registerKnowledgeResources(server);

  registerTool(server, 'ok_paths', 'Knowledge workspace paths', 'Show resolved workspace and store paths', {
    scope: scopeField,
  }, async ({ scope }) => {
    return jsonText(createKnowledgeService({ scope }).paths());
  });

  registerTool(server, 'ok_storage_status', 'Knowledge storage status', 'Inspect local/S3 artifact storage, source ownership, and scalability contract', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    const validation = service.validateStorage();
    return jsonText({
      ok: validation.ok,
      ...service.storageContract(),
      validation,
    });
  });

  registerTool(server, 'knowledge_machines_topology', 'Knowledge machine topology', 'Inspect optional open-machines topology and local fallback routes for knowledge sync', {
    scope: scopeField,
    include_tailscale: z.boolean().optional().describe('Include local Tailscale status probing when available'),
  }, async ({ scope, include_tailscale }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(await service.machineTopology({ includeTailscale: include_tailscale !== false }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_machines_preflight', 'Knowledge machine preflight', 'Check command, package, workspace, and optional open-machines readiness before knowledge sync', {
    scope: scopeField,
    machine_id: z.string().optional().describe('Machine id or SSH alias; defaults to local'),
    workspace: z.string().optional().describe('Repo workspace path to verify; defaults to server cwd'),
  }, async ({ scope, machine_id, workspace }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(await service.machinePreflight({
        machineId: machine_id ?? 'local',
        commands: [
          { command: 'bun', required: true },
          { command: 'knowledge', required: true },
        ],
        packages: [
          { name: pkg.name, command: 'knowledge', expectedVersion: pkg.version, required: true },
          { name: '@hasna/machines', command: 'machines', required: false },
        ],
        workspaces: [
          {
            label: 'open-knowledge',
            path: workspace ?? process.cwd(),
            expectedPackageName: pkg.name,
            expectedVersion: pkg.version,
            required: true,
          },
        ],
      }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_status', 'Knowledge sync status', 'Inspect machine registry rows, latest snapshot, changes, conflicts, and table counts', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(service.syncStatus());
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_doctor', 'Knowledge sync doctor', 'Read-only readiness report for machine sync, storage, open-files source refs, route/workspace resolution, and next commands', {
    scope: scopeField,
    machine: z.string().optional().describe('Optional remote machine id or SSH alias'),
    peer_workspace: z.string().optional().describe('Optional peer repo root or .hasna/apps/knowledge path'),
    tables: z.array(z.string()).optional().describe('Optional knowledge.db tables to include in recommended dry-run commands'),
    include_tailscale: z.boolean().optional().describe('Allow Tailscale route discovery when using a remote machine'),
  }, async ({ scope, machine, peer_workspace, tables, include_tailscale }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({
        package: { name: pkg.name, version: pkg.version },
        ...await service.syncDoctor({
          machine,
          peerWorkspace: peer_workspace,
          tables,
          includeTailscale: include_tailscale !== false,
        }),
      });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_snapshot', 'Record knowledge sync snapshot', 'Record a local sync snapshot and refresh machine registry rows from optional machine topology', {
    scope: scopeField,
    include_tailscale: z.boolean().optional().describe('Include local Tailscale status probing when available'),
    machine_id: z.string().optional().describe('Override machine id for the snapshot'),
  }, async ({ scope, include_tailscale, machine_id }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(await service.createSyncSnapshot({
        includeTailscale: include_tailscale !== false,
        machineId: machine_id,
      }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_conflicts', 'Knowledge sync conflicts', 'List sync conflicts awaiting review or already resolved', {
    scope: scopeField,
    status: z.string().optional().describe('Optional conflict status filter such as open or resolved'),
    limit: z.number().optional().describe('Maximum conflicts to return'),
  }, async ({ scope, status, limit }) => {
    const service = createKnowledgeService({ scope });
    try {
      const conflicts = service.syncConflicts({ status, limit });
      return jsonText({
        ok: true,
        conflicts,
        message: `${conflicts.length} sync conflict(s)`,
      });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_conflict_get', 'Knowledge sync conflict get', 'Show a single sync conflict with parsed metadata', {
    scope: scopeField,
    id: z.string().describe('Sync conflict id'),
  }, async ({ scope, id }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, conflict: service.syncConflict(id), message: `Sync conflict ${id}` });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_conflict_propose', 'Knowledge sync conflict proposal', 'Build an approval-gated deterministic or AI SDK merge proposal for a sync conflict', {
    scope: scopeField,
    id: z.string().describe('Sync conflict id'),
    mode: z.enum(['deterministic', 'ai']).optional().describe('Proposal mode; ai uses configured AI SDK provider and remains read-only'),
    model: z.string().optional().describe('Model alias/ref for AI mode'),
    fake: z.boolean().optional().describe('Use deterministic fake AI proposal output for local tests'),
  }, async ({ scope, id, mode, model, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(mode === 'ai'
        ? await service.proposeSyncConflictResolutionWithAi({ id, modelRef: model, fake })
        : service.proposeSyncConflictResolution(id));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_conflict_resolve', 'Knowledge sync conflict resolve', 'Resolve a sync conflict after explicit approval and record an audit event', {
    scope: scopeField,
    id: z.string().describe('Sync conflict id'),
    strategy: z.string().optional().describe('Resolution strategy, for example manual-merge or choose-local'),
    approve_write: z.boolean().optional().describe('Must be true to write the durable resolution'),
    approved_by: z.string().optional().describe('Approver label required with approve_write'),
    proposed_patch_uri: z.string().optional().describe('Optional proposed patch artifact URI'),
  }, async ({ scope, id, strategy, approve_write, approved_by, proposed_patch_uri }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText(service.resolveSyncConflict({
        id,
        strategy,
        approveWrite: approve_write,
        approvedBy: approved_by,
        proposedPatchUri: proposed_patch_uri,
      }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_sync_peer', 'Knowledge peer sync', 'Dry-run, pull, push, or bidirectionally sync with a local or remote peer knowledge workspace', {
    scope: scopeField,
    peer_workspace: z.string().optional().describe('Peer repo root or .hasna/apps/knowledge path; optional for remote machine sync when machines path mapping is configured'),
    machine: z.string().optional().describe('Optional remote machine id or SSH alias; when set, sync uses route-aware SSH transport'),
    direction: z.enum(['dry-run', 'pull', 'push', 'both']).optional().describe('Sync direction; dry-run previews both directions'),
    tables: z.array(z.string()).optional().describe('Optional knowledge.db tables to sync'),
    include_artifact_content: z.boolean().optional().describe('Embed/copy generated artifact content when available'),
    include_tailscale: z.boolean().optional().describe('Allow Tailscale route discovery when using a remote machine'),
    machine_id: z.string().optional().describe('Local machine id for change/conflict ledgers'),
  }, async ({ scope, peer_workspace, machine, direction, tables, include_artifact_content, include_tailscale, machine_id }) => {
    const service = createKnowledgeService({ scope });
    try {
      const syncDirection = direction === 'dry-run' ? 'both' : direction ?? 'both';
      const options = {
        peerWorkspace: peer_workspace,
        direction: syncDirection,
        dryRun: direction === 'dry-run',
        tables,
        includeArtifactContent: include_artifact_content !== false,
        machineId: machine_id ?? null,
      };
      return jsonText(machine
        ? await service.syncRemotePeer({
            ...options,
            machine,
            includeTailscale: include_tailscale !== false,
          })
        : await service.syncPeer(options));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'storage_status', 'Knowledge database storage status', 'Show knowledge.db storage sync configuration and local sync history', {
    scope: scopeField,
  }, async ({ scope }) => {
    try {
      return jsonText(getDatabaseStorageStatus({ scope }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'storage_push', 'Push knowledge database storage', 'Push local knowledge.db catalog rows to storage PostgreSQL', {
    scope: scopeField,
    tables: z.array(z.string()).optional().describe('Optional knowledge.db tables to push'),
  }, async ({ scope, tables }) => {
    try {
      return jsonText(await databaseStoragePush({ scope, tables }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'storage_pull', 'Pull knowledge database storage', 'Pull knowledge.db catalog rows from storage PostgreSQL to local SQLite', {
    scope: scopeField,
    tables: z.array(z.string()).optional().describe('Optional knowledge.db tables to pull'),
  }, async ({ scope, tables }) => {
    try {
      return jsonText(await databaseStoragePull({ scope, tables }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'storage_sync', 'Sync knowledge database storage', 'Bidirectional knowledge.db sync: pull then push', {
    scope: scopeField,
    tables: z.array(z.string()).optional().describe('Optional knowledge.db tables to sync'),
  }, async ({ scope, tables }) => {
    try {
      return jsonText(await databaseStorageSync({ scope, tables }));
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_parse_source_ref', 'Parse source reference', 'Parse and validate an open-files, S3, file, or web source ref', {
    uri: z.string().describe('Source reference URI'),
  }, async ({ uri }) => {
    try {
      return jsonText({ ok: true, source_ref: parseSourceRef(uri) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_resolve_source', 'Resolve source content', 'Resolve an indexed source ref through the read-only open-files boundary and return chunk citation evidence', {
    source_ref: z.string().describe('Source reference URI, preferably open-files://...'),
    purpose: z.string().optional().describe('Read-only purpose label, default knowledge_answer'),
    limit: z.number().optional().describe('Maximum chunks to return, default 10'),
    scope: scopeField,
  }, async ({ source_ref, purpose, limit, scope }) => {
    const service = createKnowledgeService({ scope });
    try {
      const result = await service.resolveSource(source_ref, {
        purpose,
        limit,
      });
      return jsonText({ ok: true, ...result });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_provider_status', 'AI provider status', 'Inspect configured AI SDK providers, model aliases, and BYOK credential availability', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    return jsonText({ ok: true, ...service.providerStatus() });
  });

  registerTool(server, 'ok_provider_models', 'AI provider models', 'List AI SDK model aliases and capability metadata', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    return jsonText({ ok: true, models: service.modelRegistry() });
  });

  registerTool(server, 'ok_embeddings_status', 'Embedding index status', 'Inspect local embedding/vector index counts by provider and model', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    return jsonText({ ok: true, ...service.embeddingStatus() });
  });

  registerTool(server, 'ok_embeddings_index', 'Index embeddings', 'Embed unindexed knowledge chunks into the local vector index', {
    scope: scopeField,
    limit: z.number().optional().describe('Maximum chunks to embed'),
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, limit, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.indexEmbeddings({ limit, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_reindex_status', 'Reindex status', 'Inspect missing embeddings, queued jobs, stale revisions, and vector index health', {
    scope: scopeField,
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...service.reindexHealth({ modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_reindex_enqueue', 'Enqueue reindex work', 'Queue missing embedding refresh jobs for indexed source chunks', {
    scope: scopeField,
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...service.enqueueReindex({ modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_reindex_embeddings', 'Refresh embedding index', 'Run incremental or full embedding refresh jobs with run-ledger tracking', {
    scope: scopeField,
    full: z.boolean().optional().describe('Delete and rebuild all embedding/vector rows first'),
    limit: z.number().optional().describe('Maximum chunks to embed'),
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, full, limit, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.refreshEmbeddings({ full, limit, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_semantic_search', 'Semantic search', 'Search the local vector index and return cited chunks with provenance', {
    scope: scopeField,
    query: z.string().describe('Semantic query'),
    limit: z.number().optional().describe('Maximum results'),
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, query, limit, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.semanticSearch({ query, limit, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_search', 'Hybrid knowledge search', 'Search source chunks, generated wiki pages, sharded indexes, and optional semantic vectors', {
    scope: scopeField,
    query: z.string().describe('Search query'),
    limit: z.number().optional().describe('Maximum results'),
    semantic: z.boolean().optional().describe('Include vector semantic results'),
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, query, limit, semantic, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.search({ query, limit, semantic, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_search', 'Knowledge context search', 'Return a reranked citation context pack for agent prompts', {
    scope: scopeField,
    query: z.string().describe('Search query or prompt'),
    limit: z.number().optional().describe('Maximum context results'),
    semantic: z.boolean().optional().describe('Include vector semantic results'),
    model: z.string().optional().describe('Embedding model ref, default openai:text-embedding-3-small'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings for local tests'),
  }, async ({ scope, query, limit, semantic, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.retrieveContext({ query, limit, semantic, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_ask', 'Knowledge prompt answer', 'Answer a prompt using read-only knowledge context and optional AI SDK generation', {
    scope: scopeField,
    prompt: z.string().describe('Prompt to answer with the knowledge base'),
    limit: z.number().optional().describe('Maximum context results'),
    semantic: z.boolean().optional().describe('Include vector semantic results'),
    generate: z.boolean().optional().describe('Call AI SDK text generation; omitted returns a local citation draft'),
    approve_write: z.boolean().optional().describe('Record approval intent for future durable wiki writes'),
    model: z.string().optional().describe('Model alias/ref, default configured provider default'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings/generation for local tests'),
  }, async ({ scope, prompt, limit, semantic, generate, approve_write, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.runPrompt({ prompt, limit, semantic, generate, approveWrite: approve_write, modelRef: model, dimensions, fake }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_get', 'Get knowledge record', 'Read a knowledge item, indexed source, wiki page, run, index, or decision by id without raw source-byte access', {
    scope: scopeField,
    kind: z.enum(['auto', 'item', 'source', 'wiki_page', 'run', 'index', 'decision']).optional().describe('Record kind; auto tries all supported kinds'),
    id: z.string().describe('Record id, short id, source URI, wiki path, index shard/name, or decision target URI'),
    include_content: z.boolean().optional().describe('Include generated wiki artifact text when reading wiki pages'),
    limit: z.number().optional().describe('Maximum related chunks/events to return'),
    store_path: storePathField,
  }, async ({ scope, kind, id, include_content, limit, store_path }) => {
    try {
      const record = await getKnowledgeRecord(kind ?? 'auto', id, {
        scope,
        include_content,
        limit,
        store_path,
      });
      return record ? jsonText({ ok: true, ...record }) : errorText(`Knowledge record not found: ${id}`);
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_ingest', 'Ingest knowledge source', 'Ingest an open-files/S3/file/web source ref or open-files manifest into the derived knowledge catalog', {
    scope: scopeField,
    source_ref: z.string().optional().describe('Source reference URI to ingest, e.g. open-files://file/<id>/revision/<rev>'),
    manifest: z.string().optional().describe('Manifest file path or s3:// URI to ingest'),
    purpose: z.string().optional().describe('Read-only purpose label, default knowledge_answer'),
  }, async ({ scope, source_ref, manifest, purpose }) => {
    if (!source_ref && !manifest) return errorText('Missing input. Provide source_ref or manifest.');
    if (source_ref && manifest) return errorText('Use either source_ref or manifest, not both.');
    const service = createKnowledgeService({ scope });
    try {
      const result = source_ref
        ? await service.ingestSource(source_ref, purpose)
        : await service.ingestManifest(manifest);
      return jsonText({ ok: true, mode: source_ref ? 'source' : 'manifest', ...result });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_build', 'Build knowledge answer', 'Run the knowledge prompt flow and optionally file the cited answer into generated wiki artifacts after approval', {
    scope: scopeField,
    prompt: z.string().describe('Prompt to answer and build durable knowledge from'),
    limit: z.number().optional().describe('Maximum context results'),
    semantic: z.boolean().optional().describe('Include vector semantic results'),
    generate: z.boolean().optional().describe('Call AI SDK text generation; omitted returns a local citation draft'),
    approve_write: z.boolean().optional().describe('Approve durable wiki filing for this call'),
    file_answer: z.boolean().optional().describe('Attempt wiki answer filing; writes only with approve_write=true'),
    model: z.string().optional().describe('Model alias/ref, default configured provider default'),
    dimensions: z.number().optional().describe('Embedding dimensions for deterministic fake mode'),
    fake: z.boolean().optional().describe('Use deterministic fake embeddings/generation for local tests'),
  }, async ({ scope, prompt, limit, semantic, generate, approve_write, file_answer, model, dimensions, fake }) => {
    const service = createKnowledgeService({ scope });
    try {
      const result = await service.runPrompt({ prompt, limit, semantic, generate, approveWrite: approve_write, modelRef: model, dimensions, fake });
      let wiki_file = null;
      if (file_answer === true || approve_write === true) {
        wiki_file = await service.fileAnswer({
          prompt,
          answer: result.answer,
          approveWrite: approve_write,
          limit,
          semantic,
          modelRef: model,
          dimensions,
          fake,
        });
      }
      return jsonText({ ok: true, ...result, wiki_file });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_web_search', 'Knowledge web search', 'Run safety-gated provider-native web search and optionally file snippets as web source refs', {
    scope: scopeField,
    query: z.string().describe('Web search query'),
    limit: z.number().optional().describe('Maximum sources'),
    provider: z.enum(['openai', 'anthropic', 'deepseek']).optional().describe('Provider override'),
    model: z.string().optional().describe('Model alias/ref'),
    domains: z.array(z.string()).optional().describe('Allowed domains'),
    fake: z.boolean().optional().describe('Use deterministic fake web results'),
    file_results: z.boolean().optional().describe('File web snippets as web source refs'),
  }, async ({ scope, query, limit, provider, model, domains, fake, file_results }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.webSearch({ query, limit, provider, modelRef: model, domains, fake, fileResults: file_results }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_lint', 'Lint knowledge wiki', 'Check generated wiki pages for missing citations, stale citations, duplicates, or source issues', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...service.lintWiki() });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_run_status', 'Knowledge run status', 'List recent runs or inspect one run ledger with events and provider usage', {
    scope: scopeField,
    run_id: z.string().optional().describe('Run id to inspect; omitted lists recent runs'),
    limit: z.number().optional().describe('Maximum runs or events to return'),
  }, async ({ scope, run_id, limit }) => {
    const service = createKnowledgeService({ scope });
    try {
      if (run_id) {
        const run = runSnapshot(run_id, { limit, service });
        return run ? jsonText({ ok: true, kind: 'run', ...run }) : errorText(`Run not found: ${run_id}`);
      }
      return jsonText({ ok: true, runs: runRows(limit, service) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_storage', 'Knowledge storage contract', 'Inspect local/S3 artifact storage, source ownership, and hosted/SaaS boundary metadata', {
    scope: scopeField,
  }, async ({ scope }) => {
    const service = createKnowledgeService({ scope });
    try {
      const validation = service.validateStorage();
      return jsonText({
        ok: validation.ok,
        ...service.storageContract(),
        validation,
        remote_contract: service.remoteContract(),
      });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'knowledge_resolve_source', 'Resolve knowledge source', 'Resolve indexed source chunks through the read-only open-files/source boundary with citation evidence', {
    source_ref: z.string().describe('Source reference URI, preferably open-files://...'),
    purpose: z.string().optional().describe('Read-only purpose label, default knowledge_answer'),
    limit: z.number().optional().describe('Maximum chunks to return, default 10'),
    scope: scopeField,
  }, async ({ source_ref, purpose, limit, scope }) => {
    const service = createKnowledgeService({ scope });
    try {
      const result = await service.resolveSource(source_ref, { purpose, limit });
      return jsonText({ ok: true, ...result });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_web_search', 'Provider web search', 'Run safety-gated provider-native web search and return citations/sources', {
    scope: scopeField,
    query: z.string().describe('Web search query'),
    limit: z.number().optional().describe('Maximum sources'),
    provider: z.enum(['openai', 'anthropic', 'deepseek']).optional().describe('Provider override'),
    model: z.string().optional().describe('Model alias/ref'),
    domains: z.array(z.string()).optional().describe('Allowed domains'),
    fake: z.boolean().optional().describe('Use deterministic fake web results'),
    file_results: z.boolean().optional().describe('File web snippets as web source refs'),
  }, async ({ scope, query, limit, provider, model, domains, fake, file_results }) => {
    const service = createKnowledgeService({ scope });
    try {
      return jsonText({ ok: true, ...await service.webSearch({ query, limit, provider, modelRef: model, domains, fake, fileResults: file_results }) });
    } catch (error) {
      return errorText(error instanceof Error ? error.message : String(error));
    }
  });

  registerTool(server, 'ok_add', 'Add a knowledge item', 'Add a new item to the knowledge store', {
    title: z.string().describe('Item title'),
    content: z.string().describe('Item content/body'),
    tags: z.array(z.string()).optional().describe('Tags to attach'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata key-value pairs'),
    url: z.string().optional().describe('Source URL or URI'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ title, content, tags, metadata, url, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const item = writeStoreLocked(storePath, (db) => {
      const now = new Date().toISOString();
      const id = makeId();
      const entry = {
        id,
        short_id: shortIdFor(id),
        title,
        content,
        url: url ?? null,
        tags: tags ?? [],
        metadata: metadata ?? {},
        archived: false,
        created_at: now,
        updated_at: now,
      };
      db.items.push(entry);
      return entry;
    });
    return jsonText({ ok: true, item, message: `Added ${item.id}` });
  });

  registerTool(server, 'ok_list', 'List knowledge items', 'List items with pagination, search, tag filtering, and sorting', {
    search: z.string().optional().describe('Search text for title/content'),
    tag: z.array(z.string()).optional().describe('Filter by tags; item must match all tags'),
    include_archived: z.boolean().optional().describe('Include archived items'),
    page: z.number().optional().describe('Page number'),
    limit: z.number().optional().describe('Items per page'),
    sort: z.enum(['created', 'title']).optional().describe('Sort field'),
    desc: z.boolean().optional().describe('Sort descending'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ search, tag, include_archived, page, limit, sort, desc, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    return readStoreLocked(storePath, (db) => {
      const q = search ? search.toLowerCase() : '';
      const requiredTags = (tag ?? []).map((entry) => entry.toLowerCase());
      let items = activeItems(db.items, include_archived);
      if (q) items = items.filter((item) => item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q));
      if (requiredTags.length > 0) {
        items = items.filter((item) => {
          const itemTags = (item.tags ?? []).map((entry) => entry.toLowerCase());
          return requiredTags.every((entry) => itemTags.includes(entry));
        });
      }
      const p = page && page > 0 ? page : 1;
      const l = limit && limit > 0 ? limit : 20;
      const sorted = sortItems(items, sort ?? 'created', desc ?? false);
      const start = (p - 1) * l;
      const rows = sorted.slice(start, start + l);
      return jsonText({
        ok: true,
        page: p,
        limit: l,
        total: sorted.length,
        total_pages: Math.max(1, Math.ceil(sorted.length / l)),
        items: rows,
      });
    });
  });

  registerTool(server, 'ok_get', 'Get a knowledge item', 'Retrieve a single item by ID or short ID', {
    id: z.string().describe('Item ID or short ID'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    return readStoreLocked(storePath, (db) => {
      const item = findItem(db, id);
      return item ? jsonText({ ok: true, item }) : errorText(`Item not found: ${id}`);
    });
  });

  registerTool(server, 'ok_update', 'Update a knowledge item', 'Update title, content, URL, tags, or metadata', {
    id: z.string().describe('Item ID or short ID'),
    title: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, title, content, url, tags, metadata, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const result = writeStoreLocked(storePath, (db) => {
      const item = findItem(db, id);
      if (!item) return null;
      if (title !== undefined) item.title = title;
      if (content !== undefined) item.content = content;
      if (url !== undefined) item.url = url;
      if (tags) item.tags = [...new Set([...(item.tags ?? []), ...tags])];
      if (metadata) item.metadata = { ...(item.metadata ?? {}), ...metadata };
      item.updated_at = new Date().toISOString();
      return item;
    });
    return result ? jsonText({ ok: true, item: result }) : errorText(`Item not found: ${id}`);
  });

  registerTool(server, 'ok_delete', 'Delete a knowledge item', 'Permanently delete an item by ID. Requires confirm=true.', {
    id: z.string().describe('Item ID or short ID'),
    confirm: z.boolean().describe('Must be true to confirm deletion'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, confirm, store_path, scope }) => {
    if (!confirm) return errorText('Refusing delete without confirm=true.');
    const storePath = resolveStorePath(store_path, scope);
    const deleted = writeStoreLocked(storePath, (db) => {
      const before = db.items.length;
      db.items = db.items.filter((item) => item.id !== id && item.short_id !== id);
      return before !== db.items.length;
    });
    return deleted ? jsonText({ ok: true, deleted_id: id }) : errorText(`Item not found: ${id}`);
  });

  registerTool(server, 'ok_archive', 'Archive a knowledge item', 'Soft-delete an item by setting archived=true', {
    id: z.string(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const item = writeStoreLocked(storePath, (db) => {
      const entry = findItem(db, id);
      if (!entry) return null;
      entry.archived = true;
      entry.updated_at = new Date().toISOString();
      return entry;
    });
    return item ? jsonText({ ok: true, item }) : errorText(`Item not found: ${id}`);
  });

  registerTool(server, 'ok_restore', 'Restore a knowledge item', 'Restore an archived item', {
    id: z.string(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const item = writeStoreLocked(storePath, (db) => {
      const entry = findItem(db, id);
      if (!entry) return null;
      entry.archived = false;
      entry.updated_at = new Date().toISOString();
      return entry;
    });
    return item ? jsonText({ ok: true, item }) : errorText(`Item not found: ${id}`);
  });

  registerTool(server, 'ok_upsert', 'Upsert a knowledge item', 'Create or update an item by ID', {
    id: z.string(),
    title: z.string().optional(),
    content: z.string().optional(),
    tags: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, title, content, tags, metadata, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const item = writeStoreLocked(storePath, (db) => {
      let entry = findItem(db, id);
      const now = new Date().toISOString();
      if (!entry) {
        if (!title || !content) return null;
        entry = {
          id,
          short_id: shortIdFor(id),
          title,
          content,
          tags: tags ?? [],
          metadata: metadata ?? {},
          archived: false,
          created_at: now,
          updated_at: now,
        };
        db.items.push(entry);
        return entry;
      }
      if (title !== undefined) entry.title = title;
      if (content !== undefined) entry.content = content;
      if (tags) entry.tags = [...new Set([...(entry.tags ?? []), ...tags])];
      if (metadata) entry.metadata = { ...(entry.metadata ?? {}), ...metadata };
      entry.updated_at = now;
      return entry;
    });
    return item ? jsonText({ ok: true, item }) : errorText('New item requires both title and content.');
  });

  registerTool(server, 'ok_untag', 'Remove tags from a knowledge item', 'Remove specific tags from an item', {
    id: z.string(),
    tags: z.array(z.string()),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ id, tags, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const result = writeStoreLocked(storePath, (db) => {
      const item = findItem(db, id);
      if (!item) return null;
      const remove = new Set(tags.map((tag) => tag.toLowerCase()));
      const before = (item.tags ?? []).length;
      item.tags = (item.tags ?? []).filter((tag) => !remove.has(tag.toLowerCase()));
      item.updated_at = new Date().toISOString();
      return { item, removed: before - item.tags.length };
    });
    return result ? jsonText({ ok: true, ...result }) : errorText(`Item not found: ${id}`);
  });

  registerTool(server, 'ok_bulk_delete', 'Bulk delete knowledge items', 'Delete multiple items by tag or search. Requires confirm=true.', {
    tag: z.array(z.string()).optional(),
    search: z.string().optional(),
    confirm: z.boolean(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ tag, search, confirm, store_path, scope }) => {
    if (!confirm) return errorText('Refusing bulk delete without confirm=true.');
    if (!tag && !search) return errorText('Missing filter. Use tag or search.');
    const storePath = resolveStorePath(store_path, scope);
    const deleted = writeStoreLocked(storePath, (db) => {
      const q = search ? search.toLowerCase() : '';
      const tags = (tag ?? []).map((entry) => entry.toLowerCase());
      const deleteIds = new Set(db.items.filter((item) => {
        const matchesSearch = q ? item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q) : false;
        const itemTags = (item.tags ?? []).map((entry) => entry.toLowerCase());
        const matchesTag = tags.length > 0 ? tags.some((entry) => itemTags.includes(entry)) : false;
        return matchesSearch || matchesTag;
      }).map((item) => item.id));
      db.items = db.items.filter((item) => !deleteIds.has(item.id));
      return deleteIds.size;
    });
    return jsonText({ ok: true, deleted });
  });

  registerTool(server, 'ok_prune', 'Prune knowledge items', 'Remove old and/or empty knowledge items. Requires confirm=true.', {
    older_than_days: z.number().optional().describe('Remove items older than N days'),
    empty: z.boolean().optional().describe('Remove items with empty content'),
    confirm: z.boolean(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ older_than_days, empty, confirm, store_path, scope }) => {
    if (!confirm) return errorText('Refusing prune without confirm=true.');
    const storePath = resolveStorePath(store_path, scope);
    const pruned = writeStoreLocked(storePath, (db) => {
      const before = db.items.length;
      let cutoff = null;
      if (older_than_days !== undefined) {
        cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - older_than_days);
      }
      db.items = db.items.filter((item) => {
        if (cutoff && new Date(item.created_at) < cutoff) return false;
        if (empty && item.content.trim().length === 0) return false;
        return true;
      });
      return before - db.items.length;
    });
    return jsonText({ ok: true, pruned });
  });

  registerTool(server, 'ok_dedupe', 'Dedupe knowledge items', 'Remove duplicate items by title and content. Requires confirm=true.', {
    confirm: z.boolean(),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ confirm, store_path, scope }) => {
    if (!confirm) return errorText('Refusing dedupe without confirm=true.');
    const storePath = resolveStorePath(store_path, scope);
    const removed = writeStoreLocked(storePath, (db) => {
      const seen = new Set();
      const before = db.items.length;
      db.items = db.items.filter((item) => {
        const key = `${item.title}\u0000${item.content}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return before - db.items.length;
    });
    return jsonText({ ok: true, removed });
  });

  registerTool(server, 'ok_stats', 'Knowledge store statistics', 'Get aggregate stats about the knowledge store', {
    store_path: storePathField,
    scope: scopeField,
  }, async ({ store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    return readStoreLocked(storePath, (db) => {
      const items = activeItems(db.items, false);
      const tagCounts = {};
      for (const item of items) {
        for (const tag of item.tags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
      return jsonText({
        ok: true,
        total: items.length,
        archived: db.items.length - items.length,
        tags: Object.fromEntries(Object.entries(tagCounts).sort((a, b) => b[1] - a[1])),
      });
    });
  });

  registerTool(server, 'ok_export', 'Export knowledge items', 'Export all items to a JSON file', {
    file: z.string().optional().describe('Output file path'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ file, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    return readStoreLocked(storePath, (db) => {
      const filePath = file || './knowledge-export.json';
      writeFileSync(filePath, JSON.stringify(db, null, 2));
      return jsonText({ ok: true, file: filePath, count: db.items.length });
    });
  });

  registerTool(server, 'ok_import', 'Import knowledge items', 'Import items from an exported JSON file, skipping duplicate IDs', {
    file: z.string().describe('Path to exported JSON file'),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ file, store_path, scope }) => {
    if (!existsSync(file)) return errorText(`File not found: ${file}`);
    const imported = JSON.parse(readFileSync(file, 'utf8'));
    if (!imported || !Array.isArray(imported.items)) return errorText('Invalid import file: expected {"items": [...]}');
    const storePath = resolveStorePath(store_path, scope);
    const result = writeStoreLocked(storePath, (db) => {
      const existingIds = new Set(db.items.map((item) => item.id));
      let added = 0;
      for (const item of imported.items) {
        if (!existingIds.has(item.id)) {
          db.items.push(item);
          existingIds.add(item.id);
          added += 1;
        }
      }
      return { added, skipped: imported.items.length - added };
    });
    return jsonText({ ok: true, ...result });
  });

  registerTool(server, 'ok_batch', 'Batch add knowledge items', 'Add multiple items at once', {
    items: z.array(z.object({
      id: z.string().optional(),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })),
    store_path: storePathField,
    scope: scopeField,
  }, async ({ items, store_path, scope }) => {
    const storePath = resolveStorePath(store_path, scope);
    const result = writeStoreLocked(storePath, (db) => {
      const existingIds = new Set(db.items.map((item) => item.id));
      let added = 0;
      let skipped = 0;
      const now = new Date().toISOString();
      for (const entry of items) {
        if (entry.id && existingIds.has(entry.id)) {
          skipped += 1;
          continue;
        }
        const id = entry.id ?? makeId();
        db.items.push({
          id,
          short_id: shortIdFor(id),
          title: entry.title,
          content: entry.content,
          tags: entry.tags ?? [],
          metadata: entry.metadata ?? {},
          archived: false,
          created_at: entry.created_at ?? now,
          updated_at: entry.updated_at ?? now,
        });
        existingIds.add(id);
        added += 1;
      }
      return { added, skipped };
    });
    return jsonText({ ok: true, ...result });
  });

  return server;
}

function printHelp() {
  console.error(`Usage: knowledge-mcp [options]

Runs the @hasna/knowledge MCP server (stdio by default).

Options:
  --http            Serve MCP over Streamable HTTP (127.0.0.1)
  --port <number>   HTTP port (default: 8819, env: MCP_HTTP_PORT)
  -h, --help        Show this help text`);
}

export async function main() {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const { isHttpMode, resolveMcpHttpPort, startMcpHttpServer } = await import('./mcp-http.js');

  if (isHttpMode()) {
    const handle = await startMcpHttpServer(buildServer, {
      port: resolveMcpHttpPort(),
    });
    process.on('SIGINT', () => void handle.close().finally(() => process.exit(0)));
    process.on('SIGTERM', () => void handle.close().finally(() => process.exit(0)));
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('knowledge MCP server running on stdio');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('MCP server error:', err);
    process.exit(1);
  });
}
