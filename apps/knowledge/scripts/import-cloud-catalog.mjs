#!/usr/bin/env bun
/**
 * Import knowledge catalog items (JSONL, one KnowledgeItem per line) into the
 * cloud `knowledge_items` table via the vendored storage kit (PURE REMOTE).
 *
 * Requires:
 *   HASNA_KNOWLEDGE_STORAGE_MODE=cloud
 *   HASNA_KNOWLEDGE_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/import-cloud-catalog.mjs <path-to.jsonl> [--dry-run] [--json]
 *
 * Idempotent: rows are upserted by id (ON CONFLICT DO UPDATE).
 */
import { readFileSync } from 'node:fs';
import { cloudUpsertItems, cloudCountItems } from '../src/db/cloud-catalog.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: bun scripts/import-cloud-catalog.mjs <path-to.jsonl> [--dry-run] [--json]');
  process.exit(2);
}

const lines = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const items = lines.map((line) => {
  const o = JSON.parse(line);
  return {
    id: o.id,
    short_id: o.short_id ?? null,
    title: o.title ?? '',
    content: o.content ?? '',
    url: o.url ?? null,
    tags: Array.isArray(o.tags) ? o.tags : [],
    metadata: o.metadata ?? {},
    archived: Boolean(o.archived),
    created_at: o.created_at ?? new Date().toISOString(),
    updated_at: o.updated_at ?? o.created_at ?? new Date().toISOString(),
  };
});

const before = await cloudCountItems();
let written = 0;
if (!dryRun) written = await cloudUpsertItems(items);
const after = await cloudCountItems();

const summary = { ok: true, dryRun, file, parsed: items.length, rowsWritten: written, countBefore: before, countAfter: after };
if (asJson) console.log(JSON.stringify(summary, null, 2));
else console.log(`[knowledge] catalog import ${dryRun ? '(dry-run) ' : ''}parsed=${items.length} written=${written} count ${before} -> ${after}`);
