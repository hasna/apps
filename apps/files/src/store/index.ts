/**
 * The single entry point every CLI command, MCP tool, and SDK method uses to
 * reach the files data plane. {@link resolveStore} inspects the environment once
 * and returns the correct transport:
 *
 *   - `HASNA_FILES_API_URL` + `HASNA_FILES_API_KEY` both present (aliases
 *     `FILES_API_URL` / `FILES_API_KEY`) => {@link ApiStore} (HTTPS `/v1` +
 *     bearer).
 *   - otherwise, ONLY when the operator explicitly opted in via
 *     `HASNA_FILES_LOCAL_MODE=1` (alias `FILES_LOCAL_MODE=1`) =>
 *     {@link LocalStore} (on-box SQLite). Local mode is never a default.
 *   - neither hosted pair nor local opt-in => throws (fail-closed) with an
 *     actionable error naming the required env: no silent `~/.hasna/files/
 *     files.db`, no false-green local session.
 *
 * Throws when the hosted transport is requested but misconfigured (or resolves
 * away from `http`), so a client can never silently drift back to a different
 * dataset.
 */
import { resolveFilesCloudStorage } from "../lib/cloud-storage.js";
import { ApiStore } from "./api-store.js";
import { LocalStore } from "./local-store.js";
import type { FilesStore } from "./types.js";

export type { FilesStore, CreateSourceInput, CreateCollectionOptions, CreateProjectOptions } from "./types.js";
export { LocalStore } from "./local-store.js";
export { ApiStore } from "./api-store.js";

let cache: FilesStore | undefined;

/** Resolve the active {@link FilesStore} for the current environment. */
export function resolveStore(env: NodeJS.ProcessEnv = process.env): FilesStore {
  const cloud = resolveFilesCloudStorage(env);
  return cloud.active ? new ApiStore(cloud.client, cloud.fetchContent) : new LocalStore();
}

/** Memoized {@link resolveStore} for the process lifetime. */
export function store(env: NodeJS.ProcessEnv = process.env): FilesStore {
  if (cache === undefined) cache = resolveStore(env);
  return cache;
}

/** Test-only: drop the memoized store so a new env can be resolved. */
export function resetStoreCache(): void {
  cache = undefined;
}
