#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { defaultStorePath, loadStore, saveStore, makeId } from './store.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function createStoreSchema() {
  return z.object({
    store_path: z.string().optional().describe('Path to the store file (default: ~/.open-knowledge/db.json)'),
  });
}

function createItemSchema() {
  return z.object({
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createAddSchema() {
  return z.object({
    title: z.string().describe('Item title'),
    content: z.string().describe('Item content/body'),
    tags: z.array(z.string()).optional().describe('Tags to attach'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata key-value pairs'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createIdSchema() {
  return z.object({
    id: z.string().describe('Item ID or short ID'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createListSchema() {
  return z.object({
    search: z.string().optional().describe('Search text for title/content'),
    fuzzy: z.boolean().optional().describe('Use fuzzy matching for search'),
    tag: z.array(z.string()).optional().describe('Filter by tags (must match all)'),
    archived: z.boolean().optional().describe('Show only archived items'),
    include_archived: z.boolean().optional().describe('Include archived items in results'),
    page: z.number().optional().describe('Page number (default: 1)'),
    limit: z.number().optional().describe('Items per page (default: 20)'),
    sort: z.enum(['created', 'title']).optional().describe('Sort field'),
    desc: z.boolean().optional().describe('Sort descending'),
    after: z.string().optional().describe('Filter items created after ISO date'),
    before: z.string().optional().describe('Filter items created before ISO date'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createUpdateSchema() {
  return z.object({
    id: z.string().describe('Item ID or short ID'),
    title: z.string().optional().describe('New title'),
    content: z.string().optional().describe('New content'),
    tags: z.array(z.string()).optional().describe('Tags to add'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata to merge'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createDeleteSchema() {
  return z.object({
    id: z.string().describe('Item ID or short ID'),
    confirm: z.boolean().describe('Must be true to confirm deletion'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createUpsertSchema() {
  return z.object({
    id: z.string().describe('Item ID (used as id for new items)'),
    title: z.string().optional().describe('Item title'),
    content: z.string().optional().describe('Item content'),
    tags: z.array(z.string()).optional().describe('Tags'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Metadata'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createBulkDeleteSchema() {
  return z.object({
    tag: z.array(z.string()).optional().describe('Delete items with these tags'),
    search: z.string().optional().describe('Delete items matching search in title/content'),
    confirm: z.boolean().describe('Must be true to confirm deletion'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createExportSchema() {
  return z.object({
    file: z.string().optional().describe('Output file path (default: ./knowledge-export.json)'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createImportSchema() {
  return z.object({
    file: z.string().describe('Path to exported JSON file'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createStatsSchema() {
  return z.object({
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createBatchSchema() {
  return z.object({
    items: z.array(z.object({
      id: z.string().optional(),
      title: z.string(),
      content: z.string(),
      tags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })).describe('Array of items to import'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

function createUntagSchema() {
  return z.object({
    id: z.string().describe('Item ID or short ID'),
    tags: z.array(z.string()).describe('Tags to remove'),
    store_path: z.string().optional().describe('Path to the store file'),
  });
}

export function buildServer() {
  const server = new McpServer({
    name: 'open-knowledge',
    version: '0.1.0',
  });

  // Helper to resolve store path
  function resolveStore(path) {
    return path || defaultStorePath();
  }

  server.registerTool('ok_add', {
    title: 'Add a knowledge item',
    description: 'Add a new item to the knowledge store with title, content, optional tags and metadata',
    inputSchema: createAddSchema(),
    handler: async ({ title, content, tags, metadata, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const now = new Date().toISOString();
      const { id, shortId } = makeId();
      const item = {
        id,
        short_id: shortId,
        title,
        content,
        tags: tags ?? [],
        metadata: metadata ?? {},
        created_at: now,
        updated_at: now,
      };
      db.items.push(item);
      saveStore(resolveStore(store_path), db);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, item, message: `Added ${item.id}` }, null, 2) }],
      };
    },
  });

  server.registerTool('ok_list', {
    title: 'List knowledge items',
    description: 'List items with pagination, search, tag filter, date filter, and sorting',
    inputSchema: createListSchema(),
    handler: async ({ search, fuzzy, tag, archived, include_archived, page, limit, sort, desc, after, before, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      let items = db.items;

      if (search) {
        const q = search.toLowerCase();
        if (fuzzy) {
          const levenshtein = (a, b) => {
            const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
            for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
            for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
            for (let i = 1; i <= a.length; i += 1) {
              for (let j = 1; j <= b.length; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
              }
            }
            return dp[a.length][b.length];
          };
          const scored = items.map((x) => {
            const titleScore = levenshtein(q, x.title.toLowerCase());
            const contentScore = Math.min(levenshtein(q, x.content.slice(0, 200).toLowerCase()), 20);
            return { ...x, _fuzzyScore: Math.min(titleScore, contentScore) };
          }).filter((x) => x._fuzzyScore <= 5);
          scored.sort((a, b) => a._fuzzyScore - b._fuzzyScore);
          items = scored;
        } else {
          items = items.filter((x) => x.title.toLowerCase().includes(q) || x.content.toLowerCase().includes(q));
        }
      }

      if (tag && tag.length > 0) {
        items = items.filter((x) => {
          const itemTags = (x.tags ?? []).map((t) => t.toLowerCase());
          return tag.every((t) => itemTags.includes(t.toLowerCase()));
        });
      }

      if (archived) {
        items = items.filter((x) => x.archived === true);
      } else if (!include_archived) {
        items = items.filter((x) => !x.archived);
      }

      if (after) {
        items = items.filter((x) => x.created_at > after);
      }
      if (before) {
        items = items.filter((x) => x.created_at < before);
      }

      const p = page ?? 1;
      const l = limit ?? 20;
      const start = (p - 1) * l;
      const totalPages = Math.max(1, Math.ceil(items.length / l));
      const rows = items.slice(start, start + l);

      return {
        content: [{ type: 'text', text: JSON.stringify({ page: p, limit: l, total: items.length, total_pages: totalPages, items: rows }, null, 2) }],
      };
    },
  });

  server.registerTool('ok_get', {
    title: 'Get a knowledge item',
    description: 'Retrieve a single item by its ID or short ID',
    inputSchema: createIdSchema(),
    handler: async ({ id, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const item = db.items.find((x) => x.id === id || x.short_id === id);
      if (!item) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ item }, null, 2) }] };
    },
  });

  server.registerTool('ok_update', {
    title: 'Update a knowledge item',
    description: 'Update title, content, tags, or metadata of an existing item',
    inputSchema: createUpdateSchema(),
    handler: async ({ id, title, content, tags, metadata, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const item = db.items.find((x) => x.id === id || x.short_id === id);
      if (!item) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      if (title) item.title = title;
      if (content) item.content = content;
      if (tags) {
        item.tags = [...new Set([...(item.tags ?? []), ...tags])];
      }
      if (metadata) {
        item.metadata = { ...(item.metadata ?? {}), ...metadata };
      }
      item.updated_at = new Date().toISOString();
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }, null, 2) }] };
    },
  });

  server.registerTool('ok_delete', {
    title: 'Delete a knowledge item',
    description: 'Permanently delete an item by ID. Requires confirm=true to prevent accidental deletion.',
    inputSchema: createDeleteSchema(),
    handler: async ({ id, confirm, store_path }) => {
      if (!confirm) {
        return { content: [{ type: 'text', text: 'Error: Refusing delete without confirm=true. Re-run with confirm: true.' }] };
      }
      const db = loadStore(resolveStore(store_path));
      const before = db.items.length;
      db.items = db.items.filter((x) => x.id !== id && x.short_id !== id);
      if (db.items.length === before) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted_id: id }, null, 2) }] };
    },
  });

  server.registerTool('ok_archive', {
    title: 'Archive a knowledge item',
    description: 'Soft-delete an item by setting its archived flag to true',
    inputSchema: createIdSchema(),
    handler: async ({ id, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const item = db.items.find((x) => x.id === id || x.short_id === id);
      if (!item) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      item.archived = true;
      item.updated_at = new Date().toISOString();
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }, null, 2) }] };
    },
  });

  server.registerTool('ok_restore', {
    title: 'Restore a knowledge item',
    description: 'Un-archive an item by setting its archived flag back to false',
    inputSchema: createIdSchema(),
    handler: async ({ id, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const item = db.items.find((x) => x.id === id || x.short_id === id);
      if (!item) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      item.archived = false;
      item.updated_at = new Date().toISOString();
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }, null, 2) }] };
    },
  });

  server.registerTool('ok_upsert', {
    title: 'Upsert a knowledge item',
    description: 'Create or update an item by ID. Creates new if ID does not exist, updates if it does.',
    inputSchema: createUpsertSchema(),
    handler: async ({ id, title, content, tags, metadata, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      let item = db.items.find((x) => x.id === id || x.short_id === id);
      const now = new Date().toISOString();
      if (!item) {
        if (!title || !content) {
          return { content: [{ type: 'text', text: 'Error: New item requires both title and content.' }] };
        }
        const { shortId } = makeId();
        item = {
          id,
          short_id: shortId,
          title,
          content,
          tags: tags ?? [],
          metadata: metadata ?? {},
          created_at: now,
          updated_at: now,
        };
        db.items.push(item);
      } else {
        if (title) item.title = title;
        if (content) item.content = content;
        if (tags) {
          item.tags = [...new Set([...(item.tags ?? []), ...tags])];
        }
        if (metadata) {
          item.metadata = { ...(item.metadata ?? {}), ...metadata };
        }
        item.updated_at = now;
      }
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item }, null, 2) }] };
    },
  });

  server.registerTool('ok_untag', {
    title: 'Remove tags from a knowledge item',
    description: 'Remove specific tags from an item',
    inputSchema: createUntagSchema(),
    handler: async ({ id, tags, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const item = db.items.find((x) => x.id === id || x.short_id === id);
      if (!item) {
        return { content: [{ type: 'text', text: `Error: Item not found: ${id}` }] };
      }
      const removeTags = new Set(tags.map((t) => t.toLowerCase()));
      const before = (item.tags ?? []).length;
      item.tags = (item.tags ?? []).filter((t) => !removeTags.has(t.toLowerCase()));
      const removed = before - item.tags.length;
      item.updated_at = new Date().toISOString();
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, item, removed }, null, 2) }] };
    },
  });

  server.registerTool('ok_bulk_delete', {
    title: 'Bulk delete knowledge items',
    description: 'Delete multiple items by tag or search pattern. Requires confirm=true.',
    inputSchema: createBulkDeleteSchema(),
    handler: async ({ tag, search, confirm, store_path }) => {
      if (!confirm) {
        return { content: [{ type: 'text', text: 'Error: Refusing bulk delete without confirm=true.' }] };
      }
      if (!tag && !search) {
        return { content: [{ type: 'text', text: 'Error: Missing filter. Use tag or search to specify items.' }] };
      }
      const db = loadStore(resolveStore(store_path));
      const before = db.items.length;
      let items = db.items;

      if (tag && tag.length > 0) {
        items = items.filter((x) => {
          const itemTags = (x.tags ?? []).map((t) => t.toLowerCase());
          return tag.some((t) => itemTags.includes(t.toLowerCase()));
        });
      }

      if (search) {
        const q = search.toLowerCase();
        items = items.filter((x) => x.title.toLowerCase().includes(q) || x.content.toLowerCase().includes(q));
      }

      const deleteIds = new Set(items.map((x) => x.id));
      db.items = db.items.filter((x) => !deleteIds.has(x.id));
      const deleted = before - db.items.length;
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted }, null, 2) }] };
    },
  });

  server.registerTool('ok_stats', {
    title: 'Knowledge store statistics',
    description: 'Get stats about the knowledge store: total items, tags, recent activity',
    inputSchema: createStatsSchema(),
    handler: async ({ store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const items = db.items.filter((x) => !x.archived);
      const total = items.length;
      const tagCounts = {};
      for (const item of items) {
        for (const t of (item.tags ?? [])) {
          tagCounts[t] = (tagCounts[t] ?? 0) + 1;
        }
      }
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      return {
        content: [{ type: 'text', text: JSON.stringify({
          total,
          created_today: items.filter((x) => x.created_at.slice(0, 10) === today).length,
          created_week: items.filter((x) => x.created_at > weekAgo).length,
          updated_week: items.filter((x) => x.updated_at && x.updated_at > weekAgo).length,
          tags: Object.fromEntries(Object.entries(tagCounts).sort((a, b) => b[1] - a[1])),
        }, null, 2) }],
      };
    },
  });

  server.registerTool('ok_export', {
    title: 'Export knowledge items',
    description: 'Export all items to a JSON file',
    inputSchema: createExportSchema(),
    handler: async ({ file, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const filePath = file || './knowledge-export.json';
      writeFileSync(filePath, JSON.stringify(db, null, 2));
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, file: filePath, count: db.items.length }, null, 2) }] };
    },
  });

  server.registerTool('ok_import', {
    title: 'Import knowledge items',
    description: 'Import items from an exported JSON file, skipping duplicates',
    inputSchema: createImportSchema(),
    handler: async ({ file, store_path }) => {
      if (!existsSync(file)) {
        return { content: [{ type: 'text', text: `Error: File not found: ${file}` }] };
      }
      const raw = readFileSync(file, 'utf8');
      const imported = JSON.parse(raw);
      if (!imported || !Array.isArray(imported.items)) {
        return { content: [{ type: 'text', text: 'Error: Invalid import file: expected {"items": [...]}' }] };
      }
      const db = loadStore(resolveStore(store_path));
      const existingIds = new Set(db.items.map((x) => x.id));
      let added = 0;
      for (const item of imported.items) {
        if (!existingIds.has(item.id)) {
          db.items.push(item);
          added += 1;
        }
      }
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, added, skipped: imported.items.length - added }, null, 2) }] };
    },
  });

  server.registerTool('ok_batch', {
    title: 'Batch add knowledge items',
    description: 'Add multiple items at once from an array of item objects',
    inputSchema: createBatchSchema(),
    handler: async ({ items, store_path }) => {
      const db = loadStore(resolveStore(store_path));
      const now = new Date().toISOString();
      const existingIds = new Set(db.items.map((x) => x.id));
      let added = 0;
      let skipped = 0;
      for (const entry of items) {
        if (entry.id && existingIds.has(entry.id)) {
          skipped += 1;
          continue;
        }
        if (!entry.title || !entry.content) {
          skipped += 1;
          continue;
        }
        const ids = entry.id ? { id: entry.id, short_id: entry.short_id || null } : makeId();
        const item = {
          id: ids.id,
          short_id: ids.short_id,
          title: entry.title,
          content: entry.content,
          tags: entry.tags ?? [],
          metadata: entry.metadata ?? {},
          created_at: entry.created_at || now,
          updated_at: entry.updated_at || now,
        };
        db.items.push(item);
        added += 1;
      }
      saveStore(resolveStore(store_path), db);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, added, skipped }, null, 2) }] };
    },
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

async function main() {
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
