// Client-side session store resolver (local vs self_hosted cloud).
//
// This is the ONE seam the CLI uses for session-record reads/writes. When the
// client-flip resolves to `cloud-http` — HASNA_SESSIONS_MODE=self_hosted (or
// cloud) AND HASNA_SESSIONS_API_URL + HASNA_SESSIONS_API_KEY are set — every
// read and write is routed to the app's cloud `/v1` HTTP API
// (the configured HASNA_SESSIONS_API_URL, e.g. https://sessions.your-deployment.example/v1)
// with the bearer key, using the
// @hasna/contracts HTTP storage client's transport. NO SQLite, NO DSN, NO raw
// RDS from a client.
//
// Otherwise (env unset) the local SQLite index (~/.hasna/sessions/sessions.db)
// is used exactly as before — `unset => local`.
//
// SAFETY: the API key lives only inside the transport; it is never logged.

import { resolveStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import { existsSync } from "node:fs";
import { normalizeStorageMode } from "../generated/storage-kit/mode.js";
import {
  SESSION_SOURCES,
  type Machine,
  type Message,
  type Session,
  type SessionContentImport,
  type SessionLookupOptions,
  type ToolCall,
} from "../types/index.js";
import type { SessionContentImportResult, UpsertSessionInput } from "./cloud/store.js";
import type { SearchHit, ToolCallHit } from "../lib/search.js";
import type { Entity, EntityType, RelatedSession, SessionGraph } from "../lib/graph.js";
import type { RecallOptions, RecallResponse } from "../lib/recall.js";
import { Database } from "bun:sqlite";
import type { EmbedResult } from "../lib/embeddings.js";
import type { MergeResult } from "./merge.js";
import type { IngestResult } from "../lib/ingest/index.js";
import { contentShrinkError } from "../lib/content-import-safety.js";

export interface IngestStoreOptions {
  /** Ingest only this provider (claude | codex | codewith | gemini). */
  source?: string;
  /** Ingest only these providers. Ignored when `source` is set. */
  sources?: string[];
  /** Re-ingest even files unchanged since the last run. */
  force?: boolean;
  /** Progress callback (one line per event). */
  onProgress?: (message: string) => void;
}

export type Env = Record<string, string | undefined>;

export interface ListOptions {
  source?: string;
  project_path?: string;
  machine?: string;
  limit?: number;
}

export interface SearchHitDto {
  session: Session;
  match: string;
  snippet?: string;
}

export interface StoreStats {
  session_count: number;
  message_count: number;
  tool_call_count: number;
  by_source: { source: string; sessions: number }[];
  projects: { project_name: string | null; project_path: string | null; session_count: number }[];
}

export interface SessionStore {
  readonly mode: "local" | "cloud";
  list(opts: ListOptions): Promise<Session[]>;
  recent(limit: number): Promise<Session[]>;
  get(idOrPrefix: string, opts?: SessionLookupOptions): Promise<Session | null>;
  create(input: UpsertSessionInput): Promise<Session>;
  /** Idempotently import/upsert a session with messages and tool calls. */
  importContent(input: SessionContentImport): Promise<SessionContentImportResult>;
  remove(id: string): Promise<boolean>;
  /**
   * Set a session's title (the "rename" operation), resolving by full id or a
   * unique id/source_id prefix. Local mode updates the on-box SQLite index;
   * self_hosted mode PATCHes `/v1/sessions/{id}` so the shared cloud registry is
   * what actually changes. Returns the updated session, or null if not found.
   */
  rename(idOrPrefix: string, title: string, opts?: SessionLookupOptions): Promise<Session | null>;
  /**
   * Rewrite session paths after a project directory move (old -> new): updates
   * project_path / source_path in the active index. Local mode touches the
   * on-box SQLite index; self_hosted mode hits `/v1/relocate` so the shared
   * cloud registry is what actually changes (never a split-brain no-op).
   */
  relocatePaths(oldPath: string, newPath: string): Promise<{ rowsUpdated: number }>;
  search(query: string, opts: ListOptions): Promise<SearchHitDto[]>;
  machines(): Promise<Machine[]>;
  stats(): Promise<StoreStats>;
  /** Message bodies for a session (local index only; cloud /v1 does not serve blobs). */
  messages(sessionId: string): Promise<Message[]>;
  /** Tool-call records for a session (local index only; cloud /v1 does not serve blobs). */
  toolCalls(sessionId: string): Promise<ToolCall[]>;
  /** Full content search (message bodies + metadata), one hit per session. */
  searchContent(query: string, opts: ListOptions): Promise<SearchHit[]>;
  /** Tool-call search (name / input / output). */
  searchToolCalls(query: string, opts: ListOptions): Promise<ToolCallHit[]>;
  /** Semantic (embedding) search. */
  semanticSearch(query: string, opts: ListOptions): Promise<SearchHit[]>;
  /** Hybrid full-text + semantic search (RRF). */
  hybridSearch(query: string, opts: ListOptions): Promise<SearchHit[]>;
  /** Natural-language recall with evidence, touched files, and resume metadata. */
  recall(query: string, opts: RecallOptions): Promise<RecallResponse>;
  /** Knowledge-graph entities (projects/tools/models/providers/repos). */
  graphEntities(type?: EntityType): Promise<Entity[]>;
  /** Sessions related to a graph entity. */
  graphRelated(type: EntityType, name: string, limit: number): Promise<RelatedSession[]>;
  /** The entity neighborhood of a single session. */
  graphSession(idOrPrefix: string, opts?: SessionLookupOptions): Promise<SessionGraph | null>;
  /** Generate embeddings for indexed messages (index maintenance). */
  embed(opts: { limit?: number }): Promise<EmbedResult>;
  /** Merge another machine's local sessions DB into this one (local-to-local sync). */
  mergeFromDb(path: string): Promise<MergeResult>;
  /**
   * Index local transcript files into the on-box session index. This is an
   * inherently LOCAL maintenance operation: even on a flipped (self_hosted)
   * machine, `sync` ingests into the on-box index first and then pushes the
   * metadata to the shared cloud `/v1` registry. The cloud transport has no
   * local index, so it throws rather than pretending to ingest.
   */
  ingest(opts?: IngestStoreOptions): Promise<IngestResult[]>;
  /** Recompute per-machine session counts in the index (index maintenance). */
  recomputeMachines(): Promise<void>;
}

const APP = "sessions";

// -- Explicit mode selection -------------------------------------------------
//
// This client PINS the storage mode before calling the contracts resolver. It
// must never depend on that resolver inferring a cloud transition from the mere
// presence of an API URL (or of a credential the resolver can find on disk).
//
// Owner ruling 2026-07-29: a local->network transition must be explicitly
// signalled, never inferred from a credential file appearing on disk. The
// contracts client still infers today, and hasna/contracts#51 removes it. When
// that lands, a consumer that passes `process.env` straight through gets the
// LOCAL SQLite store for a fully-configured cloud client -- silently, at exit 0,
// which is the exact silent-degrade this fleet has spent the day chasing.
//
// Measured 2026-07-30: of the five repos importing the contracts client at
// runtime, `domains`, `logs` and `todos` already pin; `files` and `sessions` did
// not, and were the two that #51 would strand. This is the `sessions` pin, and it
// deliberately mirrors `withImpliedSelfHostedMode` in @hasna/logs so the fleet
// converges on one shape rather than five.
//
// Pinning is also what makes this client immune to WHICH inference is live
// upstream -- env pair, URL alone, or disk credential. The mode is ours to state.

const MODE_KEYS = [
  "HASNA_SESSIONS_STORAGE_MODE",
  "HASNA_SESSIONS_MODE",
  "SESSIONS_STORAGE_MODE",
  "SESSIONS_MODE",
] as const;
const API_URL_KEYS = ["HASNA_SESSIONS_API_URL", "SESSIONS_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_SESSIONS_API_KEY", "SESSIONS_API_KEY"] as const;

/** True when any of `keys` carries a non-blank value. The value is never read out. */
function anySet(source: Env, keys: readonly string[]): boolean {
  return keys.some((k) => (source[k]?.trim() ?? "") !== "");
}

/**
 * The value that means "use the server" in the INSTALLED @hasna/contracts.
 *
 * Derived, never hardcoded, and that is load-bearing rather than tidy. The
 * storage-mode enum has already changed once: contracts <=0.8.5 accepts `cloud`
 * plus the deprecated aliases `self_hosted`/`remote`/`hybrid`, while contracts
 * after the inference removal accepts ONLY `sqlite`/`postgres` and THROWS on
 * everything else. The two valid sets are DISJOINT, so any literal pinned here
 * is a bet on which side of that change a machine is on, and the bet loses on
 * one side or the other.
 *
 * Measured 2026-07-30 against contracts 0.5.2: `postgres` throws, `self_hosted`
 * normalizes. Against contracts main (0.8.6): `postgres` normalizes,
 * `self_hosted` throws. Probing newest-first therefore yields the right token on
 * both generations, and on the next one provided it keeps a server token here.
 *
 * The probe runs through the library's own `normalizeStorageMode`, so the answer
 * comes from the installed code rather than from our belief about it.
 */
export const SERVER_MODE_CANDIDATES = ["cloud", "local"] as const;

/** Accepts a mode token or throws. Injectable so both enum generations are testable. */
export type ModeNormalizer = (value: string) => unknown;

let cachedServerMode: string | null = null;

export function serverStorageMode(normalize: ModeNormalizer = normalizeStorageMode): string {
  const useCache = normalize === (normalizeStorageMode as ModeNormalizer);
  if (useCache && cachedServerMode !== null) return cachedServerMode;
  for (const candidate of SERVER_MODE_CANDIDATES) {
    try {
      normalize(candidate);
      if (useCache) cachedServerMode = candidate;
      return candidate;
    } catch {
      // Not a token this generation of @hasna/contracts understands.
    }
  }
  // Every candidate was rejected: the enum changed again and this list is stale.
  // Fail loudly rather than guess -- guessing is the defect class this pin exists
  // to remove, and a wrong mode silently reads the wrong dataset.
  throw new Error(
    `No known server storage mode is accepted by the installed @hasna/contracts ` +
      `(tried ${SERVER_MODE_CANDIDATES.join(", ")}). The storage-mode enum has changed; ` +
      `add the new server token to SERVER_MODE_CANDIDATES in src/db/session-store.ts.`,
  );
}

interface SourceDbRow {
  id: string;
  source: string;
  source_id: string;
  [key: string]: unknown;
}

/**
 * Hosted import-db: read ANOTHER machine's sessions database file (a local
 * input artifact, never this machine's own index) read-only, and push each
 * session's content into the shared registry through /v1/sessions/import.
 * Embeddings are not transferred — the hosted store regenerates them via
 * `sessions embed` (server-side /v1/embed), which the local merge's raw row
 * copy cannot express on Postgres.
 */
async function mergeFromDbViaApi(
  t: HasnaStorageClient["transport"],
  path: string,
): Promise<MergeResult> {
  if (!existsSync(path)) throw new Error(`No such database: ${path}`);
  const src = new Database(path, { readonly: true });
  try {
    const sessionRows = src
      .query(
        `SELECT id, source, source_id, source_path, title, project_path, project_name,
                model, model_provider, git_branch, git_sha, git_origin_url, cli_version,
                is_subagent, parent_session_id, total_input_tokens, total_output_tokens,
                total_cache_read_tokens, total_cache_write_tokens, total_thinking_tokens,
                message_count, tool_call_count, started_at, ended_at, duration_seconds,
                ingested_at, updated_at, source_modified_at, machine, metadata
           FROM sessions`,
      )
      .all() as SourceDbRow[];
    const messageRows = src
      .query(
        `SELECT id, session_id, source_id, parent_message_id, role, content,
                content_preview, model, is_sidechain, sequence_num, input_tokens,
                output_tokens, cache_read_tokens, cache_write_tokens, thinking_tokens,
                timestamp, metadata
           FROM messages`,
      )
      .all() as Record<string, unknown>[];
    const toolCallRows = src
      .query(
        `SELECT id, message_id, session_id, tool_name, tool_input, tool_output,
                duration_ms, status, timestamp, metadata
           FROM tool_calls`,
      )
      .all() as Record<string, unknown>[];

    const messagesBySession = new Map<string, Record<string, unknown>[]>();
    for (const m of messageRows) {
      const key = String(m.session_id);
      const list = messagesBySession.get(key) ?? [];
      list.push(m);
      messagesBySession.set(key, list);
    }
    const toolCallsBySession = new Map<string, Record<string, unknown>[]>();
    for (const tc of toolCallRows) {
      const key = String(tc.session_id);
      const list = toolCallsBySession.get(key) ?? [];
      list.push(tc);
      toolCallsBySession.set(key, list);
    }

    let sessions = 0;
    let messages = 0;
    let tool_calls = 0;
    for (const row of sessionRows) {
      const id = String(row.id);
      // Existence pre-check so the reported count is "added", like the local merge.
      // Like the local merge's INSERT OR IGNORE: sessions already in the
      // registry are left untouched (importContent would replace their content,
      // which would clobber newer synced rows — not a merge).
      let exists = false;
      try {
        const current = await t.get<{ session: Session | null }>(
          `/sessions/${encodeURIComponent(id)}`,
        );
        exists = Boolean(current.session);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        exists = false; // 404 => new session
      }
      if (exists) continue;
      const source = String(row.source);
      if (!(SESSION_SOURCES as readonly string[]).includes(source)) {
        throw new Error(`invalid source '${source}' in ${path} (expected ${SESSION_SOURCES.join("|")})`);
      }
      const sessionInput: SessionContentImport = {
        session: {
          source: source as Session["source"],
          source_id: String(row.source_id),
          source_path: (row.source_path as string | null) ?? null,
          title: (row.title as string | null) ?? null,
          project_path: (row.project_path as string | null) ?? null,
          project_name: (row.project_name as string | null) ?? null,
          model: (row.model as string | null) ?? null,
          model_provider: (row.model_provider as string | null) ?? null,
          git_branch: (row.git_branch as string | null) ?? null,
          git_sha: (row.git_sha as string | null) ?? null,
          git_origin_url: (row.git_origin_url as string | null) ?? null,
          cli_version: (row.cli_version as string | null) ?? null,
          is_subagent: Boolean(row.is_subagent),
          parent_session_id: (row.parent_session_id as string | null) ?? null,
          machine: (row.machine as string | null) ?? null,
          started_at: (row.started_at as string | null) ?? null,
          ended_at: (row.ended_at as string | null) ?? null,
          duration_seconds:
            row.duration_seconds == null ? null : Number(row.duration_seconds),
          source_modified_at: (row.source_modified_at as string | null) ?? null,
          metadata: parseRowMetadata(row.metadata),
        },
        messages: (messagesBySession.get(id) ?? []).map((m) => ({
          id: String(m.id),
          session_id: String(m.session_id),
          source_id: (m.source_id as string | null) ?? null,
          parent_message_id: (m.parent_message_id as string | null) ?? null,
          role: String(m.role) as Message["role"],
          content: (m.content as string | null) ?? null,
          content_preview: (m.content_preview as string | null) ?? null,
          model: (m.model as string | null) ?? null,
          is_sidechain: Boolean(m.is_sidechain),
          sequence_num: m.sequence_num == null ? null : Number(m.sequence_num),
          input_tokens: Number(m.input_tokens ?? 0),
          output_tokens: Number(m.output_tokens ?? 0),
          cache_read_tokens: Number(m.cache_read_tokens ?? 0),
          cache_write_tokens: Number(m.cache_write_tokens ?? 0),
          thinking_tokens: Number(m.thinking_tokens ?? 0),
          timestamp: (m.timestamp as string | null) ?? null,
          metadata: parseRowMetadata(m.metadata),
        })),
        toolCalls: (toolCallsBySession.get(id) ?? []).map((tc) => ({
          id: String(tc.id),
          message_id: (tc.message_id as string | null) ?? null,
          session_id: String(tc.session_id),
          tool_name: String(tc.tool_name),
          tool_input: (tc.tool_input as string | null) ?? null,
          tool_output: (tc.tool_output as string | null) ?? null,
          duration_ms: tc.duration_ms == null ? null : Number(tc.duration_ms),
          status: (tc.status as ToolCall["status"]) ?? null,
          timestamp: (tc.timestamp as string | null) ?? null,
          metadata: parseRowMetadata(tc.metadata),
        })),
      };
      const res = await t.post<{
        imported?: { messages?: number; toolCalls?: number };
      }>("/sessions/import", sessionInput, {
        idempotencyKey: `${sessionInput.session.source}:${sessionInput.session.source_id}:content`,
      });
      sessions++;
      messages += res.imported?.messages ?? sessionInput.messages.length;
      tool_calls += res.imported?.toolCalls ?? sessionInput.toolCalls.length;
    }

    return { sessions, messages, tool_calls, embeddings: 0 };
  } finally {
    src.close();
  }
}

function parseRowMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Return an env whose storage mode is explicit.
 *
 * An already-set mode -- through any of the four documented variables -- is left
 * exactly as it is, so an operator pinning `local` is never overridden. Only the
 * complete API url + key pair implies `self_hosted`; half a pair implies nothing,
 * because half a pair is not a statement of intent.
 */
export function sessionsCloudEnv(source: Env = process.env): Env {
  if (anySet(source, MODE_KEYS)) return source;
  if (anySet(source, API_URL_KEYS) && anySet(source, API_KEY_KEYS)) {
    return { ...source, HASNA_SESSIONS_STORAGE_MODE: serverStorageMode() };
  }
  return source;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === 404
  );
}

