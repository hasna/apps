// Client-side hosted-storage resolver for @hasna/files.
//
// The client has exactly two transports, and the selection is NOT this module's
// to make: hosted (the files service at `<origin>/v1`) is resolved through the
// ONE @hasna/contracts credential chain, resolved fresh on every call; the
// on-box SQLite store exists ONLY under the deliberate unhosted opt-in
// `HASNA_FILES_LOCAL=1` (alias `FILES_LOCAL=1`), answered BEFORE the resolver
// runs so an unhosted run reads neither the Keychain nor the credential file.
//
//   - hosted: the @hasna/contracts chain supplies the API key — an explicit
//     argument, `HASNA_FILES_API_KEY_OVERRIDE` / `HASNA_PROFILE` /
//     `HASNA_FILES_API_KEY_REF`, the macOS Keychain item
//     `hasna.credentials.files.api-key`, `~/.hasna/files/config/credentials`
//     (owner-only 0400/0600), or `HASNA_FILES_API_KEY` — and the authority
//     follows `HASNA_FILES_API_URL`, the Keychain `api-url` item, the
//     credentials file, and otherwise DEFAULTS to the fleet gateway
//     `https://api.hasna.com/files` (the client appends `/v1`). The unprefixed
//     `FILES_API_URL` / `FILES_API_KEY` names survive only as the resolver's
//     silent alias; the canonical `HASNA_FILES_*` names always win.
//   - local (explicit opt-in only): the on-box SQLite store, reachable ONLY
//     when the operator sets `HASNA_FILES_LOCAL=1`. Every local run prints one
//     "LOCAL mode" line on stderr.
//
// Retired inputs are inputs nowhere: nothing reads `~/.hasna/fleet-env`,
// `~/.hasna/cloud`, `~/.config/hasna` or `$XDG_CONFIG_HOME`, there is no
// `~/.files/config.json` key store, and no `*_MODE` / `*_STORAGE_MODE` variable
// selects a transport. The 0.14.x-era DEPRECATED stderr notices are gone with
// them (they were the resolver's own, dropped in @hasna/contracts 1.0.2).
//
// A hosted run with no credential THROWS (fail-closed): non-zero exit, no
// SQLite, no `*-local-fallback` event. A half-configured pair (URL without key,
// or key without URL with no fleet gateway) is a misconfiguration and throws —
// the client never silently falls back to a different dataset.
//
// This module is the single seam the CLI and the MCP server consult. It returns
// a ready `HasnaStorageClient` (from @hasna/contracts) when the hosted
// transport is active, or `{ active: false }` so the caller uses the local
// store the operator explicitly opted into.
//
// SAFETY: never logs or embeds the API key — it lives only inside the
// transport and the closed-over fetch.

import { completePointerCredential, resolveCredential } from "@hasna/contracts/client";
import type { ResolvedCredential } from "@hasna/contracts/client";
import { resolveStorageClient } from "@hasna/contracts/client/storage";
import type { FilesStorageClient, FilesStorageOverrides } from "../store/client-types.js";
import type { FilesLocalOptInEnv } from "./local-opt-in.js";
import { filesResolverInputs, selectsFilesLocalStore } from "./local-opt-in.js";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). Spelled locally. */
export type StorageClientOverrides = FilesStorageOverrides;
export type AuthenticatedFilesFetch = (path: string, init?: RequestInit) => Promise<Response>;

/** The files app slug used for the resolver's HASNA_<APP>_* env lookups. */
export const FILES_APP = "files";

export type FilesCloudStorage =
  | {
      /** True when reads/writes must go to the hosted HTTP API. */
      readonly active: true;
      /** The ready HTTP storage client. */
      readonly client: FilesStorageClient;
      /**
       * Authenticated raw-response fetch for private file bytes. The key stays
       * captured inside this function and is never returned or logged. A vault
       * pointer is completed per request; the resolved key re-resolves nothing
       * (it is a snapshot of THIS resolution), matching the store client's own
       * freshness contract.
       */
      readonly fetchContent: AuthenticatedFilesFetch;
    }
  | {
      readonly active: false;
      readonly client: null;
      readonly fetchContent: null;
    };

/**
 * Re-throw a `@hasna/contracts` resolution failure as the files CLI's own
 * fail-closed diagnostic, preserving the resolver's message (which names every
 * tier it consulted) behind a stable `REMOTE_API_*` code callers match on.
 * Nothing here ever returns a client or a local store: every arm throws.
 */
