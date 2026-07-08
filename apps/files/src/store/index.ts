/**
 * The single entry point every CLI command, MCP tool, and SDK method uses to
 * reach the files data plane. {@link resolveStore} inspects the environment once
 * and returns the correct transport:
 *
 *   - `HASNA_FILES_API_URL` + `HASNA_FILES_API_KEY` present (or
 *     `HASNA_FILES_STORAGE_MODE` resolves to a cloud tier) => {@link ApiStore}
 *     (HTTPS `/v1` + bearer). `self_hosted` and `cloud` both land here.
 *   - otherwise => {@link LocalStore} (on-box SQLite, first-class).
 *
 * Throws when the cloud transport is requested but misconfigured, so a client
 * can never silently drift back to the wrong dataset.
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
  return cloud.active ? new ApiStore(cloud.client) : new LocalStore();
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
