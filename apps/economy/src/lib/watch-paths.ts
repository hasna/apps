import { existsSync } from 'fs'
import { agentPaths } from './paths.js'

/** Directories and files to watch for live ingest triggers. */
export function getWatchPaths(): string[] {
  const p = agentPaths()
  const candidates = [
    p.claudeProjects,
    p.takumiProjects,
    p.codexDir,
    p.geminiTmp,
    p.geminiHistory,
    p.opencodeMessages,
    p.piSessions,
    p.hermesDir,
  ]
  return candidates.filter((path) => existsSync(path))
}
