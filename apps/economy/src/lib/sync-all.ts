import type { SqliteAdapter as Database } from '@hasna/cloud'
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
import { maybePullFromCloud, maybePushAfterIngest } from './cloud-sync.js'
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
  cloudPulled: boolean
  cloudPushed: boolean
}

export async function syncAll(db: Database, opts: SyncOptions = {}): Promise<SyncAllResult> {
  const anySpecific = Boolean(
    opts.claude || opts.takumi || opts.codex || opts.gemini
    || opts.opencode || opts.cursor || opts.pi || opts.hermes || opts.loops,
  )
  const all = !anySpecific

  await maybePullFromCloud()

  const result: SyncAllResult = { deduped: 0, cloudPulled: false, cloudPushed: false }

  if (all || opts.claude) {
    result.claude = await ingestClaude(db, opts.verbose)
    result.claudeQuota = await ingestClaudeQuota(db, opts.verbose)
  }
  if (all || opts.takumi) result.takumi = await ingestTakumi(db, opts.verbose)
  if (all || opts.codex) {
    result.codex = await ingestCodex(db, opts.verbose)
    result.codexQuota = await ingestCodexQuota(db, opts.verbose)
  }
  if (all || opts.gemini) result.gemini = await ingestGemini(db, opts.verbose)
  if (all || opts.opencode) result.opencode = await ingestOpenCode(db, opts.verbose)
  if (all || opts.cursor) result.cursor = await ingestCursor(db, opts.verbose)
  if (all || opts.pi) result.pi = await ingestPi(db, opts.verbose)
  if (all || opts.hermes) result.hermes = await ingestHermes(db, opts.verbose)
  if (all || opts.loops) result.loops = await ingestLoops(db, opts.verbose)

  result.deduped = dedupeRequests(db)
  result.cloudPushed = await maybePushAfterIngest()

  return result
}
