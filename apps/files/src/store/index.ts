/**
 * The single entry point every CLI command, MCP tool, and SDK method uses to
 * reach the files data plane. {@link resolveStore} resolves the transport ONCE
 * PER CALL — there is deliberately no process-lifetime cache — so the CLI, the
 * MCP server and the SDK all consult the @hasna/contracts credential chain
 * fresh on every request, exactly as the 2026-09-04 ruling (hasna/apps#1720)
 * requires: a long-lived MCP server or agent loop picks up a key rotation
 * without being rebuilt.
 *
 *   - hosted: the @hasna/contracts chain supplies the credential (explicit
 *     argument, `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
 *     `HASNA_FILES_API_KEY_REF`, the macOS Keychain item
 *     `hasna.credentials.files.api-key`, `~/.hasna/files/config/credentials`,
 *     `HASNA_FILES_API_KEY`) and the authority (`HASNA_FILES_API_URL`, the
 *     Keychain `api-url` item, the credentials file, else the fleet gateway
 *     `https://api.hasna.com/files`) => {@link ApiStore} (HTTPS `/v1`).
 *   - otherwise, ONLY when the operator explicitly opted in via
 *     `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`) => {@link LocalStore}
 *     (on-box SQLite). Local mode is never a default, and every local run
 *     prints one "LOCAL mode" line on stderr.
 *   - neither a resolvable credential nor the local opt-in => throws
 *     (fail-closed) naming every tier the resolver consulted: no silent
 *     `~/.hasna/files/files.db`, no false-green local session, no
 *     `*-local-fallback` event.
 *
 * The retired `HASNA_FILES_LOCAL_MODE` / `FILES_LOCAL_MODE` /
 * `*_STORAGE_MODE` switches are gone (they were this package's own spelling of
 * the transport decision; the resolver makes that decision now).
 */
import { resolveFilesCloudStorage } from "../lib/cloud-storage.js";
import type { FilesLocalOptInEnv } from "../lib/local-opt-in.js";
import { ApiStore } from "./api-store.js";
import { LocalStore } from "./local-store.js";
import type { FilesStore } from "./types.js";

export type { FilesStore, CreateSourceInput, CreateCollectionOptions, CreateProjectOptions } from "./types.js";
export { LocalStore } from "./local-store.js";
export { ApiStore } from "./api-store.js";

/**
 * Resolve the active {@link FilesStore} for the current environment.
 *
 * FRESH ON EVERY CALL — the credential chain is consulted per request, never
 * memoized, so a rotation heals a long-lived process without a restart.
 */
export function resolveStore(env: FilesLocalOptInEnv = process.env): FilesStore {
  const cloud = resolveFilesCloudStorage(env);
  return cloud.active ? new ApiStore(cloud.client, cloud.fetchContent) : new LocalStore();
}

/** {@link resolveStore} — same resolution, no memoization. Kept for call-site stability. */
export function store(env: FilesLocalOptInEnv = process.env): FilesStore {
  return resolveStore(env);
}