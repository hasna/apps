import type { SqliteAdapter as Database } from '../db/sqlite-adapter.js'
import { ingestClaude, ingestTakumi } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ingestGemini } from '../ingest/gemini.js'
import { ingestOpenCode } from '../ingest/opencode.js'
import { ingestCursor } from '../ingest/cursor.js'
import { ingestPi } from '../ingest/pi.js'
import { ingestHermes } from '../ingest/hermes.js'
import { ingestLoops } from '../ingest/loops.js'
import { ingestClaudeQuota } from '../ingest/claude-quota.js'
import { ingestCodexQuota } from '../ingest/codex-quota.js'
import { dedupeRequests } from '../db/database.js'
import type { SyncOptions } from '../types/index.js'

export interface SyncAllResult {
  claude?: Awaited<ReturnType<typeof ingestClaude>>
  takumi?: Awaited<ReturnType<typeof ingestTakumi>>
  codex?: Awaited<ReturnType<typeof ingestCodex>>
  gemini?: Awaited<ReturnType<typeof ingestGemini>>
  opencode?: Awaited<ReturnType<typeof ingestOpenCode>>
  cursor?: Awaited<ReturnType<typeof ingestCursor>>
  pi?: Awaited<ReturnType<typeof ingestPi>>
  hermes?: Awaited<ReturnType<typeof ingestHermes>>
  loops?: Awaited<ReturnType<typeof ingestLoops>>
  claudeQuota?: Awaited<ReturnType<typeof ingestClaudeQuota>>
  codexQuota?: Awaited<ReturnType<typeof ingestCodexQuota>>
  deduped: number
}

let loopsRefusalPrinted = false

/** Say — once per process, on stderr — that the cross-app loops read was refused. */
function announceLoopsRefusal(): void {
  if (loopsRefusalPrinted) return
  loopsRefusalPrinted = true
  process.stderr.write(
    'economy: loops ingest skipped — it reads the loops app\'s on-box SQLite ' +
      '(~/.hasna/loops/loops.db), which a hosted economy client never treats as fleet data. ' +
      'Set HASNA_ECONOMY_LOCAL=1 to run economy on the on-box store (where the read is allowed), ' +
      'or wait for the hosted loops read (PORT-TO-API).\n',
  )
}

/** Test seam: forget that the cross-app refusal line was printed. */
export function __resetLoopsRefusalNotice(): void {
  loopsRefusalPrinted = false
}

export async function syncAll(db: Database, opts: SyncOptions = {}): Promise<SyncAllResult> {
  const anySpecific = Boolean(
    opts.claude || opts.takumi || opts.codex || opts.gemini
    || opts.opencode || opts.cursor || opts.pi || opts.hermes || opts.loops,
  )
  const all = !anySpecific

  const result: SyncAllResult = { deduped: 0 }

  if (all || opts.claude) {
    result.claude = await ingestClaude(db, opts.verbose, opts.projectsDir)
    result.claudeQuota = await ingestClaudeQuota(db, opts.verbose)
  }
  if (all || opts.takumi) result.takumi = await ingestTakumi(db, opts.verbose, opts.projectsDir)
  if (all || opts.codex) {
    result.codex = await ingestCodex(db, opts.verbose)
    result.codexQuota = await ingestCodexQuota(db, opts.verbose)
  }
  if (all || opts.gemini) result.gemini = await ingestGemini(db, opts.verbose)
  if (all || opts.opencode) result.opencode = await ingestOpenCode(db, opts.verbose)
  if (all || opts.cursor) result.cursor = await ingestCursor(db, opts.verbose)
  if (all || opts.pi) result.pi = await ingestPi(db, opts.verbose)
  if (all || opts.hermes) result.hermes = await ingestHermes(db, opts.verbose)
  if (all || opts.loops) {
    // CROSS-APP GATE (fleet-alignment ruling d, 2026-09-11). The loops
    // collector reads the loops app's OWN on-box SQLite. A hosted client
    // refuses that read — another app's local file is never the fleet's truth
    // — and says so once, instead of quietly pushing on-box loops rows into
    // the shared dataset. The on-box lane (HASNA_ECONOMY_LOCAL=1) still reads
    // it. PORT-TO-API: read loops usage from the loops API instead (W13).
    if (opts.noCrossAppLocalReads) {
      announceLoopsRefusal()
      result.loops = { sessions: 0, requests: 0 }
    } else {
      result.loops = await ingestLoops(db, opts.verbose)
    }
  }

  if (opts.dedupe !== false) result.deduped = dedupeRequests(db)

  return result
}
