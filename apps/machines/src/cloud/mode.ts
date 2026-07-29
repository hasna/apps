// Vendored from @hasna/contracts (src/mode.ts + storage-mode enum).
//
// This app pins the cloud HTTP client locally instead of depending on an
// unpublished @hasna/contracts release, so the installed CLI can route to the
// hosted API without an extra npm dependency. Keep in sync with the upstream
// client contract if the transport wire format changes.
//
// Deployment modes were removed (owner directive 2026-07-29). There are
// exactly two client backends — the local store and the hosted HTTP API — and
// the retired words (`self_hosted`, `remote`, `hybrid`) are rejected loudly
// rather than remapped: silent remapping is how the vocabulary survived every
// previous removal, and a remap here flips which store a process reads.

export type StorageMode = "local" | "cloud";

export type Env = Record<string, string | undefined>;

export interface StorageModeNormalization {
  mode: StorageMode;
}

/**
 * Normalize a raw storage-mode string to the `local | cloud` enum. Throws on
 * any other value — including the retired deployment-mode words — naming the
 * fix, so a stale env var fails loudly instead of silently picking a backend.
 */
export function normalizeStorageMode(value: string): StorageModeNormalization {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local") return { mode: "local" };
  if (normalized === "cloud") return { mode: "cloud" };
  throw new Error(
    `Unknown storage mode: ${value}. Deployment modes were removed; use local (on-box store) or cloud (hosted HTTP API).`,
  );
}

/** Upper-snake env token for an app name, e.g. `todos` -> `TODOS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
