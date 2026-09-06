// ── Cloud-client ingest: on-box provider data → the shared API ───────────────
//
// The local `economy sync` / `economy billing sync` flows read on-box provider
// telemetry and billing, then write into the local SQLite. In cloud-client mode
// there is no local DB that the cloud transport reads — so the port runs the
// SAME ingest readers against a scratch in-memory SQLite (reusing every ingest
// module verbatim), then pushes the produced rows to the shared API's
// /v1/ingest endpoint, which merges them by primary key via idempotent
// ON CONFLICT upserts (bulkIngest in db/database.ts).
//
// The only cross-run state is the per-file mtime cache (ingest_state), which
// lives in a small machine-local cache db so unchanged files are not re-read
// and re-posted on every sync. That cache is a cache — never a capability
// store — exactly like the local ingest_state table it replaces.
//
// SAFETY: no credential value ever touches this module. The provider admin keys
// stay in the environment (read by the ingest modules), and the shared API key
// stays inside the @hasna/contracts transport the storage seam resolved.

import { join } from 'path'
import { openDatabase, getDataDir } from '../db/database.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { ensurePricingSeeded } from './pricing.js'
import { syncAll } from './sync-all.js'
import type { SyncAllResult } from './sync-all.js'
import type { ActiveEconomyCloudStorage } from './cloud-storage.js'
import { syncAnthropicBilling, syncOpenAIBilling, syncGeminiBilling } from '../ingest/billing.js'
import { backfillMachineId, recalculateZeroCostRequests } from './sync-maintenance.js'
import type { SyncOptions } from '../types/index.js'

/** Tables this port pushes. Matches the tables the server's /v1/ingest accepts. */
const CLOUD_INGEST_TABLES = ['requests', 'sessions', 'billing_daily', 'usage_snapshots', 'subscriptions'] as const

/** Machine-local mtime cache path (override for tests via HASNA_ECONOMY_INGEST_CACHE). */
export function getIngestCachePath(): string {
  if (process.env['HASNA_ECONOMY_INGEST_CACHE']) return process.env['HASNA_ECONOMY_INGEST_CACHE']
  return join(getDataDir(), 'ingest-cache.db')
}

/** Replace the ingest_state rows in `to` with the rows in `from`. */
function copyIngestState(from: Database, to: Database): void {
  const rows = from.prepare(`SELECT source, key, value FROM ingest_state`).all() as Array<{ source: string; key: string; value: string }>
  to.prepare(`DELETE FROM ingest_state`).run()
  const insert = to.prepare(`INSERT INTO ingest_state (source, key, value) VALUES (?, ?, ?)`)
  for (const row of rows) insert.run(row.source, row.key, row.value)
}

/**
 * Export every row the scratch db currently holds for the ingest tables. The
 * scratch db is fresh per run and the mtime cache filters already-processed
 * files, so its contents ARE exactly this run's new/changed rows.
 */
function exportIngestRows(db: Database): Record<string, Array<Record<string, unknown>>> {
  const body: Record<string, Array<Record<string, unknown>>> = {}
  for (const table of CLOUD_INGEST_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
    if (rows.length > 0) body[table] = rows
  }
  return body
}

/** The serve envelope is `{ data, meta }`; older servers may answer bare. */
function unwrapEnvelope(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
    const data = (raw as { data: unknown }).data
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  }
  return (raw as Record<string, unknown>) ?? {}
}

async function postIngest(
  cloud: ActiveEconomyCloudStorage,
  body: Record<string, Array<Record<string, unknown>>>,
): Promise<{ ingested: Record<string, number>; total: number }> {
  const raw = await cloud.client.transport.post<unknown>('/ingest', body)
  const payload = unwrapEnvelope(raw)
  return {
    ingested: (payload['ingested'] as Record<string, number>) ?? {},
    total: Number(payload['total'] ?? 0),
  }
}

export interface CloudSyncOptions extends SyncOptions {
  /** Claude/Takumi JSONL root override (tests). */
  projectsDir?: string
  /** Ingest-state cache path override (tests). Defaults to getIngestCachePath(). */
  cachePath?: string
  /** Re-process every file (ignore the mtime cache). */
  force?: boolean
  /** Tag this run's rows with the current machine id. */
  backfillMachine?: boolean
  /** Recalculate zero-cost requests from pricing before pushing. */
  recalculate?: boolean
}

