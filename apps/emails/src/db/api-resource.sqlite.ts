// Shared client-side api routing for the resource repositories.
//
// The STANDARD (single Store, no per-command local fallback) requires that in
// api mode EVERY list/read routes to the app's `/v1` API — never the local
// SQLite island. Historically only `domains` and `addresses` did this; the other
// resource repos (contacts, providers, templates, groups, sequences, owners,
// scheduled, send-keys, sent-mail) read local SQLite unconditionally, so a
// flipped client silently returned LOCAL data for `contact list`, `provider
// list`, etc. — the split-brain bug this module closes.
//
// Fail-closed: when the client is flipped to api but the endpoint does not yet
// exist server-side, `apiStoreFor(...).list()` gets an HTTP 404 and THROWS
// (ApiHttpError). It never silently degrades to the local store. Once the
// matching `/v1/<resource>` endpoint is deployed, the same call returns api
// data. The local SQLite client (isApiClientConfigured() === false) is entirely unaffected.

import { apiStoreFor, type ApiResourceStore } from "./api-store.js";
import { isApiClientConfigured } from "../store-resolution.js";
import { isExplicitDatabaseRoute } from "./database-routing.js";
import { safeOffset, safeOptionalLimit } from "./pagination.js";

/**
 * Return a api-backed store for `resource` when the client is flipped to
 * api, else null (local SQLite client — caller uses SQLite). Routed public calls
 * with an explicit Database are scoped locally and never consult this store.
 */
export function apiResource(resource: string): ApiResourceStore | null {
  if (isExplicitDatabaseRoute()) return null;
  if (!isApiClientConfigured()) return null;
  return apiStoreFor(resource);
}

export interface ApiPageOptions {
  limit?: number;
  offset?: number;
}

// Bounded superset fetched from the server so the caller can apply its own
// client-side filters (e.g. `--provider`, status, owner) and STILL return a full
// page after local windowing. Matches the `{ limit: 1000 }` convention already
// used in domains.ts/addresses.ts.
const API_LIST_FETCH_CAP = 1000;

/**
 * Build the server query for an API list call.
 *
 * The page is windowed LOCALLY by `apiPage` after the caller's own
 * client-side filters run. We therefore fetch a bounded superset and NEVER send
 * a server-side `offset`: sending an offset to the server AND slicing locally
 * double-windows the page (so `offset > 0` returned an empty list), and a
 * server-side page cut before a client-side filter under-fills the result.
 */
export function apiListQuery(opts?: ApiPageOptions): {
  query: Record<string, string | number | boolean | undefined>;
  limit: number | null;
  offset: number;
} {
  const query: Record<string, string | number | boolean | undefined> = {};
  const limit = safeOptionalLimit(opts?.limit);
  const offset = safeOffset(opts?.offset);
  // Only cap the fetch when a limit was requested; a null limit means "all rows"
  // and is windowed to identity by apiPage (its historical behavior).
  if (limit !== null) query["limit"] = Math.max(API_LIST_FETCH_CAP, limit + offset);
  return { query, limit, offset };
}

/** Window the requested page LOCALLY after an API list + client-side filters. */
export function apiPage<T>(rows: T[], limit: number | null, offset: number): T[] {
  if (limit === null) return rows;
  return rows.slice(offset, offset + limit);
}

// ---- value coercion (api JSON -> local typed columns) --------------------

export function cstr(v: unknown): string {
  return v == null ? "" : String(v);
}

export function cstrOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function cnum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function cbool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v === "true" || v === "1" || v === "t";
  return Boolean(v);
}

export function cstrArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      return [v];
    }
  }
  return [];
}

export function carray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function cobj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

/** now() fallback for a missing timestamp so mapped rows are always valid. */
export function ciso(v: unknown, fallback?: string): string {
  const s = cstrOrNull(v);
  return s ?? fallback ?? new Date().toISOString();
}
