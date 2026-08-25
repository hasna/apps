/**
 * Shared surface types for @hasna/workflows.
 *
 * Slice 1 (scaffold): identity, health, readiness, and config. Later slices
 * extend these with the graph language, store, session, and daemon types.
 */

/** Resolved service configuration. Values are resolved from the
 * HASNA_WORKFLOWS_ and WORKFLOWS_ environment prefixes with documented
 * defaults. */
export interface WorkflowsConfig {
  /** HTTP port for workflows-serve. Default 8790. */
  port: number;
  /** Bind host for workflows-serve. Default 127.0.0.1. */
  host: string;
  /** Data directory (store slice lands the db here). Default ~/.hasna/workflows. */
  dataDir: string;
  /** Optional client API URL (WORKFLOWS_API_URL) — consumed by later slices. */
  apiUrl?: string;
  /** Optional client API key (WORKFLOWS_API_KEY) — resolved, never printed. */
  apiKey?: string;
}

export interface HealthReport {
  ok: boolean;
  service: string;
  version: string;
  pid: number;
  uptimeMs: number;
}

export interface ReadinessReport {
  ok: boolean;
  service: string;
  version: string;
  checks: Record<string, string>;
}
