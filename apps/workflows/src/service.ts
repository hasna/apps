/**
 * The single domain implementation for @hasna/workflows.
 *
 * Every interface surface (CLI, MCP, serve, SDK) calls this service; business
 * logic is never duplicated across interfaces. Slice 1 provides the app
 * shell: identity, configuration resolution, health, and readiness. Later
 * slices extend this class with the graph language, three-table store,
 * session WAL, daemon, and lane adapters.
 */
import { join } from "node:path";
import packageJson from "../package.json";
import { runGraphToCompletion } from "./daemon.js";
import { openStore } from "./store.js";
import { SessionWAL } from "./wal.js";
import { findRunByIdempotencyKey } from "./session.js";
import type { WorkflowGraph } from "./graph.js";
import type { HealthReport, ReadinessReport, WorkflowsConfig } from "./types.js";

const DEFAULT_PORT = 8790;
const DEFAULT_HOST = "127.0.0.1";

export function packageVersion(): string {
  return packageJson.version;
}

function envString(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function envInt(names: string[], fallback: number): number {
  const value = envString(names);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resolve the service configuration from env + explicit overrides. */
export function resolveWorkflowsConfig(overrides: Partial<WorkflowsConfig> = {}): WorkflowsConfig {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return {
    port: overrides.port ?? envInt(["HASNA_WORKFLOWS_PORT", "WORKFLOWS_PORT"], DEFAULT_PORT),
    host: overrides.host ?? envString(["HASNA_WORKFLOWS_HOST", "WORKFLOWS_HOST"]) ?? DEFAULT_HOST,
    dataDir:
      overrides.dataDir ??
      envString(["HASNA_WORKFLOWS_DATA_DIR", "WORKFLOWS_DATA_DIR"]) ??
      join(home, ".hasna", "workflows"),
    apiUrl: overrides.apiUrl ?? envString(["WORKFLOWS_API_URL"]),
    apiKey: overrides.apiKey ?? envString(["WORKFLOWS_API_KEY"]),
  };
}

export class WorkflowsService {
  readonly name = "workflows";
  readonly version: string;
  readonly config: WorkflowsConfig;
  private readonly startedAt: number = Date.now();

  constructor(config: Partial<WorkflowsConfig> = {}) {
    this.config = resolveWorkflowsConfig(config);
    this.version = packageVersion();
  }

  health(): HealthReport {
    return {
      ok: true,
      service: this.name,
      version: this.version,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
    };
  }

  ready(): ReadinessReport {
    return {
      ok: true,
      service: this.name,
      version: this.version,
      checks: { version: "ok" },
    };
  }

  /**
   * The authenticated trigger: run a graph to a terminal state (bounded
   * cycles) and return its summary. The HTTP layer authenticates; this
   * method holds the business logic. When an idempotency key is supplied and
   * a run carrying it already exists, that run's summary is returned instead
   * of starting a new one.
   */
  async triggerRun(
    graph: WorkflowGraph,
    context: unknown = {},
    opts: { maxCycles?: number; idempotencyKey?: string } = {},
  ): Promise<{ runId: string; status: string; error: string | null; result: unknown; reused: boolean }> {
    const store = openStore(this.config.dataDir);
    const wal = SessionWAL.open(this.config.dataDir);
    try {
      if (opts.idempotencyKey) {
        const existing = findRunByIdempotencyKey(store, opts.idempotencyKey);
        if (existing) {
          return {
            runId: existing.id,
            status: existing.status,
            error: existing.error ?? null,
            result: existing.resultJson ? JSON.parse(existing.resultJson) : null,
            reused: true,
          };
        }
      }
      const contextWithKey = opts.idempotencyKey
        ? {
            ...(context as Record<string, unknown>),
            __wf: {
              cursor: undefined,
              loops: {},
              completedLoops: {},
              ...(((context as Record<string, unknown>)?.__wf as Record<string, unknown>) ?? {}),
              idempotencyKey: opts.idempotencyKey,
            },
          }
        : context;
      const maxCycles = Math.min(Math.max(opts.maxCycles ?? 500, 1), 2000);
      const final = await runGraphToCompletion(store, wal, graph, contextWithKey, { maxCycles });
      return {
        runId: final.id,
        status: final.status,
        error: final.error ?? null,
        result: final.resultJson ? JSON.parse(final.resultJson) : null,
        reused: false,
      };
    } finally {
      store.close();
    }
  }
}

export function createWorkflowsService(config: Partial<WorkflowsConfig> = {}): WorkflowsService {
  return new WorkflowsService(config);
}
