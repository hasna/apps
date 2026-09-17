import { SqliteAdapter as Database } from "../storage.js";
type SQLQueryBindings = string | number | null | boolean;
import { getDatabase, now, uuid } from "./database.js";
import { isApiMode, apiJson, toQuery } from "./api-mode.js";
import {
  MementosApiProtocolError,
  expectArray,
  expectBoolean,
  expectNonNegativeInteger,
  expectNullableString,
  expectObject,
  expectRecord,
  expectString,
} from "./api-response-contract.js";

export type SessionJobSource = "claude-code" | "codex" | "manual" | "open-sessions";
export type SessionJobStatus = "pending" | "processing" | "completed" | "failed";
export const SESSION_JOBS_PAGE_CONTRACT = "mementos.sessions.jobs.v2" as const;
export const SESSION_INGEST_CONTRACT = "mementos.sessions.ingest.v2" as const;

export interface SessionMemoryJob {
  id: string;
  session_id: string;
  agent_id: string | null;
  project_id: string | null;
  source: SessionJobSource;
  status: SessionJobStatus;
  transcript: string;
  chunk_count: number;
  memories_extracted: number;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateSessionJobInput {
  session_id: string;
  transcript: string;
  source?: SessionJobSource;
  agent_id?: string;
  project_id?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionJobFilter {
  agent_id?: string;
  project_id?: string;
  status?: SessionJobStatus;
  session_id?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateSessionJobInput {
  status?: SessionJobStatus;
  chunk_count?: number;
  memories_extracted?: number;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

// ============================================================================
// Parsers
// ============================================================================

const SESSION_JOB_SOURCES = new Set<SessionJobSource>(["claude-code", "codex", "manual", "open-sessions"]);
const SESSION_JOB_STATUSES = new Set<SessionJobStatus>(["pending", "processing", "completed", "failed"]);

function parseHostedSessionJob(value: unknown, operation: string): SessionMemoryJob {
  const row = expectObject(value, operation);
  const source = expectString(row, "source", operation);
  const status = expectString(row, "status", operation);
  if (!SESSION_JOB_SOURCES.has(source as SessionJobSource)) {
    throw new MementosApiProtocolError(operation, "unsupported 'source'");
  }
  if (!SESSION_JOB_STATUSES.has(status as SessionJobStatus)) {
    throw new MementosApiProtocolError(operation, "unsupported 'status'");
  }
  return {
    id: expectString(row, "id", operation),
    session_id: expectString(row, "session_id", operation),
    agent_id: expectNullableString(row, "agent_id", operation),
    project_id: expectNullableString(row, "project_id", operation),
    source: source as SessionJobSource,
    status: status as SessionJobStatus,
    transcript: expectString(row, "transcript", operation, { allowEmpty: true }),
    chunk_count: expectNonNegativeInteger(row, "chunk_count", operation),
    memories_extracted: expectNonNegativeInteger(row, "memories_extracted", operation),
    error: expectNullableString(row, "error", operation),
    metadata: expectRecord(row, "metadata", operation),
    created_at: expectString(row, "created_at", operation),
    started_at: expectNullableString(row, "started_at", operation),
    completed_at: expectNullableString(row, "completed_at", operation),
  };
}

function parseJobRow(row: Record<string, unknown>): SessionMemoryJob {
  return {
    id: row["id"] as string,
    session_id: row["session_id"] as string,
    agent_id: (row["agent_id"] as string) || null,
    project_id: (row["project_id"] as string) || null,
    source: row["source"] as SessionJobSource,
    status: row["status"] as SessionJobStatus,
    transcript: row["transcript"] as string,
    chunk_count: row["chunk_count"] as number,
    memories_extracted: row["memories_extracted"] as number,
    error: (row["error"] as string) || null,
    metadata: JSON.parse((row["metadata"] as string) || "{}") as Record<string, unknown>,
    created_at: row["created_at"] as string,
    started_at: (row["started_at"] as string) || null,
    completed_at: (row["completed_at"] as string) || null,
  };
}

// ============================================================================
// CRUD
// ============================================================================

export function createSessionJob(
  input: CreateSessionJobInput,
  db?: Database
): SessionMemoryJob {
  if (!db && isApiMode()) {
    const operation = "POST /sessions/ingest";
    const { data } = apiJson<unknown>("POST", "/sessions/ingest", {
      session_id: input.session_id,
      transcript: input.transcript,
      source: input.source ?? "manual",
      agent_id: input.agent_id,
      project_id: input.project_id,
      metadata: input.metadata ?? {},
    });
    const response = expectObject(data, operation);
    if (response["contract"] !== SESSION_INGEST_CONTRACT) {
      throw new MementosApiProtocolError(
        operation,
        `expected contract '${SESSION_INGEST_CONTRACT}'`,
      );
    }
    const jobId = expectString(response, "job_id", operation);
    const jobObject = expectObject(response["job"], operation);
    const job = parseHostedSessionJob(
      { ...jobObject, transcript: input.transcript },
      `${operation} job`,
    );
    if (job.id !== jobId || job.session_id !== input.session_id) {
      throw new MementosApiProtocolError(operation, "job receipt identity does not match the request");
    }
    return job;
  }
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const source = input.source ?? "manual";
  const metadata = JSON.stringify(input.metadata ?? {});

  d.run(
    `INSERT INTO session_memory_jobs
      (id, session_id, agent_id, project_id, source, status, transcript, chunk_count, memories_extracted, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, 0, ?, ?)`,
    [
      id,
      input.session_id,
      input.agent_id ?? null,
      input.project_id ?? null,
      source,
      input.transcript,
      metadata,
      timestamp,
    ]
  );

  return getSessionJob(id, d)!;
}

export function getSessionJob(id: string, db?: Database): SessionMemoryJob | null {
  if (!db && isApiMode()) {
    const operation = `GET /sessions/jobs/${encodeURIComponent(id)}`;
    const { status, data } = apiJson<unknown>(
      "GET",
      `/sessions/jobs/${encodeURIComponent(id)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) return null;
    return parseHostedSessionJob(data, operation);
  }
  const d = db || getDatabase();
  const row = d
    .query("SELECT * FROM session_memory_jobs WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return parseJobRow(row);
}

export function listSessionJobs(
  filter?: SessionJobFilter,
  db?: Database
): SessionMemoryJob[] {
  if (!db && isApiMode()) {
    const q = toQuery({
      agent_id: filter?.agent_id,
      project_id: filter?.project_id,
      status: filter?.status,
      session_id: filter?.session_id,
      limit: filter?.limit,
      offset: filter?.offset,
    });
    const operation = "GET /sessions/jobs";
    const { data } = apiJson<unknown>("GET", `/sessions/jobs${q}`);
    const response = expectObject(data, operation);
    if (response["contract"] !== SESSION_JOBS_PAGE_CONTRACT) {
      throw new MementosApiProtocolError(
        operation,
        `expected contract '${SESSION_JOBS_PAGE_CONTRACT}'`,
      );
    }
    const jobs = expectArray(response["jobs"], operation, "jobs").map((job, index) =>
      parseHostedSessionJob(job, `${operation} item ${index}`),
    );
    const count = expectNonNegativeInteger(response, "count", operation);
    const responseLimit = expectNonNegativeInteger(response, "limit", operation);
    const responseOffset = expectNonNegativeInteger(response, "offset", operation);
    const hasMore = expectBoolean(response, "has_more", operation);
    const nextOffset = response["next_offset"];
    if (responseLimit < 1) {
      throw new MementosApiProtocolError(operation, "expected 'limit' to be positive");
    }
    if (count !== jobs.length || count > responseLimit) {
      throw new MementosApiProtocolError(operation, "page count is inconsistent with jobs/limit");
    }
    if (nextOffset !== null && (!Number.isSafeInteger(nextOffset) || (nextOffset as number) < 0)) {
      throw new MementosApiProtocolError(operation, "expected 'next_offset' to be a non-negative safe integer or null");
    }
    if (hasMore && nextOffset !== responseOffset + jobs.length) {
      throw new MementosApiProtocolError(operation, "'has_more' requires the exact next offset");
    }
    if (!hasMore && nextOffset !== null) {
      throw new MementosApiProtocolError(operation, "terminal page must set 'next_offset' to null");
    }
    if (filter?.limit !== undefined && responseLimit !== filter.limit) {
      throw new MementosApiProtocolError(operation, "server did not preserve requested 'limit'");
    }
    if (filter?.offset !== undefined && responseOffset !== filter.offset) {
      throw new MementosApiProtocolError(operation, "server did not preserve requested 'offset'");
    }
    for (const job of jobs) {
      if (filter?.agent_id !== undefined && job.agent_id !== filter.agent_id) {
        throw new MementosApiProtocolError(operation, "server did not preserve requested 'agent_id'");
      }
      if (filter?.project_id !== undefined && job.project_id !== filter.project_id) {
        throw new MementosApiProtocolError(operation, "server did not preserve requested 'project_id'");
      }
      if (filter?.session_id !== undefined && job.session_id !== filter.session_id) {
        throw new MementosApiProtocolError(operation, "server did not preserve requested 'session_id'");
      }
      if (filter?.status !== undefined && job.status !== filter.status) {
        throw new MementosApiProtocolError(operation, "server did not preserve requested 'status'");
      }
    }
    return jobs;
  }
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter?.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filter.agent_id);
  }
  if (filter?.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.session_id) {
    conditions.push("session_id = ?");
    params.push(filter.session_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ?? 20;
  const offset = filter?.offset ?? 0;

  const rows = d
    .query(
      `SELECT * FROM session_memory_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(parseJobRow);
}

export function updateSessionJob(
  id: string,
  updates: UpdateSessionJobInput,
  db?: Database
): SessionMemoryJob | null {
  const d = db || getDatabase();

  const setClauses: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    params.push(updates.status);
  }
  if (updates.chunk_count !== undefined) {
    setClauses.push("chunk_count = ?");
    params.push(updates.chunk_count);
  }
  if (updates.memories_extracted !== undefined) {
    setClauses.push("memories_extracted = ?");
    params.push(updates.memories_extracted);
  }
  if ("error" in updates) {
    setClauses.push("error = ?");
    params.push(updates.error ?? null);
  }
  if ("started_at" in updates) {
    setClauses.push("started_at = ?");
    params.push(updates.started_at ?? null);
  }
  if ("completed_at" in updates) {
    setClauses.push("completed_at = ?");
    params.push(updates.completed_at ?? null);
  }

  if (setClauses.length === 0) return getSessionJob(id, d);

  params.push(id);
  d.run(
    `UPDATE session_memory_jobs SET ${setClauses.join(", ")} WHERE id = ?`,
    params
  );

  return getSessionJob(id, d);
}

export function getNextPendingJob(db?: Database): SessionMemoryJob | null {
  const d = db || getDatabase();
  const row = d
    .query(
      "SELECT * FROM session_memory_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    )
    .get() as Record<string, unknown> | null;
  if (!row) return null;
  return parseJobRow(row);
}

/**
 * Atomically claim a pending job for processing.
 * Single-statement compare-and-swap: only a `pending` row transitions to
 * `processing`, so concurrent workers (server poll, CLI, MCP, route) can never
 * claim the same job twice. Returns the number of rows changed (1 = claimed,
 * 0 = already claimed, not pending, or missing).
 */
export function claimSessionJob(id: string, db?: Database): number {
  const d = db || getDatabase();
  const startedAt = now();
  const result = d.run(
    "UPDATE session_memory_jobs SET status = 'processing', started_at = ? WHERE id = ? AND status = 'pending'",
    [startedAt, id]
  );
  return result.changes;
}

/**
 * Requeue jobs stranded in `processing` by a crashed processor.
 * Resets rows whose claim started before the cutoff back to `pending` so the
 * poll re-picks them up. The cutoff is a JS-computed ISO-8601 timestamp
 * (matching the `started_at` written by claimSessionJob / updateSessionJob);
 * SQLite's `datetime('now')` must NOT be used here — its format differs from
 * the ISO-8601 stored by `now()` and would compare lexically wrong. Returns
 * the number of rows recovered.
 */
export function recoverStaleProcessingJobs(maxAgeMs: number, db?: Database): number {
  const d = db || getDatabase();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = d.run(
    "UPDATE session_memory_jobs SET status = 'pending', started_at = NULL WHERE status = 'processing' AND started_at < ?",
    [cutoff]
  );
  return result.changes;
}
