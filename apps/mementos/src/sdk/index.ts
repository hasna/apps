/**
 * @hasna/mementos/sdk — Zero-dependency TypeScript client for @hasna/mementos REST API.
 *
 * Import: `import { MementosClient } from "@hasna/mementos/sdk"`
 *
 * Works in Node.js, Bun, Deno, and browsers. No external dependencies beyond fetch.
 */

// ============================================================================
// Types
// ============================================================================

export type MemoryScope = "global" | "shared" | "private" | "working";
export type MemoryCategory = "preference" | "fact" | "knowledge" | "history" | "procedural" | "resource";
export type MemorySource = "user" | "agent" | "system" | "auto" | "imported";
export type MemoryStatus = "active" | "archived" | "expired";
export type EntityType = "person" | "place" | "thing" | "concept" | "project" | "agent" | "file" | "url";
export type RelationType = "uses" | "knows" | "depends_on" | "created_by" | "related_to" | "contradicts" | "part_of" | "implements" | "happened_before" | "happened_after" | "caused_by" | "resulted_in" | "supersedes" | "version_of";
export type EntityRole = "subject" | "object" | "context" | "author" | "target";

// Task types
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";
export type TaskPriority = "critical" | "high" | "medium" | "low";

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  assigned_agent_id: string | null;
  project_id: string | null;
  session_id: string | null;
  parent_task_id: string | null;
  metadata: Record<string, unknown>;
  progress: number;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  body: string;
  created_at: string;
}

export interface CreateTaskInput {
  subject: string;
  description?: string;
  priority?: TaskPriority;
  tags?: string[];
  assigned_agent_id?: string;
  project_id?: string;
  session_id?: string;
  parent_task_id?: string;
  metadata?: Record<string, unknown>;
  due_at?: string;
}

export interface UpdateTaskInput {
  subject?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tags?: string[];
  assigned_agent_id?: string | null;
  metadata?: Record<string, unknown>;
  progress?: number;
  due_at?: string | null;
  error?: string | null;
}

export interface TaskStats {
  total: number;
  by_status: Record<TaskStatus, number>;
  by_priority: Record<TaskPriority, number>;
  overdue: number;
}

// Memory types
export interface Memory {
  id: string;
  key: string;
  value: string;
  category: MemoryCategory;
  scope: MemoryScope;
  summary: string | null;
  tags: string[];
  importance: number;
  source: MemorySource;
  status: MemoryStatus;
  pinned: boolean;
  agent_id: string | null;
  project_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  access_count: number;
  version: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
}

export interface MemoryVersion {
  id: string;
  memory_id: string;
  version: number;
  value: string;
  importance: number;
  scope: MemoryScope;
  category: MemoryCategory;
  tags: string[];
  summary: string | null;
  pinned: boolean;
  status: MemoryStatus;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  active_project_id?: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string | null;
  description: string | null;
  memory_prefix: string | null;
  created_at: string;
  updated_at: string;
}

export type MementosProjectResourceKind =
  | "project"
  | "knowledge"
  | "memory"
  | "session";

export interface MementosProjectResourceAuthority {
  authority: "mementos";
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  package_version: string;
}

export interface MementosProjectResource {
  authority: "mementos";
  source_package: "@hasna/mementos";
  project_id: string;
  resource_kind: MementosProjectResourceKind;
  stable_id: string;
  revision: string;
  digest: string;
  membership: "project_aggregate" | "explicit_project_id_or_focus";
}

export interface MementosProjectResourcePage {
  schema: "mementos.project-resources.v1";
  authority: MementosProjectResourceAuthority;
  project_id: string;
  project_revision: string;
  collection_revision: string;
  resource_kinds: MementosProjectResourceKind[];
  resources: MementosProjectResource[];
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  complete: true;
  truncated: false;
}

export interface MementosProjectResourceExactResult {
  schema: "mementos.project-resource.v1";
  authority: MementosProjectResourceAuthority;
  project_id: string;
  project_revision: string;
  collection_revision: string;
  resource: MementosProjectResource;
  complete: true;
  truncated: false;
}

export interface ListMementosProjectResourcesOptions {
  limit?: number;
  cursor?: string;
  resource_kinds?: MementosProjectResourceKind[];
}

export interface ListAllMementosProjectResourcesOptions {
  page_size?: number;
  resource_kinds?: MementosProjectResourceKind[];
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
  description?: string | null;
  memory_prefix?: string | null;
}

export interface ProjectAuthorityIdentity {
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
}

export interface ProjectGuardedUpdateRequest extends ProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_revision: string;
  updates: UpdateProjectInput;
}

export interface ProjectGuardedRollbackRequest extends ProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_revision: string;
  accepted_receipt_id: string;
}

export interface ProjectUpdateReceipt {
  receipt_id: string;
  authority: "mementos";
  route: "mementos.project-guarded-update.v1";
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  direction: "forward" | "rollback";
  idempotency_key: string;
  request_digest: string;
  outcome: "accepted";
  target_id: string;
  expected_revision: string;
  result_revision: string;
  result_digest: string;
  accepted_receipt_id: string | null;
  before_project: Project;
  after_project: Project;
  created_at: string;
}

export interface ProjectGuardedUpdateResult {
  dry_run: boolean;
  applied: boolean;
  project: Project;
  receipt: ProjectUpdateReceipt | null;
}

export interface MemoryProjectLinkSnapshot {
  memory_id: string;
  project_id: string | null;
  memory_version: number;
  memory_revision: string;
  memory_digest: string;
}

export interface MemoryProjectLinkRequest extends ProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_memory_version: number;
  expected_memory_revision: string;
  target_project_id: string;
  expected_project_revision: string;
}

export interface MemoryProjectLinkRollbackRequest extends ProjectAuthorityIdentity {
  operation_id: string;
  step_id: string;
  idempotency_key: string;
  expected_memory_version: number;
  expected_memory_revision: string;
  accepted_receipt_id: string;
}

