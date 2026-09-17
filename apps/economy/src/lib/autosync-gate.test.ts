import { describe, it, expect } from 'bun:test'
import { openDatabase, getIngestState, setIngestState } from '../db/sqlite-store.js'
import {
  autoSyncDue,
  markAutoSync,
  autosyncIntervalMs,
  autosyncLastRun,
  AUTOSYNC_STATE_SOURCE,
  AUTOSYNC_STATE_KEY,
} from './autosync-gate.js'

// Hermetic marker store: an in-memory local DB, injected directly. The gate
// helpers accept an already-open db to avoid re-resolving the store.
function freshDb() {
  return openDatabase(':memory:', true)
}

describe('autosync gate', () => {
  it('is due when no marker exists yet', async () => {
    const db = freshDb()
    expect(await autoSyncDue(db)).toBe(true)
  })

  it('is not due when the marker is fresh, and becomes due after the interval', async () => {
    const db = freshDb()
    const now = Date.now()
    await markAutoSync(db)
    // Marker was just written: the next check must skip the ingest.
    expect(await autoSyncDue(db)).toBe(false)

    // Rewind the marker past the default 10-minute interval.
    setIngestState(db, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, String(now - 11 * 60_000))
    expect(await autoSyncDue(db)).toBe(true)
  })

  it('respects an env-configured interval and treats 0 as always-due', async () => {
    const db = freshDb()
    const now = Date.now()
    setIngestState(db, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY, String(now - 30_000))

    // 60s interval: a 30s-old marker is still fresh.
    expect(autosyncIntervalMs({ HASNA_ECONOMY_AUTOSYNC_INTERVAL: '60' })).toBe(60_000)
    expect(await autoSyncDue(db, { HASNA_ECONOMY_AUTOSYNC_INTERVAL: '60' })).toBe(false)
    // 10s interval: the same marker is now stale.
    expect(await autoSyncDue(db, { HASNA_ECONOMY_AUTOSYNC_INTERVAL: '10' })).toBe(true)

    // 0 always runs the ingest (never skips), and a bogus value falls back to the default.
    expect(autosyncIntervalMs({ HASNA_ECONOMY_AUTOSYNC_INTERVAL: '0' })).toBe(0)
    expect(await autoSyncDue(db, { HASNA_ECONOMY_AUTOSYNC_INTERVAL: '0' })).toBe(true)
    expect(autosyncIntervalMs({ HASNA_ECONOMY_AUTOSYNC_INTERVAL: 'nope' })).toBe(10 * 60_000)
    expect(autosyncIntervalMs({})).toBe(10 * 60_000)
  })

  it('reads back the exact marker it wrote', async () => {
    const db = freshDb()
    await markAutoSync(db)
    const stored = getIngestState(db, AUTOSYNC_STATE_SOURCE, AUTOSYNC_STATE_KEY)
    expect(stored).not.toBeNull()
    expect(Math.abs((await autosyncLastRun(db)) - Date.now())).toBeLessThan(5_000)
  })
})
