/**
 * Search backend dispatch for the server-side search surfaces.
 *
 * The context capability "full-text search over libraries and chunks" must
 * work on BOTH backends: local SQLite FTS5 and the hosted Postgres backend.
 * When a Postgres backend is configured (storage mode remote/hybrid), the
 * server-side search surfaces query the hosted backend; otherwise they use
 * the local FTS5 index. CLI/verify/AI paths operate on the machine's own
 * local store by contract and are not dispatched here.
 */
import { getStorageMode, getStoragePg, runStorageMigrations } from "./storage-sync.js";
import { searchChunks } from "./chunks.js";
import { searchLibraries } from "./libraries.js";
import type { Library, SearchResult } from "../types/index.js";

export function usesHostedBackend(): boolean {
  return getStorageMode() !== "local";
}

/**
 * Ensure the hosted Postgres backend is search-ready before the first hosted
 * search of this process. The PostgreSQL schema (including migration 15 —
 * the generated tsvector columns + GIN indexes that full-text search queries)
 * is normally applied by `context storage push|pull|sync`, but the server-side
 * search surfaces must not depend on the operator having run a sync first:
 * a fresh or pre-migration database would otherwise fail the FTS query and
 * (before the error-propagation fix) silently return HTTP 200 with no
 * matches while stored results exist. Migrations are idempotent (IF NOT
 * EXISTS throughout) and run at most once per process; a failure clears the
 * memo so the next search retries, and the error itself propagates to the
 * caller instead of masquerading as an empty result set.
 */
let hostedSearchReady: Promise<void> | null = null;

function ensureHostedSearchReady(): Promise<void> {
  if (hostedSearchReady === null) {
    hostedSearchReady = (async () => {
      const remote = await getStoragePg();
      try {
        await runStorageMigrations(remote);
      } finally {
        await remote.close();
      }
    })().catch((error) => {
      hostedSearchReady = null;
      throw error;
    });
  }
  return hostedSearchReady;
}

export async function searchChunksOnBackend(
  query: string,
  libraryId?: string,
  limit = 10,
): Promise<SearchResult[]> {
  if (!usesHostedBackend()) return searchChunks(query, libraryId, limit);
  await ensureHostedSearchReady();
  const remote = await getStoragePg();
  try {
    return await remote.searchChunks(query, libraryId, limit);
  } finally {
    await remote.close();
  }
}

export async function searchLibrariesOnBackend(
  query: string,
  limit = 10,
): Promise<Library[]> {
  if (!usesHostedBackend()) return searchLibraries(query, limit);
  await ensureHostedSearchReady();
  const remote = await getStoragePg();
  try {
    return await remote.searchLibraries(query, limit);
  } finally {
    await remote.close();
  }
}
