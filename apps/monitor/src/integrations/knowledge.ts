/**
 * Knowledge native adapter (MON-V2-09).
 *
 * Package-owned surface: `@hasna/knowledge` SDK — `client.search` and
 * `client.items.create`. The adapter has no direct database or HTTP path:
 * every read and write is routed through the SDK client handed to
 * `createKnowledgeAdapter`.
 *
 * Query and creation are separately represented: `query()` maps to
 * `client.search` and `create()` maps to `client.items.create`; neither
 * method exercises the other surface.
 *
 * Failure semantics: non-fatal by default. Each operation returns a
 * structured outcome (`{ ok: true, value }` | `{ ok: false, error }`), so
 * the run service decides whether a confirmed failure affects the run
 * outcome (an action or integration marked `required: true`).
 *
 * Creation idempotency: `KnowledgeCreateRequest.id` is a caller-supplied
 * stable id (the design's effect key `hash(slug, run_id, action_index,
 * target, operation)`). The SDK honors caller-supplied ids with upsert
 * semantics on both transports, so a repeated action updates the same item
 * instead of duplicating.
 */
import type { KnowledgeClient } from "@hasna/knowledge/sdk";

/** The exact subset of the package-owned surface this adapter uses. */
export type KnowledgeClientSurface = Pick<KnowledgeClient, "search" | "items">;

/** Slug-level configuration from the monitor definition (`knowledge` block). */
export interface KnowledgeIntegrationConfig {
  /** Optional collection/scope identifier carried on created items. */
  collectionId?: string;
  /** Tags merged onto every created item. */
  tags?: string[];
}

export interface KnowledgeQueryRequest {
  query: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeQueryResultEntry {
  id: string;
  title: string | null;
  text: string | null;
  kind: string;
  score: number;
}

export interface KnowledgeQueryResult {
  query: string;
  count: number;
  results: KnowledgeQueryResultEntry[];
}

export interface KnowledgeCreateRequest {
  /** Stable caller-supplied id (effect key); the SDK upserts on it. */
  id?: string;
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeCreateResult {
  id: string;
  title: string;
}

export type KnowledgeAdapterOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface KnowledgeAdapter {
  /** Query the knowledge corpus through `client.search`. */
  readonly query: (request: KnowledgeQueryRequest) => Promise<KnowledgeAdapterOutcome<KnowledgeQueryResult>>;
  /** Create a reviewed knowledge item through `client.items.create`. */
  readonly create: (request: KnowledgeCreateRequest) => Promise<KnowledgeAdapterOutcome<KnowledgeCreateResult>>;
}

function failure(error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message };
}

export function createKnowledgeAdapter(
  client: KnowledgeClientSurface,
  config: KnowledgeIntegrationConfig = {},
): KnowledgeAdapter {
  return {
    async query(request) {
      try {
        const result = await client.search({
          query: request.query,
          limit: request.limit,
          offset: request.offset,
        });
        const entries: KnowledgeQueryResultEntry[] = result.results.map((entry) => ({
          id: entry.id,
          title: entry.title,
          text: entry.text,
          kind: entry.kind,
          score: entry.score,
        }));
        return {
          ok: true,
          value: { query: result.query, count: entries.length, results: entries },
        };
      } catch (error) {
        return failure(error);
      }
    },

    async create(request) {
      try {
        const tags = [...(config.tags ?? []), ...(request.tags ?? [])];
        const metadata: Record<string, unknown> = { ...request.metadata };
        if (config.collectionId !== undefined) {
          metadata.collectionId = config.collectionId;
        }
        const created = await client.items.create({
          id: request.id,
          title: request.title,
          content: request.content,
          tags,
          metadata,
        });
        return { ok: true, value: { id: created.id, title: created.title } };
      } catch (error) {
        return failure(error);
      }
    },
  };
}
