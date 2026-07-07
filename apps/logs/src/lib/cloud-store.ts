/**
 * @hasna/logs — cloud (self_hosted) storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Client-side piece that makes `mode=self_hosted` real for the logs CLI/MCP.
 * When the client-flip contract resolves to `cloud-http` (i.e.
 * HASNA_LOGS_STORAGE_MODE=self_hosted AND HASNA_LOGS_API_URL + HASNA_LOGS_API_KEY
 * are set), ALL log reads and writes are routed to the app's cloud HTTP API
 * (`https://logs.hasna.xyz/v1/logs`) with the bearer key — NOT the local SQLite
 * store, NOT a raw DSN.
 *
 * When the flip does not resolve to cloud, this returns `null` and the CLI uses
 * its local SQLite store exactly as before (fully reversible: unset the env vars
 * -> local).
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts.
 */
import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { LogEntry, LogLevel, LogRow } from "../types/index.ts";

/** App slug used for the client-flip env keys (HASNA_LOGS_*). */
export const LOGS_APP_SLUG = "logs";

/** Cloud resource path served under /v1 by logs cloud serve. */
export const LOGS_RESOURCE = "logs";

export interface LogsCloudListQuery {
  project_id?: string;
  level?: LogLevel | LogLevel[];
  service?: string;
  trace_id?: string;
  text?: string;
  limit?: number;
}

export interface LogsCloudStore {
  /** `<origin>/v1` base URL the client targets. */
  readonly baseUrl: string;
  list(query?: LogsCloudListQuery): Promise<LogRow[]>;
  get(id: string): Promise<LogRow | null>;
  create(entry: LogEntry): Promise<LogRow>;
  delete(id: string): Promise<boolean>;
}

/** Normalize a cloud log record (metadata as object) into the CLI's LogRow. */
function toLogRow(record: Record<string, unknown>): LogRow {
  const meta = record.metadata;
  const metadata =
    meta == null ? null : typeof meta === "string" ? meta : JSON.stringify(meta);
  return {
    id: String(record.id),
    timestamp: String(record.timestamp ?? ""),
    project_id: (record.project_id as string | null) ?? null,
    page_id: (record.page_id as string | null) ?? null,
    level: (record.level as LogLevel) ?? "info",
    source: (record.source as LogRow["source"]) ?? "sdk",
    service: (record.service as string | null) ?? null,
    message: String(record.message ?? ""),
    trace_id: (record.trace_id as string | null) ?? null,
    session_id: (record.session_id as string | null) ?? null,
    agent: (record.agent as string | null) ?? null,
    url: (record.url as string | null) ?? null,
    stack_trace: (record.stack_trace as string | null) ?? null,
    metadata,
  };
}

function wrap(client: HasnaStorageClient): LogsCloudStore {
  return {
    baseUrl: client.baseUrl,

    async list(query: LogsCloudListQuery = {}): Promise<LogRow[]> {
      const q: Record<string, string | number | undefined> = {};
      if (query.project_id) q.project_id = query.project_id;
      if (query.service) q.service = query.service;
      if (query.trace_id) q.trace_id = query.trace_id;
      if (query.text) q.q = query.text;
      if (query.limit !== undefined) q.limit = query.limit;
      // The cloud API filters a single level server-side; when multiple levels
      // are requested, fetch unfiltered and narrow client-side below.
      const levels = query.level ? (Array.isArray(query.level) ? query.level : [query.level]) : [];
      if (levels.length === 1) q.level = levels[0];
      const res = await client.list<Record<string, unknown>>(LOGS_RESOURCE, { query: q });
      const raw = res.raw as { logs?: unknown[] } | null;
      const arr = Array.isArray(raw?.logs) ? raw!.logs : res.items;
      let rows = (arr as Record<string, unknown>[]).map(toLogRow);
      if (levels.length > 1) {
        const set = new Set(levels);
        rows = rows.filter((r) => set.has(r.level));
      }
      return rows;
    },

    async get(id: string): Promise<LogRow | null> {
      const record = await client.get<Record<string, unknown>>(LOGS_RESOURCE, id);
      return record ? toLogRow(record) : null;
    },

    async create(entry: LogEntry): Promise<LogRow> {
      const body: Record<string, unknown> = {
        level: entry.level,
        message: entry.message,
        project_id: entry.project_id ?? null,
        source: entry.source ?? null,
        service: entry.service ?? null,
        trace_id: entry.trace_id ?? null,
        session_id: entry.session_id ?? null,
        agent: entry.agent ?? null,
        url: entry.url ?? null,
        stack_trace: entry.stack_trace ?? null,
        metadata: entry.metadata ?? null,
        timestamp: entry.timestamp ?? null,
      };
      const record = await client.create<Record<string, unknown>>(LOGS_RESOURCE, body);
      return toLogRow(record);
    },

    async delete(id: string): Promise<boolean> {
      const existing = await client.get<Record<string, unknown>>(LOGS_RESOURCE, id);
      if (!existing) return false;
      await client.delete(LOGS_RESOURCE, id);
      return true;
    },
  };
}

/** Env keys the resolver reads for the client-flip (canonical + LOGS_ aliases). */
const MODE_KEYS = [
  "HASNA_LOGS_STORAGE_MODE",
  "HASNA_LOGS_MODE",
  "LOGS_STORAGE_MODE",
  "LOGS_MODE",
] as const;
const API_URL_KEYS = ["HASNA_LOGS_API_URL", "LOGS_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_LOGS_API_KEY", "LOGS_API_KEY"] as const;

function firstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (env[k]?.trim() ?? "") !== "");
}

/**
 * The fleet flip writes exactly two vars per app — `HASNA_LOGS_API_URL` and
 * `HASNA_LOGS_API_KEY` — and deliberately does NOT set a storage-mode var.
 * Presence of both API vars therefore *is* self_hosted intent: synthesize
 * `HASNA_LOGS_STORAGE_MODE=self_hosted` so the @hasna/contracts client-flip
 * resolves to `cloud-http`. If a mode var is already present we leave the env
 * untouched (explicit `=local` stays local; unset both API vars -> local).
 */
function withImpliedSelfHostedMode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (firstSet(env, MODE_KEYS)) return env;
  if (firstSet(env, API_URL_KEYS) && firstSet(env, API_KEY_KEYS)) {
    return { ...env, HASNA_LOGS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/**
 * Resolve the cloud logs store from the environment. Returns a ready
 * {@link LogsCloudStore} when the client-flip resolves to cloud-http, else
 * `null` so the caller uses the local SQLite store. Throws if cloud was
 * requested but misconfigured (never silent local drift).
 *
 * self_hosted is implied by the two flip vars (API_URL + API_KEY) even when no
 * storage-mode var is set — matching what `@hasna/machines flip` writes.
 */
export function resolveLogsCloudStore(env: NodeJS.ProcessEnv = process.env): LogsCloudStore | null {
  const resolved = resolveStorageClient(LOGS_APP_SLUG, withImpliedSelfHostedMode(env));
  if (resolved.transport !== "cloud-http") return null;
  return wrap(resolved.client);
}
