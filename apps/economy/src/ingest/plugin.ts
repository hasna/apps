import type { Database } from '../db/database.js'
import type { Agent } from '../lib/agents.js'

export interface IngestResult {
  requests: number
  sessions: number
  skipped?: number
}

export interface IngestPlugin {
  agent: Agent
  /** Human-readable source label for doctor/status. */
  source: string
  ingest(db: Database, verbose?: boolean): Promise<IngestResult>
}

const plugins = new Map<Agent, IngestPlugin>()

export function registerIngestPlugin(plugin: IngestPlugin): void {
  plugins.set(plugin.agent, plugin)
}

export function getIngestPlugin(agent: Agent): IngestPlugin | undefined {
  return plugins.get(agent)
}

export function listIngestPlugins(): IngestPlugin[] {
  return [...plugins.values()]
}
