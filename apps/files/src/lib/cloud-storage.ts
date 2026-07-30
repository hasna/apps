// Client-side self_hosted storage resolver for @hasna/files.
//
// When the client-flip contract resolves to `cloud-http` (mode=self_hosted/cloud
// AND HASNA_FILES_API_URL + HASNA_FILES_API_KEY are set), the CLI must route its
// reads and writes to the app's cloud API at `https://files.md/v1` with the
// bearer key — NOT to the local SQLite store, and NEVER to a raw database DSN.
//
// This module is the single seam the CLI consults. It returns a ready
// `HasnaStorageClient` (from @hasna/contracts) when cloud is active, or
// `{ active: false }` so the caller falls back to the local store. It throws (via
// resolveStorageClient) when cloud is requested but misconfigured, so a client can
// never silently drift back to the wrong dataset.
//
// SAFETY: never logs or embeds the API key — it lives only inside the transport.

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import { normalizeStorageMode } from "@hasna/contracts/mode";

/** Transport overrides (test injection: fetchImpl, headers, timeout, retry). */
type StorageClientOverrides = Parameters<typeof resolveStorageClient>[2];

/** The files app slug used for the HASNA_<APP>_* env lookups. */
export const FILES_APP = "files";

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
// not, and were the two that #51 would strand. This is the `files` pin, and it
// deliberately mirrors `withImpliedSelfHostedMode` in @hasna/logs so the fleet
// converges on one shape rather than five.
//
// Pinning is also what makes this client immune to WHICH inference is live
// upstream -- env pair, URL alone, or disk credential. The mode is ours to state.

const MODE_KEYS = [
  "HASNA_FILES_STORAGE_MODE",
  "HASNA_FILES_MODE",
  "FILES_STORAGE_MODE",
  "FILES_MODE",
] as const;
const API_URL_KEYS = ["HASNA_FILES_API_URL", "FILES_API_URL"] as const;
const API_KEY_KEYS = ["HASNA_FILES_API_KEY", "FILES_API_KEY"] as const;

/** True when any of `keys` carries a non-blank value. The value is never read out. */
function anySet(source: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (source[k]?.trim() ?? "") !== "");
}

/**
 * The value that means "use the server" in the INSTALLED @hasna/contracts.
 *
 * This is derived, never hardcoded, and that is load-bearing rather than tidy.
 * The storage-mode enum has already changed once: contracts <=0.8.5 accepts
 * `cloud` plus the deprecated aliases `self_hosted`/`remote`/`hybrid`, while
 * contracts after the inference removal accepts ONLY `sqlite`/`postgres` and
 * THROWS on everything else. The two valid sets are DISJOINT, so any literal
 * pinned here is a bet on which side of that change a given machine is on, and
 * the bet loses on one side or the other.
 *
 * Measured 2026-07-30 against contracts 0.5.2: `postgres` throws, `self_hosted`
 * normalizes to `cloud`. Against contracts main (0.8.6): `postgres` normalizes,
 * `self_hosted` throws. Probing in newest-first order therefore yields the right
 * token on both generations, and on the next one too if it keeps a server token
 * in this list.
 *
 * Probing is done through the library's own `normalizeStorageMode`, so the
 * answer comes from the installed code rather than from our belief about it.
 */
export const SERVER_MODE_CANDIDATES = ["postgres", "self_hosted", "cloud"] as const;

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
  // Fail loudly rather than guess — guessing is the defect class this pin exists
  // to remove, and a wrong mode silently reads the wrong dataset.
  throw new Error(
    `No known server storage mode is accepted by the installed @hasna/contracts ` +
      `(tried ${SERVER_MODE_CANDIDATES.join(", ")}). The storage-mode enum has changed; ` +
      `add the new server token to SERVER_MODE_CANDIDATES in src/lib/cloud-storage.ts.`,
  );
}

/**
 * Return an env whose storage mode is explicit.
 *
 * An already-set mode -- through any of the four documented variables -- is left
 * exactly as it is, so an operator pinning `local` is never overridden. Only the
 * complete API url + key pair implies `self_hosted`; half a pair implies nothing,
 * because half a pair is not a statement of intent.
 */
export function filesCloudEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (anySet(source, MODE_KEYS)) return source;
  if (anySet(source, API_URL_KEYS) && anySet(source, API_KEY_KEYS)) {
    return { ...source, HASNA_FILES_STORAGE_MODE: serverStorageMode() };
  }
  return source;
}

export type FilesCloudStorage =
  | {
      /** True when reads/writes must go to the cloud HTTP API. */
      readonly active: true;
      /** The ready HTTP storage client. */
      readonly client: HasnaStorageClient;
    }
  | {
      readonly active: false;
      readonly client: null;
    };

/**
 * Resolve the files client storage transport for the current environment.
 *
 * Returns `{ active: true, client }` only when mode=self_hosted/cloud AND
 * HASNA_FILES_API_URL + HASNA_FILES_API_KEY are set. Otherwise `{ active: false }`
 * (local store). Throws if cloud was requested but is misconfigured.
 *
 * Callers do not use this directly — {@link resolveStore} consults it and picks
 * the {@link ApiStore} or {@link LocalStore} transport. It is the one place the
 * client decides local vs cloud.
 */
export function resolveFilesCloudStorage(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: StorageClientOverrides,
): FilesCloudStorage {
  const resolved = resolveStorageClient(FILES_APP, filesCloudEnv(env), overrides);
  return resolved.transport === "cloud-http"
    ? { active: true, client: resolved.client }
    : { active: false, client: null };
}
