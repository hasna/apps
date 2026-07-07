// Vendored from @hasna/contracts (src/mode.ts + storage-mode enum).
//
// This app pins the cloud HTTP client locally instead of depending on an
// unpublished @hasna/contracts release, so the installed CLI can route to the
// hosted API without an extra npm dependency. Keep in sync with the upstream
// client contract if the transport wire format changes.

export type StorageMode = "local" | "cloud";

/** Deprecated mode aliases that all normalize to `cloud`. */
export const DEPRECATED_STORAGE_MODE_ALIASES = ["remote", "hybrid", "self_hosted"] as const;

export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
  /** The deprecated alias that was normalized to `cloud`, if any. */
  deprecatedAlias: string | null;
}

/**
 * Normalize a raw storage-mode string to the `local | cloud` runtime enum.
 * Accepts deprecated aliases (`remote`, `hybrid`, `self_hosted`) and maps them
 * to `cloud`. Throws on any other value.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud") return { mode: "cloud", deprecatedAlias: null };
  if ((DEPRECATED_STORAGE_MODE_ALIASES as readonly string[]).includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
