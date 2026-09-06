// Test-only helpers for spawning an economy bin in a HERMETIC fleet
// environment (hasna/apps#1720 controls). Not part of the public surface.
//
// A spawned bin resolves its credential from the LIVE process env, which
// makes every ambient tier reachable: the macOS Keychain (keyed on
// HASNA_STATION -> `hostname -s`) and the credentials file under HOME /
// HASNA_HOME. The env built here owns all of them: a HOME the test created,
// HASNA_HOME and HASNA_ECONOMY_HOME inside it, a station name no Keychain item
// exists for, and every inherited fleet authority blanked. Whatever a test then
// adds (a fixture key, the local opt-in) is the ONLY configuration the child
// sees.
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export function hermeticFleetEnv(tempRoot: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    HOME: tempRoot,
    HASNA_HOME: join(tempRoot, '.hasna'),
    HASNA_ECONOMY_HOME: join(tempRoot, 'economy-home'),
    HASNA_STATION: 'no-such-station',
    HASNA_ECONOMY_API_URL: '',
    HASNA_ECONOMY_API_KEY: '',
    ECONOMY_API_URL: '',
    ECONOMY_API_KEY: '',
    HASNA_ECONOMY_LOCAL: '',
    ECONOMY_LOCAL: '',
  }
  // Strip the ambient fleet env of every other HASNA_*/<APP>_API_* pair.
  for (const key of Object.keys(process.env)) {
    if (/^(?:HASNA_[A-Z0-9_]+_API_(?:URL|KEY)|[A-Z0-9]+_API_(?:URL|KEY))$/.test(key)) env[key] = ''
  }
  return { ...env, ...extra }
}

/** Every SQLite file — WAL/SHM/journal sidecars included — under a root. */
export function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full))
    else if (/\.(?:db|sqlite3?)(?:-wal|-shm|-journal)?$/.test(entry.name)) out.push(full)
  }
  return out
}
