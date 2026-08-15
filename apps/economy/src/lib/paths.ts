import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Cross-platform home directory (Windows USERPROFILE, Unix HOME). */
export function getHomeDir(): string {
  return process.env['USERPROFILE'] ?? process.env['HOME'] ?? homedir()
}

export function expandHome(path: string): string {
  if (path.startsWith('~/')) return join(getHomeDir(), path.slice(2))
  return path
}

export function agentPaths() {
  const home = getHomeDir()
  return {
    claudeProjects: join(home, '.claude', 'projects'),
    claudeCredentials: join(home, '.claude', '.credentials.json'),
    takumiProjects: join(home, '.takumi', 'projects'),
    codexDir: join(home, '.codex'),
    codexDb: join(home, '.codex', 'state_5.sqlite'),
    codexAuth: join(home, '.codex', 'auth.json'),
    codexConfig: join(home, '.codex', 'config.toml'),
    geminiTmp: join(home, '.gemini', 'tmp'),
    geminiHistory: join(home, '.gemini', 'history'),
    opencodeMessages: join(home, '.local', 'share', 'opencode', 'storage', 'message'),
    piSessions: join(home, '.pi', 'agent', 'sessions'),
    hermesDir: join(home, '.hermes'),
    hermesDb: join(home, '.hermes', 'state.db'),
  }
}

export function existingAgentPaths(): string[] {
  return Object.values(agentPaths()).filter((p) => existsSync(p))
}
