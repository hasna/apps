// ── Third-party SQLite readers ────────────────────────────────────────────────
//
// Three collectors read a SQLite file that belongs to ANOTHER tool on this
// machine — Codex (`~/.codex/state_5.sqlite`), Codewith, Hermes
// (`~/.hermes/state.db`) and OpenLoops (`~/.hasna/loops/loops.db`). Those reads
// are inputs to an ingest run, never economy's own dataset.
//
// They live behind this one module so the collectors can reach `bun:sqlite`
// through a DYNAMIC import taken at the moment of the read: with
// `build:cli` / `build:mcp` running `--splitting`, the specifier is emitted
// into `dist/chunks/` and neither `dist/cli` nor `dist/mcp` carries a
// `bun:sqlite` reference (fleet-alignment ruling d, 2026-09-11).
//
// The loops reader is additionally GATED: a hosted client refuses the cross-app
// read outright (see `src/lib/sync-all.ts`) because another Hasna app's on-box
// SQLite is never the fleet's source of truth.
import { Database } from 'bun:sqlite'

export type ThirdPartyDatabase = Database

/**
 * Open a third-party SQLite file. Read-only first (the owning tool may hold a
 * write lock); callers that need the writable retry pass `readonly: false`.
 */
export function openThirdPartySqlite(path: string, options: { readonly?: boolean } = {}): Database {
  return options.readonly === false ? new Database(path) : new Database(path, { readonly: true })
}
