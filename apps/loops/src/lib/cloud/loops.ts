// Cloud-backed loop data access.
//
// When the app is flipped to self_hosted (HASNA_LOOPS_API_URL + HASNA_LOOPS_API_KEY
// set), the CLI routes loop reads+writes through the hosted `/v1/loops` API instead
// of the local SQLite store. The hosted serve app returns app-native `Loop` JSON
// (same shape the local store persists), so no field remapping is needed.
//
// The cloud API keys entities by id only; name resolution (used by show/remove/
// pause/etc.) is done client-side by listing and matching, mirroring the local
// store's requireLoop()/findLoopByName() behaviour.

import type { CreateLoopInput, Loop, LoopStatus, RunStatus } from "../../types.js";
import { AmbiguousNameError, LoopNotFoundError } from "../errors.js";
import { resolveCloudStorage } from "./resolve.js";
import type { HasnaStorageClient } from "./storage.js";

const RESOURCE = "loops";

export interface ListLoopsOptions {
  status?: LoopStatus;
  limit?: number;
  offset?: number;
  archived?: boolean;
  includeArchived?: boolean;
  /** Exact-name filter: returns every loop with this name (archived included). */
  name?: string;
}

/** Loop CRUD backed by the hosted `/v1/loops` API. */
export class CloudLoopStore {
  constructor(
    private readonly client: HasnaStorageClient,
    readonly baseUrl: string,
  ) {}

  async createLoop(input: CreateLoopInput): Promise<Loop> {
    const raw = await this.client.create<{ loop?: Loop } | Loop>(RESOURCE, input);
    return unwrapLoop(raw);
  }

  async listLoops(opts: ListLoopsOptions = {}): Promise<Loop[]> {
    const query: Record<string, string | number | boolean> = {};
    if (opts.status) query.status = opts.status;
    if (opts.limit != null) query.limit = opts.limit;
    if (opts.offset != null) query.offset = opts.offset;
    if (opts.archived != null) query.archived = opts.archived;
    if (opts.includeArchived != null) query.includeArchived = opts.includeArchived;
    if (opts.name != null) query.name = opts.name;
    const result = await this.client.list<Loop>(RESOURCE, { query });
    // Loops serve app envelopes as { ok, loops: [...] }; the generic client's
    // item extractor doesn't know the `loops` key, so pull it explicitly.
    return extractLoops(result.raw, result.items);
  }

  async getLoop(id: string): Promise<Loop | undefined> {
    const raw = await this.client.get<{ loop?: Loop } | Loop>(RESOURCE, id);
    return raw == null ? undefined : unwrapLoop(raw);
  }

  /** Resolve a loop by id first, then by unique name (mirrors local requireLoop). */
  async resolveLoop(idOrName: string): Promise<Loop | undefined> {
    const byId = await this.getLoop(idOrName).catch(() => undefined);
    if (byId) return byId;
    // Server-side exact-name filter: one bounded query instead of listing the
    // entire loops table (which broke against the server's page cap).
    const matches = await this.listLoops({ name: idOrName, limit: 1000 });
    if (matches.length === 0) return undefined;
    if (matches.length === 1) return matches[0];
    const active = matches.filter((loop) => !loop.archivedAt);
    if (active.length === 1) return active[0];
    throw new AmbiguousNameError(idOrName);
  }

  async requireLoop(idOrName: string): Promise<Loop> {
    const loop = await this.resolveLoop(idOrName);
    if (!loop) throw new LoopNotFoundError(idOrName);
    return loop;
  }

  async updateLoop(idOrName: string, patch: Partial<Pick<Loop, "status" | "nextRunAt" | "expiresAt">>): Promise<Loop> {
    const loop = await this.requireLoop(idOrName);
    const raw = await this.client.update<{ loop?: Loop } | Loop>(RESOURCE, loop.id, patch);
    return unwrapLoop(raw);
  }

  async archiveLoop(idOrName: string): Promise<Loop> {
    const loop = await this.requireLoop(idOrName);
    const raw = await this.client.transport.post<{ loop?: Loop } | Loop>(`/${RESOURCE}/${encodeURIComponent(loop.id)}/archive`);
    return unwrapLoop(raw);
  }

  async unarchiveLoop(idOrName: string): Promise<Loop> {
    const loop = await this.requireLoop(idOrName);
    const raw = await this.client.transport.post<{ loop?: Loop } | Loop>(`/${RESOURCE}/${encodeURIComponent(loop.id)}/unarchive`);
    return unwrapLoop(raw);
  }

  async deleteLoop(idOrName: string): Promise<boolean> {
    const loop = await this.resolveLoop(idOrName);
    if (!loop) return false;
    await this.client.delete(RESOURCE, loop.id);
    return true;
  }

  /**
   * List run history from the hosted `/v1/runs` API. Rows come back already
   * shaped by the server's `publicRun` (output redacted unless `showOutput`),
   * so the CLI prints them verbatim — no local `publicRun` re-application.
   */
  async listRuns(
    opts: { loopId?: string; limit?: number; status?: RunStatus; showOutput?: boolean } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const query: Record<string, string | number | boolean> = {};
    if (opts.loopId) query.loopId = opts.loopId;
    if (opts.limit != null) query.limit = opts.limit;
    if (opts.status) query.status = opts.status;
    if (opts.showOutput != null) query.showOutput = opts.showOutput;
    const result = await this.client.list<Record<string, unknown>>("runs", { query });
    return extractRuns(result.raw, result.items);
  }
}

function unwrapLoop(raw: { loop?: Loop } | Loop): Loop {
  if (raw && typeof raw === "object" && "loop" in raw && (raw as { loop?: Loop }).loop) {
    return (raw as { loop: Loop }).loop;
  }
  return raw as Loop;
}

function extractRuns(raw: unknown, fallback: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (raw && typeof raw === "object" && Array.isArray((raw as { runs?: unknown }).runs)) {
    return (raw as { runs: Array<Record<string, unknown>> }).runs;
  }
  return fallback;
}

function extractLoops(raw: unknown, fallback: Loop[]): Loop[] {
  if (raw && typeof raw === "object" && Array.isArray((raw as { loops?: unknown }).loops)) {
    return (raw as { loops: Loop[] }).loops;
  }
  return fallback;
}

/**
 * Return a {@link CloudLoopStore} when the environment flips loops to self_hosted,
 * else `null` (the caller should use the local {@link Store}).
 */
export function resolveCloudLoopStore(env: NodeJS.ProcessEnv = process.env): CloudLoopStore | null {
  const resolution = resolveCloudStorage("loops", env as Record<string, string | undefined>);
  if (resolution.transport !== "cloud-http") return null;
  return new CloudLoopStore(resolution.client, resolution.baseUrl);
}
