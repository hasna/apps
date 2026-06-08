#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import pkg from '../package.json' with { type: 'json' };
import { defaultStorePath, loadStore, saveStore, makeId, withLock } from './store.ts';
import { parseSourceRef } from './source-ref.ts';
import { createKnowledgeService } from './service.ts';

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

function registerTool(server, name, title, description, inputSchema, handler) {
  server.registerTool(name, { title, description, inputSchema }, handler);
}

export function buildServer() {
  const server = new McpServer({
    name: 'open-knowledge',
    version: pkg.version,
  });

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
  console.error(`Usage: open-knowledge-mcp [options]

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
  console.error('open-knowledge MCP server running on stdio');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('MCP server error:', err);
    process.exit(1);
  });
}
