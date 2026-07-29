// Vendored from @hasna/contracts (src/mode.ts + storage-mode enum).
//
// This app pins the hosted HTTP client locally instead of depending on an
// unpublished @hasna/contracts release, so the installed CLI can route to the
// hosted API without an extra npm dependency. Keep in sync with the upstream
// client contract if the transport wire format changes.
//
// The client store seam has exactly TWO values: `sqlite` (the on-box file) and
// `http` (the server's `/v1` API). There is no deployment-mode axis and the
// client never opens Postgres directly.

export type StorageMode = "sqlite" | "http";

export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
}

// Deployed fleets still carry the retired deployment-mode values; they keep
// selecting the backend they always selected.
const LEGACY_STORAGE_MODE_ALIASES: Record<string, StorageMode> = {
  local: "sqlite", // LEGACY-DEPLOYMENT-MODE-ALIAS
  self_hosted: "http", // LEGACY-DEPLOYMENT-MODE-ALIAS
  cloud: "http", // LEGACY-DEPLOYMENT-MODE-ALIAS
};

/**
 * Normalize a raw storage-mode string to the `sqlite | http` client seam.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim();
  if (normalized === "sqlite") return { mode: "sqlite" };
  if (normalized === "http") return { mode: "http" };
  const alias = LEGACY_STORAGE_MODE_ALIASES[normalized];
  if (alias) return { mode: alias };
  throw new Error(`Unknown storage mode: ${value}. Use sqlite or http.`);
}

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