export interface CloudSyncResult extends SyncAllResult {
  /** True when at least one row was pushed to the shared API in this run. */
  posted: boolean
  /** Per-table row counts accepted by /v1/ingest (absent when nothing posted). */
  ingested?: Record<string, number>
  /** Total rows accepted by /v1/ingest (absent when nothing posted). */
  total?: number
}

/**
 * Cloud-client equivalent of `economy sync`: read this machine's on-box
 * provider files, ingest them through the existing readers, and push the
 * produced rows to the shared API. Returns the same per-source result shape as
 * the local syncAll, plus what the server accepted.
 */
export async function syncAllToCloud(cloud: ActiveEconomyCloudStorage, opts: CloudSyncOptions = {}): Promise<CloudSyncResult> {
  const scratch = openDatabase(':memory:', true)
  ensurePricingSeeded(scratch)
  const cache = openDatabase(opts.cachePath ?? getIngestCachePath(), true)
  try {
    if (opts.force) cache.prepare(`DELETE FROM ingest_state`).run()
    copyIngestState(cache, scratch)
    const result = await syncAll(scratch, opts)
    if (opts.backfillMachine) backfillMachineId(scratch)
    if (opts.recalculate) await recalculateZeroCostRequests(scratch)
    const body = exportIngestRows(scratch)
    if (Object.keys(body).length === 0) {
      // Nothing changed since the last run — persist the mtime cache only.
      copyIngestState(scratch, cache)
      return { ...result, posted: false }
    }
    const response = await postIngest(cloud, body)
    // Persist the mtime cache only after the push succeeded, so a failed push
    // is re-attempted on the next run.
    copyIngestState(scratch, cache)
    return { ...result, posted: true, ingested: response.ingested, total: response.total }
  } finally {
    try { scratch.close() } catch { /* best effort */ }
    try { cache.close() } catch { /* best effort */ }
  }
}

export interface CloudBillingSyncOptions {
  days?: number
  anthropic?: boolean
  openai?: boolean
  gemini?: boolean
}

export interface CloudBillingSyncResult {
  /** Per-provider outcome; a provider failure does not stop the others. */
  providers: Record<string, { ok: boolean; days?: number; totalUsd?: number; error?: string }>
  totalUsd: number
  posted: boolean
  ingested?: Record<string, number>
  total?: number
}

/**
 * Cloud-client equivalent of `economy billing sync`: fetch provider billing
 * from the provider APIs and push the billing_daily rows to the shared API.
 */
export async function billingSyncToCloud(cloud: ActiveEconomyCloudStorage, opts: CloudBillingSyncOptions = {}): Promise<CloudBillingSyncResult> {
  const scratch = openDatabase(':memory:', true)
  try {
    const days = opts.days ?? 31
    const providers: CloudBillingSyncResult['providers'] = {}
    const attempts: Array<[string, () => Promise<{ days: number; totalUsd: number }>]> = [
      ['anthropic', () => syncAnthropicBilling(scratch, { days })],
      ['openai', () => syncOpenAIBilling(scratch, { days })],
      ['gemini', () => syncGeminiBilling(scratch, { days })],
    ]
    const anySelected = opts.anthropic || opts.openai || opts.gemini
    let totalUsd = 0
    for (const [provider, run] of attempts) {
      if (anySelected && !opts[provider as keyof CloudBillingSyncOptions]) continue
      {
        try {
          const r = await run()
          providers[provider] = { ok: true, days: r.days, totalUsd: r.totalUsd }
          totalUsd += r.totalUsd
        } catch (e) {
          providers[provider] = { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
    }
    const body = exportIngestRows(scratch)
    if (Object.keys(body).length === 0) return { providers, totalUsd, posted: false }
    const response = await postIngest(cloud, body)
    return { providers, totalUsd, posted: true, ingested: response.ingested, total: response.total }
  } finally {
    try { scratch.close() } catch { /* best effort */ }
  }
}
