// Vendored minimal storage-mode helpers from @hasna/contracts (src/mode.ts +
// the StorageMode enum from src/schemas.ts), v0.5.0.
//
// WHY VENDORED: the economy CLI must ship a working self_hosted cloud client to
// every machine via `bun install -g`. The full cloud client lives at
// `@hasna/contracts/client/storage`, which is only in @hasna/contracts >=0.5.0.
// That version is NOT published to npm (blocked on npm account 2FA), so an
// installed economy that imported the subpath at runtime would fail to resolve
// it. Vendoring the (pure-TS, dependency-free) client makes the installed CLI
// self-contained while remaining a byte-faithful copy of the contracts client.
// `@hasna/contracts/auth` (server-only) stays an external dep (published in
// 0.4.x). Keep this in sync with open-contracts/src/mode.ts + schemas.ts.

/** Environment map (subset of NodeJS.ProcessEnv). */
export type Env = Record<string, string | undefined>;

/** Runtime storage enum. `local | cloud` ONLY (Amendment A1: PURE REMOTE). */
export type StorageMode = "local" | "cloud";

/** Deprecated storage-mode aliases accepted at parse time and mapped to cloud. */
export const DEPRECATED_STORAGE_MODE_ALIASES = ["remote", "hybrid", "self_hosted"] as const;

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

/** Upper-snake env token for an app name, e.g. `economy` -> `ECONOMY`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
