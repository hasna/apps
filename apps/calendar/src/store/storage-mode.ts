/**
 * The ONE place that knows the storage-mode vocabulary for @hasna/calendar.
 *
 * Canonical deployment modes (the fleet-wide vocabulary — no aliases):
 *
 *   local        this machine; on-box SQLite (`~/.hasna/calendar/calendar.db`).
 *   self_hosted  Hasna-owned infrastructure (ECS + RDS). Clients speak `/v1`.
 *   cloud        multi-tenant managed offering. Clients speak `/v1` too — the
 *                distinction from `self_hosted` is server-side tenancy only.
 *
 * WHY THIS MODULE EXISTS. `HASNA_CALENDAR_STORAGE_MODE` used to be read in two
 * places that disagreed:
 *
 *   - `src/store/http-storage.ts` accepted local | self_hosted | cloud and
 *     *silently fell back to the LocalStore* for anything else, and
 *   - `src/server/cloud.ts` keyed the hosted `/v1` plane off the string
 *     `"remote"` — a value the client resolver rejects.
 *
 * The deployed calendar-prod task set `HASNA_CALENDAR_STORAGE_MODE=remote`, so
 * the two planes of the SAME process resolved to DIFFERENT data stores: `/v1`
 * talked to RDS while everything going through `getStore()` (the whole MCP tool
 * surface) silently wrote to an ephemeral on-box SQLite file. A silent fallback
 * to a different data store is never acceptable, so an unrecognised value is now
 * a hard, loud failure and `"remote"` is REJECTED rather than aliased: mode
 * vocabulary has no backwards-compatibility guarantee, and keeping the alias
 * would preserve exactly the drift that caused the incident.
 */

/** The canonical deployment modes, in escalating-blast-radius order. */
export const CANONICAL_STORAGE_MODES = ["local", "self_hosted", "cloud"] as const;

export type StorageMode = (typeof CANONICAL_STORAGE_MODES)[number];

/**
 * Values that used to be tolerated somewhere in the fleet and now are not,
 * mapped to the canonical mode the operator almost certainly meant. Used ONLY
 * to make the error message actionable — never to silently accept the value.
 */
const RETIRED_MODE_HINTS: Readonly<Record<string, StorageMode>> = {
  remote: "self_hosted",
  hosted: "self_hosted",
  server: "self_hosted",
  saas: "cloud",
  prod: "self_hosted",
  production: "self_hosted",
  sqlite: "local",
  offline: "local",
};

/** Thrown when a storage-mode string is not one of {@link CANONICAL_STORAGE_MODES}. */
export class UnknownStorageModeError extends Error {
  static readonly code = "UNKNOWN_STORAGE_MODE";
  readonly code = UnknownStorageModeError.code;
  /** The rejected raw value (safe to log — a mode is never a credential). */
  readonly value: string;
  /** The env var (or other origin) the value came from. */
  readonly source: string;

  constructor(value: string, source: string) {
    super(unknownStorageModeMessage(value, source));
    this.name = "UnknownStorageModeError";
    this.value = value;
    this.source = source;
  }
}

/** Actionable, credential-free text for an unrecognised storage mode. */
export function unknownStorageModeMessage(value: string, source: string): string {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const hint = RETIRED_MODE_HINTS[normalized];
  const lines = [
    `${source}="${value}" is not a recognised storage mode.`,
    `Valid modes: ${CANONICAL_STORAGE_MODES.join(" | ")}.`,
  ];
  if (hint) {
    lines.push(
      `"${normalized}" is retired vocabulary and is NOT accepted as an alias — set ${source}=${hint} instead.`,
    );
  }
  lines.push(
    `Refusing to continue: falling back to a different data store would silently split reads and writes across two datasets.`,
  );
  return lines.join("\n");
}

/**
 * Parse a raw storage-mode string into its canonical form.
 * Throws {@link UnknownStorageModeError} for anything unrecognised — including
 * the retired `"remote"`.
 */
export function parseStorageMode(value: string, source = "storage mode"): StorageMode {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if ((CANONICAL_STORAGE_MODES as readonly string[]).includes(normalized)) {
    return normalized as StorageMode;
  }
  throw new UnknownStorageModeError(value, source);
}

/** True when the mode routes data to a remote `/v1` API rather than on-box SQLite. */
export function isRemoteMode(mode: StorageMode): boolean {
  return mode === "self_hosted" || mode === "cloud";
}

function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

/** The env vars consulted for an app's storage mode, in priority order. */
export function storageModeEnvKeys(name: string): readonly string[] {
  const token = envToken(name);
  return [
    `HASNA_${token}_STORAGE_MODE`,
    `HASNA_${token}_MODE`,
    `${token}_STORAGE_MODE`,
    `${token}_MODE`,
  ];
}

export interface ConfiguredStorageMode {
  mode: StorageMode;
  /** The env var the value came from. */
  source: string;
  /** The raw, pre-normalisation value. */
  raw: string;
}

/**
 * Read the configured storage mode for `name` from `env`.
 * Returns `null` when no mode env var is set (callers then infer from other
 * signals). THROWS {@link UnknownStorageModeError} when one is set to a value
 * outside {@link CANONICAL_STORAGE_MODES} — never degrades.
 */
export function resolveConfiguredStorageMode(
  name: string,
  env: Record<string, string | undefined> = process.env,
): ConfiguredStorageMode | null {
  for (const key of storageModeEnvKeys(name)) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    return { mode: parseStorageMode(raw, key), source: key, raw };
  }
  return null;
}
