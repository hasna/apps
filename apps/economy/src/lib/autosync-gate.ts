// ── The autosync staleness gate ──────────────────────────────────────────────
//
// Every read-only CLI verb (today, machines, sessions, summary, ...) runs an
// auto-sync before answering in LOCAL mode, so the numbers it prints include
// provider data ingested moments ago. On a machine whose on-box provider corpus
// has grown large (e.g. ~/.claude/projects with tens of thousands of session
// jsonl files), that ingest pass takes minutes, so every read-only invocation
// appears to HANG before producing any output.
//
// The gate bounds that cost: auto-sync runs at most once per interval
// (default 10 minutes, `HASNA_ECONOMY_AUTOSYNC_INTERVAL` seconds, 0 = always
// sync, preserving the legacy behavior). Read-only verbs then answer from the
// store immediately. The full ingest remains available on demand via the
// explicit `economy sync` verb, which does not pass through this gate.
//
// In self_hosted/cloud (API) mode there is NO local store to flush: reads go
// straight to the shared API's GET routes, and the /v1/ingest push belongs to
// the explicit `economy sync` verb only. The CLI's autoSync is a no-op there
// (see cli/index.ts), so this gate is local-mode-only.
//
// The marker lives in the same per-machine ingest_state store the ingest
// modules already use: the local economy.db in local mode, and the
// machine-local ingest-cache db in hosted mode. Callers that already hold the
// store open pass it in; the helpers resolve it per mode when omitted.

import { openDatabase, getIngestState, setIngestState } from '../db/database.js'
import { getIngestCachePath } from './cloud-ingest.js'
import { isCloudStore } from './store/index.js'
import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'

export const AUTOSYNC_STATE_SOURCE = 'autosync'
export const AUTOSYNC_STATE_KEY = 'last_run'
export const DEFAULT_AUTOSYNC_INTERVAL_MS = 10 * 60_000

/** The auto-sync interval in ms: env seconds, 0 = always sync, default 10 min. */
export function autosyncIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['HASNA_ECONOMY_AUTOSYNC_INTERVAL']
  if (raw == null || raw.trim() === '') return DEFAULT_AUTOSYNC_INTERVAL_MS
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_AUTOSYNC_INTERVAL_MS
  return Math.round(seconds * 1000)
}

/** The store that holds the autosync marker: the ingest cache in hosted mode, the local db otherwise. */
export function autosyncMarkerStore(env: NodeJS.ProcessEnv = process.env): Database {
  if (isCloudStore(env)) return openDatabase(getIngestCachePath())
  return openDatabase()
}

/** Epoch ms of the last auto-sync, or 0 when the store has never auto-synced. */
export function autosyncLastRun(db?: Database, env: NodeJS.ProcessEnv = process.env): number {
  const store = db ?? autosyncMarkerStore(env)
  const value = getIngestState(store, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY)
  const ts = value == null ? NaN : Number(value)
  return Number.isFinite(ts) && ts > 0 ? ts : 0
}

/** Record that an auto-sync just completed. */
export function markAutoSync(db?: Database, env: NodeJS.ProcessEnv = process.env): void {
  const store = db ?? autosyncMarkerStore(env)
  setIngestState(store, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, String(Date.now()))
}

/** Whether the auto-sync should run now: always when the interval is 0, otherwise at most once per interval. */
export function autoSyncDue(db?: Database, env: NodeJS.ProcessEnv = process.env): boolean {
  const interval = autosyncIntervalMs(env)
  if (interval === 0) return true
  return Date.now() - autosyncLastRun(db, env) >= interval
}