/** Cloud (self_hosted) store: every op hits `/v1` over HTTPS with the bearer key. */
function cloudStore(client: HasnaStorageClient): SessionStore {
  const t = client.transport;
  const listQuery = (opts: ListOptions): Record<string, string | number> => {
    const q: Record<string, string | number> = {};
    if (opts.source) q.source = opts.source;
    if (opts.project_path) q.project = opts.project_path;
    if (opts.machine) q.machine = opts.machine;
    if (opts.limit !== undefined) q.limit = opts.limit;
    return q;
  };
  const lookupQuery = (opts: SessionLookupOptions = {}): Record<string, string> => {
    const q: Record<string, string> = {};
    if (opts.source) q.source = opts.source;
    return q;
  };
  return {
    mode: "cloud",
    async list(opts) {
      const res = await t.get<{ sessions: Session[] }>("/sessions", { query: listQuery(opts) });
      return res.sessions ?? [];
    },
    async recent(limit) {
      const res = await t.get<{ sessions: Session[] }>("/recent", { query: { limit } });
      return res.sessions ?? [];
    },
    async get(idOrPrefix, opts = {}) {
      try {
        const res = await t.get<{ session: Session }>(`/sessions/${encodeURIComponent(idOrPrefix)}`, {
          query: lookupQuery(opts),
        });
        return res.session ?? null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async create(input) {
      const res = await t.post<{ session: Session }>("/sessions", input, {
        idempotencyKey: `${input.source}:${input.source_id}`,
      });
      return res.session;
    },
    async importContent(input) {
      const res = await t.post<{ session: Session; imported: { messages: number; toolCalls: number }; backup: SessionContentImport["backup"] | null }>(
        "/sessions/import",
        input,
        {
          idempotencyKey: `${input.session.source}:${input.session.source_id}:content`,
        },
      );
      return {
        session: res.session,
        imported: res.imported,
        backup: res.backup ?? null,
      };
    },
    async remove(id) {
      try {
        await t.del(`/sessions/${encodeURIComponent(id)}`);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },
    async rename(idOrPrefix, title, opts = {}) {
      try {
        const res = await t.patch<{ session: Session }>(
          `/sessions/${encodeURIComponent(idOrPrefix)}`,
          { title },
          { query: lookupQuery(opts) },
        );
        return res.session ?? null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async relocatePaths(oldPath, newPath) {
      const res = await t.post<{ ok?: boolean; rowsUpdated?: number }>("/relocate", {
        oldPath,
        newPath,
      });
      return { rowsUpdated: res.rowsUpdated ?? 0 };
    },
    async search(query, opts) {
      const res = await t.get<{ results: SearchHitDto[] }>("/search", {
        query: { q: query, ...listQuery(opts) },
      });
      return res.results ?? [];
    },
    async machines() {
      const res = await t.get<{ machines: Machine[] }>("/machines");
      return res.machines ?? [];
    },
    async stats() {
      const res = await t.get<{ ok?: boolean } & StoreStats>("/stats");
      const { ok: _ok, ...stats } = res;
      return stats;
    },
    async messages(sessionId) {
      const res = await t.get<{ messages: Message[] }>(
        `/sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      return res.messages ?? [];
    },
    async toolCalls(sessionId) {
      const res = await t.get<{ toolCalls: ToolCall[] }>(`/sessions/${encodeURIComponent(sessionId)}/tool-calls`);
      return res.toolCalls ?? [];
    },
    async searchContent(query, opts) {
      const res = await t.get<{ results: SearchHit[] }>("/search/content", {
        query: { q: query, ...listQuery(opts) },
      });
      return res.results ?? [];
    },
    async searchToolCalls(query, opts) {
      const res = await t.get<{ results: ToolCallHit[] }>("/search/tools", {
        query: { q: query, ...listQuery(opts) },
      });
      return res.results ?? [];
    },
    async graphEntities(type) {
      const res = await t.get<{ entities: Entity[] }>("/graph", {
        query: type ? { type } : {},
      });
      return res.entities ?? [];
    },
    async graphRelated(type, name, limit) {
      const res = await t.get<{ sessions: RelatedSession[] }>("/graph", {
        query: { related: `${type}:${name}`, limit },
      });
      return res.sessions ?? [];
    },
    async graphSession(idOrPrefix, opts = {}) {
      try {
        const res = await t.get<{ graph: SessionGraph | null }>("/graph", {
          query: { session: idOrPrefix, ...lookupQuery(opts) },
        });
        return res.graph ?? null;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async semanticSearch(query, opts) {
      const res = await t.get<{ results: SearchHit[] }>("/search/semantic", {
        query: { q: query, ...listQuery(opts) },
      });
      return res.results ?? [];
    },
    async hybridSearch(query, opts) {
      const res = await t.get<{ results: SearchHit[] }>("/search/hybrid", {
        query: { q: query, ...listQuery(opts) },
      });
      return res.results ?? [];
    },
    async recall(query, opts) {
      const queryParams: Record<string, string | number> = { q: query };
      if (opts.limit !== undefined) queryParams.limit = opts.limit;
      if (opts.source) queryParams.source = opts.source;
      if (opts.project_path) queryParams.project = opts.project_path;
      if (opts.machine) queryParams.machine = opts.machine;
      if (opts.semantic === false) queryParams.semantic = "0";
      if (opts.semantic === true) queryParams.semantic = "1";
      const res = await t.get<RecallResponse>("/recall", { query: queryParams });
      return {
        query: res.query,
        count: res.count ?? 0,
        results: res.results ?? [],
        metadata: res.metadata,
      };
    },
    async embed(opts) {
      const res = await t.post<{ messagesProcessed?: number; chunksEmbedded?: number }>(
        "/embed",
        { limit: opts.limit ?? 200 },
      );
      return {
        messagesProcessed: res.messagesProcessed ?? 0,
        chunksEmbedded: res.chunksEmbedded ?? 0,
      };
    },
    async mergeFromDb(path) {
      return mergeFromDbViaApi(t, path);
    },
    // STRONG REASON (recorded, reviewed): `ingest` scans the machine's OWN
    // transcript files (~/.claude/projects, ~/.codex, ...). The hosted /v1
    // transport cannot see the client's filesystem, and silently opening the
    // local SQLite index from the transport is exactly the split-brain bug this
    // seam eliminated. The capability is NOT lost in hosted mode: `sessions
    // sync` (and `ingest-watch`) ingest locally via the on-box index and push
    // every parsed session to the shared registry through /v1/sessions/import.
    // The guard stays loud so no caller mistakes the transport for a file
    // scanner; the message names the working hosted route.
    async ingest() {
      throw new Error(
        `'ingest' scans transcript files on the machine where the CLI runs; the hosted /v1 API ` +
          `cannot read them. On a hosted machine run 'sessions sync' instead: it ingests locally ` +
          `and pushes every session to the shared registry via /v1/sessions/import.`,
      );
    },
    async recomputeMachines() {
      await t.post<{ ok?: boolean }>("/machines/recompute", {});
    },
  };
}


/** Local store: SQLite index, loaded lazily so cloud-only runs never open the DB. */
function localStore(): SessionStore {
  return {
    mode: "local",
    async list(opts) {
      const { listSessions } = await import("./sessions.js");
      return listSessions(opts);
    },
    async recent(limit) {
      const { getRecentSessions } = await import("./sessions.js");
      return getRecentSessions(limit);
    },
    async get(idOrPrefix, opts = {}) {
      const { getSessionByPrefix } = await import("./sessions.js");
      return getSessionByPrefix(idOrPrefix, opts);
    },
    async create(input) {
      const { upsertSession } = await import("./sessions.js");
      return upsertSession(input as never);
    },
    async importContent(input) {
      const { getMessages, getSessionByPrefix, getSessionBySource, getToolCalls, saveParsedSession } = await import("./sessions.js");
      const existing =
        getSessionBySource(input.session.source, input.session.source_id) ??
        (input.session.id ? getSessionByPrefix(input.session.id) : null);
      if (existing) {
        const error = contentShrinkError(input, {
          messages: getMessages(existing.id).length,
          toolCalls: getToolCalls(existing.id).length,
        });
        if (error) throw new Error(error);
      }
      const session = saveParsedSession(input);
      return {
        session,
        imported: {
          messages: input.messages.length,
          toolCalls: input.toolCalls.length,
        },
        backup: input.backup ?? null,
      };
    },
    async remove(id) {
      const { getSession, deleteSession } = await import("./sessions.js");
      try {
        getSession(id);
      } catch {
        return false;
      }
      deleteSession(id);
      return true;
    },
    async rename(idOrPrefix, title, opts = {}) {
      const { updateSessionTitle } = await import("./sessions.js");
      return updateSessionTitle(idOrPrefix, title, opts);
    },
    async relocatePaths(oldPath, newPath) {
      const { relocatePathsInDb } = await import("./sessions.js");
      return relocatePathsInDb(oldPath, newPath);
    },
    async search(query, opts) {
      const { searchSessions } = await import("../lib/search.js");
      const { getSession } = await import("./sessions.js");
      const out: SearchHitDto[] = [];
      for (const hit of searchSessions(query, opts)) {
        try {
          out.push({ session: getSession(hit.session_id), match: "title", snippet: hit.snippet });
        } catch {
          // pruned between search and fetch — skip.
        }
      }
      return out;
    },
    async machines() {
      const { listMachines } = await import("./machines.js");
      return listMachines();
    },
    async stats() {
      const { getIngestionStats } = await import("./ingestion.js");
      const { getProjectStats } = await import("./sessions.js");
      const ingestion = getIngestionStats();
      const bySource = ingestion.map((r) => ({ source: r.source, sessions: r.session_count }));
      const projects = getProjectStats().map((p) => ({
        project_name: p.project_name,
        project_path: p.project_path,
        session_count: p.session_count,
      }));
      return {
        session_count: ingestion.reduce((n, r) => n + r.session_count, 0),
        message_count: ingestion.reduce((n, r) => n + r.message_count, 0),
        tool_call_count: ingestion.reduce((n, r) => n + r.tool_call_count, 0),
        by_source: bySource,
        projects,
      };
    },
    async messages(sessionId) {
      const { getMessages } = await import("./sessions.js");
      return getMessages(sessionId);
    },
    async toolCalls(sessionId) {
      const { getToolCalls } = await import("./sessions.js");
      return getToolCalls(sessionId);
    },
    async searchContent(query, opts) {
      const { search } = await import("../lib/search.js");
      return search(query, opts);
    },
    async searchToolCalls(query, opts) {
      const { searchToolCalls } = await import("../lib/search.js");
      return searchToolCalls(query, opts);
    },
    async semanticSearch(query, opts) {
      const { semanticSearch } = await import("../lib/vector-search.js");
      return semanticSearch(query, opts);
    },
    async hybridSearch(query, opts) {
      const { hybridSearch } = await import("../lib/vector-search.js");
      return hybridSearch(query, opts);
    },
    async recall(query, opts) {
      const { recallSessions } = await import("../lib/recall.js");
      return recallSessions(query, opts);
    },
    async graphEntities(type) {
      const { listEntities } = await import("../lib/graph.js");
      return listEntities(type);
    },
    async graphRelated(type, name, limit) {
      const { relatedSessions } = await import("../lib/graph.js");
      return relatedSessions(type, name, limit);
    },
    async graphSession(idOrPrefix, opts = {}) {
      const { sessionGraph } = await import("../lib/graph.js");
      const { getSessionByPrefix } = await import("./sessions.js");
      const session = getSessionByPrefix(idOrPrefix, opts);
      if (!session) return null;
      return sessionGraph(session.id);
    },
    async embed(opts) {
      const { embedSessions } = await import("../lib/embeddings.js");
      return embedSessions(opts);
    },
    async mergeFromDb(path) {
      const { mergeFromDb } = await import("./merge.js");
      return mergeFromDb(path);
    },
    async ingest(opts = {}) {
      const { ingestAll, ingestSource } = await import("../lib/ingest/index.js");
      if (opts.source) {
        return [ingestSource(opts.source, { force: opts.force, onProgress: opts.onProgress })];
      }
      return ingestAll({ sources: opts.sources, force: opts.force, onProgress: opts.onProgress });
    },
    async recomputeMachines() {
      const { recomputeMachineCounts } = await import("./machines.js");
      recomputeMachineCounts();
    },
  };
}

/**
 * Resolve the active session store. Cloud-http when self_hosted + API_URL +
 * API_KEY are set (throws if cloud requested but misconfigured — no silent local
 * drift); local SQLite otherwise.
 */
export function resolveSessionStore(
  env: Env = process.env,
  overrides?: Parameters<typeof resolveStorageClient>[2],
): SessionStore {
  const resolved = resolveStorageClient(APP, sessionsCloudEnv(env), overrides);
  if (resolved.transport === "cloud-http") return cloudStore(resolved.client);
  return localStore();
}

/**
 * The LocalStore transport, resolved unconditionally (independent of env).
 *
 * Used only by the inherently-local index path: `ingest`/`reindex`/`ingest-watch`
 * populate the on-box index, and `sync` reads the on-box index to push it to the
 * shared cloud `/v1` registry even when the resolved store is `cloud`. This is
 * NOT a per-command local read fallback — the split-brain bug where reads
 * silently drifted to the local SQLite island stays deleted; those paths go
 * through `resolveSessionStore()`.
 */
export function getLocalStore(): SessionStore {
  return localStore();
}