export interface MemoryProjectLinkReceipt {
  receipt_id: string;
  authority: "mementos";
  route: "mementos.memory-project-link.v1";
  package_version: string;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  direction: "forward" | "rollback";
  idempotency_key: string;
  request_digest: string;
  outcome: "accepted" | "no_change";
  target_memory_id: string;
  requested_project_id: string;
  expected_memory_version: number;
  expected_memory_revision: string;
  expected_project_revision: string | null;
  result_memory_version: number;
  result_memory_revision: string;
  result_memory_digest: string;
  result_project_revision: string | null;
  result_project_digest: string | null;
  accepted_receipt_id: string | null;
  before_link: MemoryProjectLinkSnapshot;
  after_link: MemoryProjectLinkSnapshot;
  before_project_revision: string | null;
  before_project_digest: string | null;
  after_project_revision: string | null;
  after_project_digest: string | null;
  created_at: string;
}

export interface MemoryProjectLinkResult {
  dry_run: boolean;
  applied: boolean;
  no_change: boolean;
  memory: Memory;
  project: Project | null;
  receipt: MemoryProjectLinkReceipt | null;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description: string | null;
  metadata: Record<string, unknown>;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Relation {
  id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  weight: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type ResourceType = "project" | "memory" | "entity" | "agent" | "connector" | "file";
export type LockType = "advisory" | "exclusive";

export interface ResourceLock {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  agent_id: string;
  lock_type: LockType;
  locked_at: string;
  expires_at: string;
}

export interface AcquireLockInput {
  agent_id: string;
  resource_type: ResourceType;
  resource_id: string;
  lock_type?: LockType;
  ttl_seconds?: number;
}

export interface MemoryStats {
  total: number;
  by_scope: Record<MemoryScope, number>;
  by_category: Record<MemoryCategory, number>;
  by_status: Record<MemoryStatus, number>;
  by_agent: Record<string, number>;
  pinned_count: number;
  /** Rows with status = 'expired' — exactly what `--status expired` returns. */
  expired_count: number;
  /** Rows carrying any expires_at date (future or past). */
  expires_at_count: number;
  /** Retention backlog: status = 'expired' OR expires_at in the past. */
  expired_due_count: number;
}

// ============================================================================
// Input types
// ============================================================================

export interface CreateMemoryInput {
  key: string;
  value: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  summary?: string;
  tags?: string[];
  importance?: number;
  source?: MemorySource;
  agent_id?: string;
  project_id?: string;
  session_id?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  ttl?: string;
}

export interface UpdateMemoryInput {
  value?: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  summary?: string | null;
  tags?: string[];
  importance?: number;
  pinned?: boolean;
  status?: MemoryStatus;
  metadata?: Record<string, unknown>;
  expires_at?: string | null;
  version?: number;
}

export interface ListMemoriesFilter {
  scope?: MemoryScope;
  category?: MemoryCategory;
  tags?: string[];
  min_importance?: number;
  pinned?: boolean;
  agent_id?: string;
  project_id?: string;
  session_id?: string;
  namespace?: string;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
  fields?: string[];
}

export interface SearchMemoriesInput {
  query: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  tags?: string[];
  session_id?: string;
  namespace?: string;
  limit?: number;
}

export interface ExportMemoriesInput {
  scope?: MemoryScope;
  category?: MemoryCategory;
  agent_id?: string;
  project_id?: string;
  tags?: string[];
  limit?: number;
}

export interface ImportMemoriesInput {
  memories: Partial<Memory>[];
  overwrite?: boolean;
}

export interface CreateEntityInput {
  name: string;
  type: EntityType;
  description?: string;
  metadata?: Record<string, unknown>;
  project_id?: string;
}

export interface UpdateEntityInput {
  name?: string;
  type?: EntityType;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateRelationInput {
  source_entity_id: string;
  target_entity_id: string;
  relation_type: RelationType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_agent_id?: string;
  project_id?: string;
  session_id?: string;
  parent_task_id?: string | null;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// ============================================================================
// Client config
// ============================================================================

export interface MementosClientConfig {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  /**
   * API key issued by `contracts issue-key --app mementos`. Sent as both
   * `Authorization: Bearer <key>` and `x-api-key`. Required against a
   * self_hosted deployment with API-key auth enabled.
   */
  apiKey?: string;
  /**
   * Versioned route prefix. Defaults to the canonical `/v1`, or to whatever
   * versioned segment `baseUrl` already ends with (`/v1` or the legacy
   * `/api`), so a configured `https://api.hasna.com/mementos/v1` is not
   * prefixed twice. The deployed service also serves the legacy `/api`
   * prefix; set `prefix: "/api"` to target it explicitly.
   */
  prefix?: string;
}

// ============================================================================
// Error
// ============================================================================

export class MementosError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "MementosError";
  }
}

// ============================================================================
// Auto-memory & synthesis types
// ============================================================================

export interface AutoMemoryQueueStats {
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  dropped: number;
}

export interface AutoMemoryConfig {
  provider: "anthropic" | "openai" | "cerebras" | "grok";
  model?: string;
  enabled: boolean;
  minImportance: number;
  autoEntityLink: boolean;
  fallback?: Array<"anthropic" | "openai" | "cerebras" | "grok">;
}

export interface SdkExtractedMemory {
  content: string;
  category: "preference" | "fact" | "knowledge" | "history";
  importance: number;
  tags: string[];
  suggestedScope: "private" | "shared" | "global";
  reasoning?: string;
}

export interface SdkHook {
  id: string;
  type: string;
  blocking: boolean;
  priority: number;
  builtin: boolean;
  agentId?: string;
  projectId?: string;
  description?: string;
}

export interface SdkWebhook {
  id: string;
  type: string;
  handlerUrl: string;
  priority: number;
  blocking: boolean;
  agentId?: string;
  projectId?: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  invocationCount: number;
  failureCount: number;
}

export interface SynthesisRun {
  id: string;
  triggered_by: string;
  project_id: string | null;
  agent_id: string | null;
  corpus_size: number;
  proposals_generated: number;
  proposals_accepted: number;
  proposals_rejected: number;
  status: "pending" | "running" | "completed" | "failed" | "rolled_back";
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SynthesisResult {
  run: SynthesisRun;
  proposals: unknown[];
  executed: number;
  metrics: { corpusReduction: number; deduplicationRate: number } | null;
  dryRun: boolean;
}

export interface SessionMemoryJob {
  id: string;
  session_id: string;
  agent_id: string | null;
  project_id: string | null;
  source: string;
  status: "pending" | "processing" | "completed" | "failed";
  transcript: string;
  chunk_count: number;
  memories_extracted: number;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================================
// Client
// ============================================================================

/** Default endpoint for a single-operator on-box server. */
export const MEMENTOS_DEFAULT_BASE_URL = "http://localhost:19428";

/**
 * Env keys that configure this client, canonical first. The canonical
 * `HASNA_MEMENTOS_*` pair is the fleet env contract; the short names are kept
 * as fallbacks for callers configured before the rename.
 */
export const MEMENTOS_API_URL_ENV_KEYS = ["HASNA_MEMENTOS_API_URL", "MEMENTOS_API_URL", "MEMENTOS_URL"] as const;
export const MEMENTOS_API_KEY_ENV_KEYS = ["HASNA_MEMENTOS_API_KEY", "MEMENTOS_API_KEY"] as const;

/**
 * Split a configured base URL into the authority-plus-path root and the
 * versioned route prefix.
 *
 * The gateway addresses this app as `https://api.hasna.com/mementos/v1/...`
 * (hasna/apps#1512), so an operator may configure any of
 * `https://host`, `https://host/v1`, `https://api.hasna.com/mementos`, or
 * `https://api.hasna.com/mementos/v1`. The path prefix must survive (using
 * `URL.origin` here is the hasna/apps#1601 defect: it silently drops
 * `/mementos` and the client can never reach the gateway), and a base that
 * already carries `/v1` (or the legacy `/api`) must not be prefixed a second
 * time into `/mementos/v1/v1/memories`.
 *
 * TODO(hasna/apps#1601): replace this with the shared base-URL join helper
 * from `@hasna/contracts` once that release lands and this package's pin is
 * bumped; the semantics here are intentionally identical to it.
 */
export function resolveMementosApiBase(
  rawBaseUrl: string | undefined,
  explicitPrefix?: string,
): { baseUrl: string; prefix: string } {
  const trimmed = (rawBaseUrl ?? MEMENTOS_DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || MEMENTOS_DEFAULT_BASE_URL;
  const prefixMatch = /^(.*)(\/(?:v1|api))$/.exec(trimmed);
  if (explicitPrefix !== undefined) {
    const prefix = explicitPrefix.replace(/\/+$/, "");
    // An explicit prefix wins, so a base that already carries the same
    // versioned segment is folded back into the root rather than doubled.
    const baseUrl = prefixMatch && prefixMatch[2] === prefix ? (prefixMatch[1] || trimmed) : trimmed;
    return { baseUrl, prefix };
  }
  if (prefixMatch) return { baseUrl: prefixMatch[1] || trimmed, prefix: prefixMatch[2]! };
  return { baseUrl: trimmed, prefix: "/v1" };
}

export class MementosClient {
  private baseUrl: string;
  private _fetch: typeof globalThis.fetch;
  private apiKey?: string;
  private prefix: string;

  constructor(config: MementosClientConfig = {}) {
    const resolved = resolveMementosApiBase(config.baseUrl, config.prefix);
    this.baseUrl = resolved.baseUrl;
    this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiKey = config.apiKey;
    this.prefix = resolved.prefix;
  }

  static fromEnv(overrides: Partial<MementosClientConfig> = {}): MementosClient {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const pick = (keys: readonly string[]): string | undefined => {
      for (const key of keys) {
        const value = env?.[key]?.trim();
        if (value) return value;
      }
      return undefined;
    };
    const baseUrl = pick(MEMENTOS_API_URL_ENV_KEYS) ?? MEMENTOS_DEFAULT_BASE_URL;
    const apiKey = pick(MEMENTOS_API_KEY_ENV_KEYS);
    return new MementosClient({ baseUrl, apiKey, ...overrides });
  }

  /**
   * The resolved `/v1` root this client sends to, e.g.
   * `https://api.hasna.com/mementos/v1`. Printed by operator-facing surfaces
   * as the single `API:` line (hasna/apps#1588) — never a bare origin.
   */
  get apiUrl(): string {
    return `${this.baseUrl}${this.prefix}`;
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    // Route legacy `/api/...` method paths through the configured version prefix.
    const routed = path.startsWith("/api/") ? `${this.prefix}${path.slice(4)}` : path;
    let url = `${this.baseUrl}${routed}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      headers["x-api-key"] = this.apiKey;
    }

    const res = await this._fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let errBody: { error?: string; details?: unknown } = {};
      try { errBody = await res.json() as typeof errBody; } catch { /* ignore */ }
      throw new MementosError(errBody.error ?? `HTTP ${res.status}`, res.status, errBody.details);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private get<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  // --------------------------------------------------------------------------
  // Memories
  // --------------------------------------------------------------------------

  async listMemories(filter: ListMemoriesFilter = {}): Promise<{
    memories: Memory[];
    count: number;
    total?: number;
    has_more?: boolean;
    next_cursor?: number | null;
  }> {
    // The server caps every single response at 1000 rows (bounded pages), so a
    // requested limit above that — or no limit at all — must be assembled by
    // walking pages. A single request would silently return only one page.
    const pageSize = 1000;
    const maxPages = 1000;
    const target = filter.limit;
    const want = target === undefined ? undefined : target + 1;
    const memories: Memory[] = [];
    const seenCursors = new Set<number>();
    let cursor = filter.offset ?? 0;
    let total: number | undefined;
    let pages = 0;
    for (;;) {
      if (want !== undefined && memories.length >= want) break;
      if (++pages > maxPages) {
        throw new MementosError(
          `memories list traversal exceeded its bounded ${maxPages}-page population`,
          502,
        );
      }
      const limit = Math.min(
        want === undefined ? pageSize : want - memories.length,
        pageSize,
      );
      const q: Record<string, string | number | boolean | undefined> = {};
      if (filter.scope) q["scope"] = filter.scope;
      if (filter.category) q["category"] = filter.category;
      if (filter.tags?.length) q["tags"] = filter.tags.join(",");
      if (filter.min_importance !== undefined) q["min_importance"] = filter.min_importance;
      if (filter.pinned !== undefined) q["pinned"] = filter.pinned;
      if (filter.agent_id) q["agent_id"] = filter.agent_id;
      if (filter.project_id) q["project_id"] = filter.project_id;
      if (filter.session_id) q["session_id"] = filter.session_id;
      if (filter.namespace) q["namespace"] = filter.namespace;
      if (filter.status) q["status"] = filter.status;
      if (filter.fields?.length) q["fields"] = filter.fields.join(",");
      q["limit"] = limit;
      q["offset"] = cursor;
      const page = await this.get<{
        memories?: Memory[];
        total?: number;
        has_more?: boolean;
        next_cursor?: number | null;
      }>("/api/memories", q);
      const rows = page.memories ?? [];
      if (total === undefined) total = page.total ?? rows.length;
      memories.push(...rows);
      const ended =
        page.has_more === false ||
        (page.has_more === undefined && rows.length < limit);
      if (ended) break;
      if (page.has_more === true && page.next_cursor == null) {
        throw new MementosError(
          "memories list page claimed more results without a cursor",
          502,
        );
      }
      const next = page.next_cursor ?? cursor + rows.length;
      if (seenCursors.has(next)) {
        throw new MementosError(
          "memories list traversal repeated a continuation cursor",
          502,
        );
      }
      seenCursors.add(next);
      cursor = next;
    }
    const hasMore = target !== undefined && memories.length > target;
    const trimmed = hasMore ? memories.slice(0, target) : memories;
    return {
      memories: trimmed,
      count: trimmed.length,
      total,
      has_more: hasMore,
      next_cursor: hasMore ? (filter.offset ?? 0) + trimmed.length : null,
    };
  }

  getStats(): Promise<MemoryStats> {
    return this.get("/api/memories/stats");
  }

  getHealth(): Promise<{
    status: "ok" | "warn";
    version: string;
    mode: "local" | "cloud";
    profile: string;
    db_path: string;
    hostname: string;
    memories: {
      total: number;
      /** Rows with status = 'expired' — exactly what `--status expired` returns. */
      expired: number;
      /** Retention backlog: status = 'expired' OR expires_at in the past (drives the warn gate). */
      expired_due: number;
      pinned: number;
    };
    agents: number;
    projects: number;
  }> {
    return this.get("/health");
  }

  /** Liveness/readiness probe — verifies backing-store connectivity. */
  getReady(): Promise<{ status: "ready" | "not_ready"; version: string; mode: "local" | "cloud" }> {
    return this.get("/ready");
  }

  /** Service version + storage mode. */
  getVersion(): Promise<{ status: "ok"; version: string; mode: "local" | "cloud" }> {
    return this.get("/version");
  }

  getReport(options?: { days?: number; project_id?: string; agent_id?: string }): Promise<{
    total: number;
    pinned: number;
    days: number;
    recent: { total: number; activity: { date: string; memories_created: number }[] };
    by_scope: Record<string, number>;
    by_category: Record<string, number>;
    top_memories: { id: string; key: string; value: string; importance: number; scope: string; category: string }[];
    top_agents: { agent_id: string; c: number }[];
  }> {
    return this.get("/api/report", options as Record<string, string | number | boolean | undefined>);
  }

  async getStaleMemories(options?: { days?: number; pinned?: boolean; project_id?: string; agent_id?: string; limit?: number; offset?: number }): Promise<{
    memories: Memory[];
    count: number;
    days: number;
    total?: number;
    has_more?: boolean;
    next_cursor?: number | null;
  }> {
    // Same bounded-page walk as listMemories: the server caps single stale
    // responses at 1000 rows and answers with total / has_more / next_cursor.
    const pageSize = 1000;
    const maxPages = 1000;
    const target = options?.limit;
    const want = target === undefined ? undefined : target + 1;
    const memories: Memory[] = [];
    const seenCursors = new Set<number>();
    let cursor = options?.offset ?? 0;
    let total: number | undefined;
    let days = options?.days ?? 30;
    let pages = 0;
    for (;;) {
      if (want !== undefined && memories.length >= want) break;
      if (++pages > maxPages) {
        throw new MementosError(
          `memories stale traversal exceeded its bounded ${maxPages}-page population`,
          502,
        );
      }
      const limit = Math.min(
        want === undefined ? pageSize : want - memories.length,
        pageSize,
      );
      const page = await this.get<{
        memories?: Memory[];
        total?: number;
        has_more?: boolean;
        next_cursor?: number | null;
        days?: number;
      }>("/api/memories/stale", {
        days: options?.days,
        pinned: options?.pinned,
        project_id: options?.project_id,
        agent_id: options?.agent_id,
        limit,
        offset: cursor,
      });
      const rows = page.memories ?? [];
      if (total === undefined) total = page.total ?? rows.length;
      if (typeof page.days === "number") days = page.days;
      memories.push(...rows);
      const ended =
        page.has_more === false ||
        (page.has_more === undefined && rows.length < limit);
      if (ended) break;
      if (page.has_more === true && page.next_cursor == null) {
        throw new MementosError(
          "memories stale page claimed more results without a cursor",
          502,
        );
      }
      const next = page.next_cursor ?? cursor + rows.length;
      if (seenCursors.has(next)) {
        throw new MementosError(
          "memories stale traversal repeated a continuation cursor",
          502,
        );
      }
      seenCursors.add(next);
      cursor = next;
    }
    const hasMore = target !== undefined && memories.length > target;
    const trimmed = hasMore ? memories.slice(0, target) : memories;
    return {
      memories: trimmed,
      count: trimmed.length,
      days,
      total,
      has_more: hasMore,
      next_cursor: hasMore ? (options?.offset ?? 0) + trimmed.length : null,
    };
  }

  getActivity(options?: { days?: number; scope?: MemoryScope; agent_id?: string; project_id?: string }): Promise<{
    activity: { date: string; memories_created: number; global_count: number; shared_count: number; private_count: number; avg_importance: number }[];
    days: number;
    total: number;
  }> {
    return this.get("/api/activity", options as Record<string, string | number | boolean | undefined>);
  }

  searchMemories(input: SearchMemoriesInput | string): Promise<{ results: Memory[]; count: number }> {
    const body = typeof input === "string" ? { query: input } : input;
    return this.post("/api/memories/search", body);
  }

  exportMemories(input: ExportMemoriesInput = {}): Promise<{ memories: Memory[]; count: number }> {
    return this.post("/api/memories/export", input);
  }

  importMemories(input: ImportMemoriesInput): Promise<{ imported: number; errors: string[]; total: number }> {
    return this.post("/api/memories/import", input);
  }

  cleanExpired(): Promise<{ cleaned: number }> {
    return this.post("/api/memories/clean");
  }

  extractFromSession(input: {
    session_id: string;
    title?: string;
    project?: string;
    model?: string;
    messages?: number;
    key_topics?: string[];
    summary?: string;
    agent_id?: string;
    project_id?: string;
    memories?: Partial<CreateMemoryInput>[];
  }): Promise<{ created: number; memory_ids: string[]; errors: string[]; session_id: string }> {
    return this.post("/api/memories/extract", input);
  }

  saveMemory(input: CreateMemoryInput): Promise<Memory> {
    return this.post("/api/memories", input);
  }

  getMemory(id: string): Promise<Memory> {
    return this.get(`/api/memories/${id}`);
  }

  getMemoryVersions(id: string): Promise<{ versions: MemoryVersion[]; count: number; current_version: number }> {
    return this.get(`/api/memories/${id}/versions`);
  }

  updateMemory(id: string, input: UpdateMemoryInput): Promise<Memory> {
    return this.patch(`/api/memories/${id}`, input);
  }

  deleteMemory(id: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/memories/${id}`);
  }

  // --------------------------------------------------------------------------
  // Agents
  // --------------------------------------------------------------------------

  listAgents(): Promise<{ agents: Agent[] }> {
    return this.get("/api/agents");
  }

  registerAgent(input: { name: string; role?: string; description?: string }): Promise<Agent> {
    return this.post("/api/agents", input);
  }

  getAgent(idOrName: string): Promise<Agent> {
    return this.get(`/api/agents/${idOrName}`);
  }

  updateAgent(idOrName: string, updates: { name?: string; role?: string; description?: string; metadata?: Record<string, unknown>; active_project_id?: string | null }): Promise<Agent> {
    return this.patch(`/api/agents/${idOrName}`, updates);
  }

  listAgentsByProject(projectId: string): Promise<{ agents: Agent[]; count: number }> {
    return this.get(`/api/agents`, { project_id: projectId });
  }

  // --------------------------------------------------------------------------
  // Projects
  // --------------------------------------------------------------------------

  listProjects(): Promise<{ projects: Project[] }> {
    return this.get("/api/projects");
  }

  registerProject(input: { name: string; path?: string; description?: string; memory_prefix?: string }): Promise<Project> {
    return this.post("/api/projects", input);
  }

  getProject(idOrName: string): Promise<Project> {
    return this.get(`/api/projects/${encodeURIComponent(idOrName)}`);
  }

  listProjectResources(
    projectId: string,
    options: ListMementosProjectResourcesOptions = {},
  ): Promise<MementosProjectResourcePage> {
    return this.get(`/api/projects/${encodeURIComponent(projectId)}/resources`, {
      limit: options.limit,
      cursor: options.cursor,
      resource_kinds: options.resource_kinds?.join(","),
    });
  }

  async listAllProjectResources(
    projectId: string,
    options: ListAllMementosProjectResourcesOptions = {},
  ): Promise<MementosProjectResourcePage> {
    const pageSize = options.page_size ?? 100;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
      throw new MementosError(
        "Project resource page_size must be an integer between 1 and 1000",
        400,
      );
    }
    let cursor: string | undefined;
    let first: MementosProjectResourcePage | undefined;
    let pageCount = 0;
    let maxPageCount = 1;
    const resources: MementosProjectResource[] = [];
    const seen = new Set<string>();
    const seenCursors = new Set<string>();

    do {
      const page = await this.listProjectResources(projectId, {
        limit: pageSize,
        cursor,
        resource_kinds: options.resource_kinds,
      });
      pageCount += 1;
      if (!first) {
        first = page;
        if (!Number.isSafeInteger(first.total) || first.total < 0) {
          throw new MementosError(
            `Project resource traversal for ${projectId} returned an invalid total`,
            502,
          );
        }
        maxPageCount = Math.max(1, Math.ceil(first.total / pageSize));
      }
      if (
        page.project_id !== projectId
        || page.collection_revision !== first.collection_revision
        || page.total !== first.total
        || JSON.stringify(page.resource_kinds) !== JSON.stringify(first.resource_kinds)
      ) {
        throw new MementosError(
          `Project resource collection changed during complete traversal for ${projectId}`,
          409,
        );
      }
      for (const resource of page.resources) {
        const key = `${resource.resource_kind}:${resource.stable_id}`;
        if (seen.has(key)) {
          throw new MementosError(
            `Project resource traversal returned duplicate stable ID ${key}`,
            502,
          );
        }
        seen.add(key);
        resources.push(resource);
      }
      if (page.has_more && !page.next_cursor) {
        throw new MementosError(
          `Project resource page for ${projectId} claimed more results without a cursor`,
          502,
        );
      }
      if (!page.has_more && page.next_cursor) {
        throw new MementosError(
          `Project resource page for ${projectId} returned a continuation cursor while claiming no more results`,
          502,
        );
      }
      if (page.next_cursor && seenCursors.has(page.next_cursor)) {
        throw new MementosError(
          `Project resource traversal for ${projectId} repeated a continuation cursor`,
          502,
        );
      }
      if (page.has_more && pageCount >= maxPageCount) {
        throw new MementosError(
          `Project resource traversal for ${projectId} exceeded its bounded ${maxPageCount}-page population`,
          502,
        );
      }
      if (page.next_cursor) seenCursors.add(page.next_cursor);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);

    if (!first || resources.length !== first.total) {
      throw new MementosError(
        `Project resource traversal for ${projectId} was incomplete`,
        502,
        { returned: resources.length, expected: first?.total },
      );
    }
    return {
      ...first,
      resources,
      count: resources.length,
      total: resources.length,
      limit: pageSize,
      cursor: null,
      next_cursor: null,
      has_more: false,
      complete: true,
      truncated: false,
    };
  }

  getProjectResource(
    projectId: string,
    resourceKind: MementosProjectResourceKind,
    stableId: string,
  ): Promise<MementosProjectResourceExactResult> {
    return this.get(
      `/api/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceKind)}/${encodeURIComponent(stableId)}`,
    );
  }

  async updateProject(
    id: string,
    request: ProjectGuardedUpdateRequest,
  ): Promise<ProjectGuardedUpdateResult> {
    const normalizedUpdates: UpdateProjectInput = {};
    if (request.updates.name !== undefined) normalizedUpdates.name = request.updates.name.trim();
    if (request.updates.path !== undefined) normalizedUpdates.path = request.updates.path.trim();
    if (request.updates.description !== undefined) {
      normalizedUpdates.description = request.updates.description;
    }
    if (request.updates.memory_prefix !== undefined) {
      normalizedUpdates.memory_prefix = request.updates.memory_prefix;
    }
    const result = await this.post<ProjectGuardedUpdateResult>(
      `/api/projects/${encodeURIComponent(id)}/guarded-update`,
      { ...request, updates: normalizedUpdates, dry_run: false },
    );
    if (result.project.id !== id || result.receipt?.target_id !== id) {
      throw new MementosError(
        `Project update did not persist for ${id}: server returned a different stable ID`,
        502
      );
    }
    for (const field of ["name", "path", "description", "memory_prefix"] as const) {
      if (
        normalizedUpdates[field] !== undefined &&
        result.project[field] !== normalizedUpdates[field]
      ) {
        throw new MementosError(
          `Project update did not persist for ${id}: ${field} remained ${JSON.stringify(result.project[field])}`,
          502
        );
      }
    }
    return result;
  }

  async previewProjectUpdate(
    id: string,
    request: ProjectGuardedUpdateRequest,
  ): Promise<ProjectGuardedUpdateResult> {
    const result = await this.post<ProjectGuardedUpdateResult>(
      `/api/projects/${encodeURIComponent(id)}/guarded-update`,
      { ...request, dry_run: true },
    );
    if (result.applied || result.receipt !== null || result.project.id !== id) {
      throw new MementosError(
        `Project update dry run violated its no-write contract for ${id}`,
        502,
      );
    }
    return result;
  }

  async rollbackProjectUpdate(
    id: string,
    request: ProjectGuardedRollbackRequest,
  ): Promise<ProjectGuardedUpdateResult> {
    const result = await this.post<ProjectGuardedUpdateResult>(
      `/api/projects/${encodeURIComponent(id)}/guarded-rollback`,
      request,
    );
    if (result.project.id !== id || result.receipt?.target_id !== id) {
      throw new MementosError(
        `Project rollback did not preserve the exact stable ID ${id}`,
        502,
      );
    }
    return result;
  }

  getProjectUpdateReceipt(
    id: string,
    receiptId: string,
    identity: ProjectAuthorityIdentity,
  ): Promise<ProjectUpdateReceipt> {
    return this.post(`/api/projects/${encodeURIComponent(id)}/update-receipts/lookup`, {
      ...identity,
      receipt_id: receiptId,
    });
  }

  async linkMemoryProject(
    memoryId: string,
    request: MemoryProjectLinkRequest,
  ): Promise<MemoryProjectLinkResult> {
    const result = await this.post<MemoryProjectLinkResult>(
      `/api/memories/${encodeURIComponent(memoryId)}/guarded-project-link`,
      { ...request, dry_run: false },
    );
    if (
      result.memory.id !== memoryId
      || result.memory.project_id !== request.target_project_id
      || result.project?.id !== request.target_project_id
      || result.receipt?.target_memory_id !== memoryId
      || result.receipt.requested_project_id !== request.target_project_id
      || result.receipt.after_link.project_id !== request.target_project_id
    ) {
      throw new MementosError(
        `Memory project link did not preserve the exact memory/project IDs for ${memoryId}`,
        502,
      );
    }
    if (!result.applied && !result.no_change) {
      throw new MementosError(
        `Memory project link returned neither applied nor no-change for ${memoryId}`,
        502,
      );
    }
    return result;
  }

  async previewMemoryProjectLink(
    memoryId: string,
    request: MemoryProjectLinkRequest,
  ): Promise<MemoryProjectLinkResult> {
    const result = await this.post<MemoryProjectLinkResult>(
      `/api/memories/${encodeURIComponent(memoryId)}/guarded-project-link`,
      { ...request, dry_run: true },
    );
    if (
      result.applied
      || result.receipt !== null
      || result.memory.id !== memoryId
      || result.memory.project_id !== request.target_project_id
      || result.project?.id !== request.target_project_id
    ) {
      throw new MementosError(
        `Memory project-link dry run violated its no-write or exact-ID contract for ${memoryId}`,
        502,
      );
    }
    return result;
  }

  async rollbackMemoryProjectLink(
    memoryId: string,
    request: MemoryProjectLinkRollbackRequest,
  ): Promise<MemoryProjectLinkResult> {
    const result = await this.post<MemoryProjectLinkResult>(
      `/api/memories/${encodeURIComponent(memoryId)}/guarded-project-link-rollback`,
      request,
    );
    if (
      result.memory.id !== memoryId
      || result.receipt?.target_memory_id !== memoryId
      || result.receipt.direction !== "rollback"
      || result.receipt.accepted_receipt_id !== request.accepted_receipt_id
    ) {
      throw new MementosError(
        `Memory project-link rollback did not preserve the exact stable memory ID ${memoryId}`,
        502,
      );
    }
    return result;
  }

  async getMemoryProjectLinkReceipt(
    memoryId: string,
    receiptId: string,
    identity: ProjectAuthorityIdentity,
  ): Promise<MemoryProjectLinkReceipt> {
    const receipt = await this.post<MemoryProjectLinkReceipt>(
      `/api/memories/${encodeURIComponent(memoryId)}/project-link-receipts/lookup`,
      { ...identity, receipt_id: receiptId },
    );
    if (
      receipt.receipt_id !== receiptId
      || receipt.target_memory_id !== memoryId
      || receipt.authority_id !== identity.authority_id
      || receipt.tenant_id !== identity.tenant_id
      || receipt.corpus_id !== identity.corpus_id
    ) {
      throw new MementosError(
        `Memory project-link receipt lookup returned a mismatched receipt for ${memoryId}`,
        502,
      );
    }
    return receipt;
  }

  getProjectAgents(idOrName: string): Promise<{ agents: Agent[]; count: number }> {
    return this.get(`/api/projects/${encodeURIComponent(idOrName)}/agents`);
  }

  // --------------------------------------------------------------------------
  // Entities
  // --------------------------------------------------------------------------

  listEntities(filter?: { type?: EntityType; limit?: number; offset?: number }): Promise<{ entities: Entity[]; count: number }> {
    return this.get("/api/entities", filter as Record<string, string | number | boolean | undefined>);
  }

  createEntity(input: CreateEntityInput): Promise<Entity> {
    return this.post("/api/entities", input);
  }

  mergeEntities(input: { source_id: string; target_id: string }): Promise<Entity> {
    return this.post("/api/entities/merge", input);
  }

  getEntity(id: string): Promise<Entity> {
    return this.get(`/api/entities/${id}`);
  }

  updateEntity(id: string, input: UpdateEntityInput): Promise<Entity> {
    return this.patch(`/api/entities/${id}`, input);
  }

  deleteEntity(id: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/entities/${id}`);
  }

  getEntityMemories(entityId: string): Promise<{ memories: Memory[]; count: number }> {
    return this.get(`/api/entities/${entityId}/memories`);
  }

  linkEntityMemory(entityId: string, input: { memory_id: string; role?: EntityRole }): Promise<{ linked: boolean }> {
    return this.post(`/api/entities/${entityId}/memories`, input);
  }

  unlinkEntityMemory(entityId: string, memoryId: string): Promise<{ unlinked: boolean }> {
    return this.delete(`/api/entities/${entityId}/memories/${memoryId}`);
  }

  getEntityRelations(entityId: string, filter?: { relation_type?: RelationType; direction?: "from" | "to" | "both" }): Promise<{ relations: Relation[] }> {
    return this.get(`/api/entities/${entityId}/relations`, filter as Record<string, string | number | boolean | undefined>);
  }

  // --------------------------------------------------------------------------
  // Relations
  // --------------------------------------------------------------------------

  createRelation(input: CreateRelationInput): Promise<Relation> {
    return this.post("/api/relations", input);
  }

  getRelation(id: string): Promise<Relation> {
    return this.get(`/api/relations/${id}`);
  }

  deleteRelation(id: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/relations/${id}`);
  }

  // --------------------------------------------------------------------------
  // Graph
  // --------------------------------------------------------------------------

  getGraph(entityId: string, options?: { depth?: number; relation_types?: RelationType[] }): Promise<{ nodes: Entity[]; edges: Relation[] }> {
    const q: Record<string, string | number | boolean | undefined> = {};
    if (options?.depth !== undefined) q["depth"] = options.depth;
    if (options?.relation_types?.length) q["relation_types"] = options.relation_types.join(",");
    return this.get(`/api/graph/${entityId}`, q);
  }

  findPath(fromId: string, toId: string): Promise<{ path: Entity[]; found: boolean }> {
    return this.get("/api/graph/path", { from: fromId, to: toId });
  }

  getGraphStats(): Promise<{ entity_count: number; relation_count: number; by_type: Record<string, number> }> {
    return this.get("/api/graph/stats");
  }

  // --------------------------------------------------------------------------
  // Resource locks
  // --------------------------------------------------------------------------

  async acquireLock(input: AcquireLockInput): Promise<ResourceLock | null> {
    try {
      return await this.post("/api/locks", input);
    } catch (e) {
      if (e instanceof Error && e.message.includes("409")) return null;
      throw e;
    }
  }

  checkLock(resourceType: ResourceType, resourceId: string, lockType?: LockType): Promise<ResourceLock[]> {
    const params: Record<string, string> = { resource_type: resourceType, resource_id: resourceId };
    if (lockType) params["lock_type"] = lockType;
    return this.get("/api/locks", params);
  }

  releaseLock(lockId: string, agentId: string): Promise<{ released: boolean }> {
    return this.request("DELETE", `/api/locks/${lockId}`, { agent_id: agentId });
  }

  listAgentLocks(agentId: string): Promise<ResourceLock[]> {
    return this.get(`/api/agents/${agentId}/locks`);
  }

  releaseAllAgentLocks(agentId: string): Promise<{ released: number }> {
    return this.request("DELETE", `/api/agents/${agentId}/locks`);
  }

  cleanExpiredLocks(): Promise<{ cleaned: number }> {
    return this.post("/api/locks/clean", {});
  }

  // --------------------------------------------------------------------------
  // Tasks
  // --------------------------------------------------------------------------

  /** Create a task. */
  createTask(input: CreateTaskInput): Promise<Task> {
    return this.post("/api/tasks", input);
  }

  /** List tasks with optional filters. */
  listTasks(filter: ListTasksFilter = {}): Promise<{ tasks: Task[]; count: number }> {
    const q: Record<string, string | number | boolean | undefined> = {};
    if (filter.status) q["status"] = filter.status;
    if (filter.priority) q["priority"] = filter.priority;
    if (filter.assigned_agent_id) q["assigned_agent_id"] = filter.assigned_agent_id;
    if (filter.project_id) q["project_id"] = filter.project_id;
    if (filter.session_id) q["session_id"] = filter.session_id;
    if (filter.parent_task_id !== undefined) {
      q["parent_task_id"] = filter.parent_task_id ?? "null";
    }
    if (filter.tags?.length) q["tags"] = filter.tags.join(",");
    if (filter.limit !== undefined) q["limit"] = filter.limit;
    if (filter.offset !== undefined) q["offset"] = filter.offset;
    return this.get("/api/tasks", q);
  }

  /** Get task stats (by status, priority, overdue). */
  getTaskStats(options?: { project_id?: string; agent_id?: string }): Promise<TaskStats> {
    return this.get("/api/tasks/stats", options as Record<string, string | number | boolean | undefined>);
  }

  /** Get a task by ID. */
  getTask(id: string): Promise<Task> {
    return this.get(`/api/tasks/${id}`);
  }

  /** Update a task. */
  updateTask(id: string, input: UpdateTaskInput): Promise<Task> {
    return this.patch(`/api/tasks/${id}`, input);
  }

  /** Delete a task. */
  deleteTask(id: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/tasks/${id}`);
  }

  /** List comments on a task. */
  listTaskComments(taskId: string): Promise<{ comments: TaskComment[]; count: number }> {
    return this.get(`/api/tasks/${taskId}/comments`);
  }

  /** Add a comment to a task. */
  addTaskComment(taskId: string, body: string, agentId?: string): Promise<TaskComment> {
    return this.post(`/api/tasks/${taskId}/comments`, { body, agent_id: agentId });
  }

  /** Delete a task comment. */
  deleteTaskComment(taskId: string, commentId: string): Promise<{ deleted: boolean }> {
    return this.delete(`/api/tasks/${taskId}/comments/${commentId}`);
  }

  // --------------------------------------------------------------------------
  // Context injection
  // --------------------------------------------------------------------------

  getContext(options?: {
    agent_id?: string;
    project_id?: string;
    max_tokens?: number;
    format?: "xml" | "markdown" | "compact" | "json";
  }): Promise<{ context: string; memories_count: number }> {
    return this.get("/api/inject", options as Record<string, string | number | boolean | undefined>);
  }

  // --------------------------------------------------------------------------
  // Auto-Memory
  // --------------------------------------------------------------------------

  processConversationTurn(
    turn: string,
    context?: { agent_id?: string; project_id?: string; session_id?: string }
  ): Promise<{ queued: boolean; queue: AutoMemoryQueueStats }> {
    return this.post("/api/auto-memory/process", { turn, ...context });
  }

  getAutoMemoryStatus(): Promise<{
    queue: AutoMemoryQueueStats;
    config: AutoMemoryConfig;
    providers: Record<string, { available: boolean; model: string }>;
  }> {
    return this.get("/api/auto-memory/status");
  }

  configureAutoMemory(
    config: Partial<AutoMemoryConfig> & { min_importance?: number; auto_entity_link?: boolean }
  ): Promise<{ updated: boolean; config: AutoMemoryConfig }> {
    return this.request("PATCH", "/api/auto-memory/config", config as Record<string, unknown>);
  }

  testExtraction(
    turn: string,
    options?: { provider?: "anthropic" | "openai" | "cerebras" | "grok"; agent_id?: string; project_id?: string }
  ): Promise<{ provider: string; model: string; extracted: SdkExtractedMemory[]; count: number; note: string }> {
    return this.post("/api/auto-memory/test", { turn, ...options });
  }

  // --------------------------------------------------------------------------
  // Hooks
  // --------------------------------------------------------------------------

  listHooks(type?: string): Promise<SdkHook[]> {
    const params = type ? `?type=${encodeURIComponent(type)}` : "";
    return this.get(`/api/hooks${params}`);
  }

  getHookStats(): Promise<{ total: number; byType: Record<string, number>; blocking: number; nonBlocking: number }> {
    return this.get("/api/hooks/stats");
  }

  listWebhooks(filter?: { type?: string; enabled?: boolean }): Promise<SdkWebhook[]> {
    const params = new URLSearchParams();
    if (filter?.type) params.set("type", filter.type);
    if (filter?.enabled !== undefined) params.set("enabled", String(filter.enabled));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.get(`/api/webhooks${qs}`);
  }

  createWebhook(input: {
    type: string;
    handler_url: string;
    priority?: number;
    blocking?: boolean;
    agent_id?: string;
    project_id?: string;
    description?: string;
  }): Promise<SdkWebhook> {
    return this.post("/api/webhooks", input as Record<string, unknown>);
  }

  getWebhook(id: string): Promise<SdkWebhook> {
    return this.get(`/api/webhooks/${id}`);
  }

  updateWebhook(id: string, updates: { enabled?: boolean; priority?: number; description?: string }): Promise<SdkWebhook> {
    return this.request("PATCH", `/api/webhooks/${id}`, updates as Record<string, unknown>);
  }

  deleteWebhook(id: string): Promise<void> {
    return this.request("DELETE", `/api/webhooks/${id}`);
  }

  enableWebhook(id: string): Promise<SdkWebhook> {
    return this.updateWebhook(id, { enabled: true });
  }

  disableWebhook(id: string): Promise<SdkWebhook> {
    return this.updateWebhook(id, { enabled: false });
  }

  // --------------------------------------------------------------------------
  // Synthesis
  // --------------------------------------------------------------------------

  runSynthesis(options?: {
    project_id?: string;
    agent_id?: string;
    dry_run?: boolean;
    max_proposals?: number;
    provider?: string;
  }): Promise<SynthesisResult> {
    return this.post("/api/synthesis/run", (options ?? {}) as Record<string, unknown>);
  }

  listSynthesisRuns(filter?: { project_id?: string; limit?: number }): Promise<{ runs: SynthesisRun[]; count: number }> {
    const params = new URLSearchParams();
    if (filter?.project_id) params.set("project_id", filter.project_id);
    if (filter?.limit) params.set("limit", String(filter.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.get(`/api/synthesis/runs${qs}`);
  }

  getSynthesisStatus(options?: { project_id?: string; run_id?: string }): Promise<{ lastRun: SynthesisRun | null; recentRuns: SynthesisRun[] }> {
    const params = new URLSearchParams();
    if (options?.project_id) params.set("project_id", options.project_id);
    if (options?.run_id) params.set("run_id", options.run_id);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.get(`/api/synthesis/status${qs}`);
  }

  rollbackSynthesis(runId: string): Promise<{ rolled_back: number; errors: string[] }> {
    return this.post(`/api/synthesis/rollback/${runId}`, {});
  }

  // --------------------------------------------------------------------------
  // Session ingestion
  // --------------------------------------------------------------------------

  ingestSession(input: {
    transcript: string;
    session_id: string;
    agent_id?: string;
    project_id?: string;
    source?: "claude-code" | "codex" | "manual" | "open-sessions";
    metadata?: Record<string, unknown>;
  }): Promise<{ job_id: string; status: string; message: string }> {
    return this.post("/api/sessions/ingest", input as Record<string, unknown>);
  }

  getSessionJob(jobId: string): Promise<SessionMemoryJob> {
    return this.get(`/api/sessions/jobs/${jobId}`);
  }

  listSessionJobs(filter?: { agent_id?: string; project_id?: string; status?: string; limit?: number }): Promise<{ jobs: SessionMemoryJob[]; count: number }> {
    const params = new URLSearchParams();
    if (filter?.agent_id) params.set("agent_id", filter.agent_id);
    if (filter?.project_id) params.set("project_id", filter.project_id);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.limit) params.set("limit", String(filter.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.get(`/api/sessions/jobs${qs}`);
  }

  getSessionQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    return this.get("/api/sessions/queue/stats");
  }
}

export default MementosClient;
