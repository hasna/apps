// Vendored from @hasna/contracts (src/mode.ts + storage-mode enum).
//
// This app pins the cloud HTTP client locally instead of depending on an
// unpublished @hasna/contracts release, so the installed CLI can route to the
// hosted API without an extra npm dependency. Keep in sync with the upstream
// client contract if the transport wire format changes.

export type StorageMode = "local" | "self_hosted" | "cloud";

export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
}

/**
 * Normalize a raw storage-mode string to the canonical deployment vocabulary.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim();
  if (normalized === "local") return { mode: "local" };
  if (normalized === "self_hosted") return { mode: "self_hosted" };
  if (normalized === "cloud") return { mode: "cloud" };
  throw new Error(`Unknown storage mode: ${value}. Use local, self_hosted, or cloud.`);
}

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
