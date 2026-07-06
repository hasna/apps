/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Cloud (PURE REMOTE, Amendment A1) access layer for the knowledge catalog
 * items (the CLI add/list/get catalog). In local mode this catalog lives in the
 * JSON store (store.ts / db.json); in cloud mode it is durable in the
 * `knowledge_items` Postgres table and every call round-trips to the database
 * with no local mirror. All pg access is delegated to the vendored storage kit
 * via createKnowledgeCloudClient (TLS/pool/typed query surface).
 */
import { createKnowledgeCloudClient } from './remote-storage';
import type { KnowledgeItem } from '../store';

interface KnowledgeItemRow {
  id: string;
  short_id: string | null;
  title: string;
  content: string;
  url: string | null;
  tags: unknown;
  metadata: unknown;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function rowToItem(row: KnowledgeItemRow): KnowledgeItem {
  const metadata = toObject(row.metadata);
  return {
    id: row.id,
    short_id: row.short_id ?? undefined,
    title: row.title,
    content: row.content ?? '',
    url: row.url ?? null,
    tags: toArray(row.tags),
    metadata: Object.keys(metadata).length ? metadata : undefined,
    archived: Boolean(row.archived),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** List catalog items from the cloud DB (unpaged; caller applies filters/paging). */
export async function cloudListItems(options: { includeArchived?: boolean } = {}): Promise<KnowledgeItem[]> {
  const client = createKnowledgeCloudClient();
  try {
    const sql = options.includeArchived
      ? 'SELECT id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at FROM knowledge_items ORDER BY created_at DESC'
      : 'SELECT id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at FROM knowledge_items WHERE archived = FALSE ORDER BY created_at DESC';
    const result = await client.query(sql);
    return (result.rows as KnowledgeItemRow[]).map(rowToItem);
  } finally {
    await client.close();
  }
}

/** Fetch a single catalog item by id or short_id from the cloud DB, or null. */
export async function cloudGetItem(idOrShortId: string): Promise<KnowledgeItem | null> {
  const client = createKnowledgeCloudClient();
  try {
    const result = await client.query(
      'SELECT id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at FROM knowledge_items WHERE id = $1 OR short_id = $1 LIMIT 1',
      [idOrShortId],
    );
    const rows = result.rows as KnowledgeItemRow[];
    return rows.length ? rowToItem(rows[0]) : null;
  } finally {
    await client.close();
  }
}

/** Count catalog items in the cloud DB. */
export async function cloudCountItems(): Promise<number> {
  const client = createKnowledgeCloudClient();
  try {
    const result = await client.query('SELECT COUNT(*)::int AS n FROM knowledge_items');
    return Number((result.rows as Array<{ n: number }>)[0]?.n ?? 0);
  } finally {
    await client.close();
  }
}

/** Upsert a batch of catalog items into the cloud DB (id conflict → update). */
export async function cloudUpsertItems(items: KnowledgeItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const client = createKnowledgeCloudClient();
  let written = 0;
  try {
    for (const item of items) {
      const result = await client.query(
        `INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           short_id = EXCLUDED.short_id,
           title = EXCLUDED.title,
           content = EXCLUDED.content,
           url = EXCLUDED.url,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           archived = EXCLUDED.archived,
           updated_at = EXCLUDED.updated_at`,
        [
          item.id,
          item.short_id ?? null,
          item.title,
          item.content ?? '',
          item.url ?? null,
          JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
          JSON.stringify(item.metadata ?? {}),
          Boolean(item.archived),
          item.created_at,
          item.updated_at,
        ],
      );
      written += result.rowCount ?? 0;
    }
    return written;
  } finally {
    await client.close();
  }
}

/** Insert a single new catalog item into the cloud DB. */
export async function cloudAddItem(item: KnowledgeItem): Promise<KnowledgeItem> {
  await cloudUpsertItems([item]);
  return item;
}