export function rethrowFilesAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    throw new Error(
      `REMOTE_API_CREDENTIAL_INVALID: ${message} There is no local fallback: ` +
        "local SQLite is opt-in only (HASNA_FILES_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  throw new Error(
    `REMOTE_API_CONFIG_MISSING: ${message} There is no local fallback: local SQLite is opt-in only ` +
      "(HASNA_FILES_LOCAL=1) and is disabled by default — failing closed",
    { cause: error },
  );
}

/** One line every local run prints, so an unhosted run is never mistaken for an empty hosted one. */
export function filesLocalModeNotice(): string {
  return (
    "files: LOCAL mode — using the on-box SQLite store, not the hosted fleet (HASNA_FILES_LOCAL is set). " +
    "Unset it and provide a credential via the Keychain item hasna.credentials.files.api-key, " +
    "~/.hasna/files/config/credentials, or HASNA_FILES_API_KEY, to work against https://api.hasna.com/files."
  );
}

/**
 * Print {@link filesLocalModeNotice} once per process. A no-op for every
 * hosted run, so a hosted run's stderr stays empty.
 */
export function announceFilesLocalMode(
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): void {
  if (filesLocalModeAnnounced) return;
  filesLocalModeAnnounced = true;
  write(filesLocalModeNotice());
}
let filesLocalModeAnnounced = false;

/**
 * Resolve the files client storage transport for the current environment —
 * FRESH on every call, never cached: a long-lived process (an MCP server, an
 * agent loop) picks up a key rotation without being rebuilt.
 *
 * Local (on-box SQLite) ONLY when the explicit opt-in HASNA_FILES_LOCAL (alias
 * FILES_LOCAL) is set and the environment configures no authority and no
 * credential — answered WITHOUT calling the resolver, so an unhosted run reads
 * neither the Keychain nor the credential file. Otherwise @hasna/contracts
 * resolves the credential and the authority, and ANY failure to resolve is a
 * throw (fail closed): no silent `~/.hasna/files/files.db` session, no
 * `*-local-fallback` event. The client never silently reads a different
 * dataset than the one it decided on.
 */
export function resolveFilesCloudStorage(
  env: FilesLocalOptInEnv = process.env,
  overrides?: StorageClientOverrides,
): FilesCloudStorage {
  if (selectsFilesLocalStore(env)) {
    return { active: false, client: null, fetchContent: null };
  }
  const resolverInputs = filesResolverInputs(env, overrides?.credentials ?? {});
  let resolved: { transport: "http"; client: FilesStorageClient };
  let credential: ResolvedCredential | null;
  try {
    const storage = resolveStorageClient(FILES_APP, resolverInputs.env, {
      ...overrides,
      credentials: resolverInputs.credentials,
    } as Parameters<typeof resolveStorageClient>[2]);
    resolved = storage;
    credential = resolveCredential(FILES_APP, resolverInputs.env, resolverInputs.credentials);
  } catch (error) {
    rethrowFilesAuthorityFailure(error);
  }
  if (resolved.transport !== "http") {
    throw new Error(
      "REMOTE_API_CONFIG_MISSING: the shared files client resolved to a non-HTTP transport; refusing to " +
        "silently use a different dataset",
    );
  }
  if (!credential) {
    throw new Error(
      "REMOTE_API_CONFIG_MISSING: the shared files client resolved an authority but no API key; refusing " +
        "to build an unauthenticated client",
    );
  }
  // A vault pointer has no key value at resolution time — it is completed per
  // request, exactly as the shared transport does it, so a rotated vault item
  // is picked up without a restart.
  const pointerCredentials = credential.tier === "pointer"
    ? { pointer: credential, env: resolverInputs.env }
    : null;
  const apiKey = credential.tier === "pointer" ? undefined : credential.apiKey;

  const fetchImpl = overrides?.fetchImpl ?? globalThis.fetch;
  const inheritedHeaders = overrides?.headers ?? {};
  const fetchContent: AuthenticatedFilesFetch = async (path, init = {}) => {
    let key = apiKey;
    if (pointerCredentials) {
      const completed = await completePointerCredential(
        FILES_APP,
        pointerCredentials.pointer,
        pointerCredentials.env,
      );
      key = completed.apiKey;
    }
    if (!key) {
      throw new Error(
        "files: authenticated content fetch resolved without an API key; refusing to send an unauthenticated request",
      );
    }
    const headers = new Headers(inheritedHeaders);
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
    headers.set("x-api-key", key);
    headers.set("authorization", `Bearer ${key}`);
    return fetchImpl(`${resolved.client.baseUrl}${path}`, { ...init, headers });
  };

  return { active: true, client: resolved.client, fetchContent };
}