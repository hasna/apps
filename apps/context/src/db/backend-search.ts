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
import { getStorageMode, getStoragePg } from "./storage-sync.js";
import { searchChunks } from "./chunks.js";
import { searchLibraries } from "./libraries.js";
import type { Library, SearchResult } from "../types/index.js";

export function usesHostedBackend(): boolean {
  return getStorageMode() !== "local";
}

export async function searchChunksOnBackend(
  query: string,
  libraryId?: string,
  limit = 10,
): Promise<SearchResult[]> {
  if (!usesHostedBackend()) return searchChunks(query, libraryId, limit);
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
  const remote = await getStoragePg();
  try {
    return await remote.searchLibraries(query, limit);
  } finally {
    await remote.close();
  }
}
