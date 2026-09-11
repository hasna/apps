/**
 * Store configuration — the §6 surface, and the two-clock invariant that
 * §15.11.1 / §15.11.2 resolve.
 *
 * `storage`  a size cap for the whole store.
 * `retention`the LOCAL spool clock (a disk-space policy) plus the quota and
 *            the safety floors. Dry-run is the default and `--apply` is
 *            required, both reusing the fleet's secure-local-store defaults
 *            (`apps/contracts/src/secure-local-store.ts:46,51`).
 * `capture`  what we refuse to capture, and therefore (§11.7) what we refuse
 *            to delete.
 * `cloud`    the CLOUD clock. §15.11.1/11.2: cloud retention is a separate,
 *            *longer* lifecycle rule (`Expiration.Days` on the `trash/`
 *            prefix, 90 days), never `noncurrent-90d` — that rule expires
 *            noncurrent *versions* and would leave the current object forever.
 *
 * **Correction adopted (§15 wins over §6).** §6 said "keep the local clock ≥
 * cloud". That is backwards for the safety property it was reaching for: local
 * payloads may only be evicted once a remote copy is re-verified, so the cloud
 * window must OUTLIVE the local one (`cloud.retentionDays >=
 * retention.retentionDays`). A shorter cloud window would let the last copy
 * evaporate on both sides. Validation enforces the corrected direction.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeFileAtomic } from "./fsx.js";
import { parseExpiry } from "./expiry.js";

export interface TrashStorageConfig {
  /** Hard cap for the whole store, bytes. */
  maxSizeBytes: number;
}

export interface TrashRetentionConfig {
  /** Total bytes the local spool may hold before eviction runs. */
  maxTotalBytes: number;
  /** Entry-count cap before eviction runs. */
  maxEntries: number;
  /** The LOCAL clock, days. `null` = never expire locally. */
  retentionDays: number | null;
  /**
   * Hard floor on un-uploaded entries. A sweep may NEVER take the count of
   * un-uploaded entries below this (§6: "Never evict the newest un-uploaded"
   * is satisfiable to zero, hence a count floor, not a heuristic).
   */
  minUnuploadedKeep: number;
  /** Dry-run by default; a sweep reports what it would do. */
  dryRun: boolean;
  /** An apply pass must say so explicitly — dry run is not an opt-out. */
  requireExplicitApply: boolean;
  /**
   * Maximum age (ms) of a *stored* remote confirmation the sweeper treats as
   * current. A live re-verification is required before any local payload is
   * removed in every case; this bounds how much of the historical record is
   * trusted, never whether verification happens.
   */
  remoteVerificationHorizonMs: number;
}

export interface TrashCaptureConfig {
  /** Refuse to capture anything larger; the delete is refused too (§11.7). */
  maxEntryBytes: number;
  /** Refuse to capture when the spool filesystem has less than this free. */
  minFreeBytes: number;
  /**
   * Loose files are captured with `link(2)` when this is true (identity
   * preserved, `EEXIST` as dedupe); never a copy. Directories always use
   * `rename(2)` — `link(2)` returns EPERM for a directory (§15 correction 1).
   */
  linkWhenSameDevice: boolean;
  /** `record`: journal every refusal (§11.7). */
  onRefuse: "record";
  /** The not-precious class — see glob.ts for why this list is load-bearing. */
  excludeGlobs: string[];
}

export interface TrashCloudConfig {
  /** The CLOUD clock, days — a separate, longer server-side lifecycle rule. */
  retentionDays: number | null;
}

export interface TrashConfig {
  version: 1;
  storage: TrashStorageConfig;
  retention: TrashRetentionConfig;
  capture: TrashCaptureConfig;
  cloud: TrashCloudConfig;
}

export const DEFAULT_TRASH_CONFIG: TrashConfig = {
  version: 1,
  storage: { maxSizeBytes: 10_737_418_240 },
  retention: {
    maxTotalBytes: 21_474_836_480,
    maxEntries: 100_000,
    retentionDays: 30,
    minUnuploadedKeep: 100,
    dryRun: true,
    requireExplicitApply: true,
    remoteVerificationHorizonMs: 86_400_000,
  },
  capture: {
    maxEntryBytes: 2_147_483_648,
    minFreeBytes: 2_147_483_648,
    linkWhenSameDevice: true,
    onRefuse: "record",
    excludeGlobs: [
      "**/node_modules/**",
      "**/.git/objects/**",
      "**/target/**",
      "**/dist/**",
      "**/.venv/**",
      "**/__pycache__/**",
    ],
  },
  cloud: { retentionDays: 90 },
};

/** A section-wise patch: any subset of any section, never a partial section. */
export interface TrashConfigPatch {
  storage?: Partial<TrashStorageConfig>;
  retention?: Partial<TrashRetentionConfig>;
  capture?: Partial<TrashCaptureConfig>;
  cloud?: Partial<TrashCloudConfig>;
}

/**
 * Section-wise merge over the defaults.
 *
 * A shallow merge would be a trap: a caller overriding ONE capture field
 * (`{capture: {maxEntryBytes: 16}}`) would silently drop `excludeGlobs` and
 * with it the §11.7 boundary between "refuse the delete" and "the delete
 * proceeds". Every section merges over its own defaults, so a partial patch
 * can never erase a sibling field — and `version` is never taken from a patch.
 */
export function mergeTrashConfig(patch?: TrashConfigPatch | null): TrashConfig {
  const base = structuredClone(DEFAULT_TRASH_CONFIG);
  if (!patch) return base;
  return {
    version: base.version,
    storage: { ...base.storage, ...(patch.storage ?? {}) },
    retention: { ...base.retention, ...(patch.retention ?? {}) },
    capture: { ...base.capture, ...(patch.capture ?? {}) },
    cloud: { ...base.cloud, ...(patch.cloud ?? {}) },
  };
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`trash config: ${label} must be a non-negative finite number`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const n = finiteNonNegative(value, label);
  if (!Number.isInteger(n)) throw new Error(`trash config: ${label} must be an integer`);
  return n;
}

/**
 * Validate a config document, throwing on anything that would make a retention
 * decision unsafe. Called on load (fail closed), on save, and by
 * `trash config set` before the file is written.
 */
export function validateTrashConfig(config: TrashConfig): TrashConfig {
  if (!config || typeof config !== "object") throw new Error("trash config: not an object");
  if (config.version !== 1) throw new Error(`trash config: unsupported version ${String(config.version)}`);

  finiteNonNegative(config.storage?.maxSizeBytes, "storage.maxSizeBytes");

  const retention = config.retention;
  finiteNonNegative(retention?.maxTotalBytes, "retention.maxTotalBytes");
  nonNegativeInteger(retention?.maxEntries, "retention.maxEntries");
  if (retention?.retentionDays !== null) {
    finiteNonNegative(retention?.retentionDays, "retention.retentionDays");
  }
  nonNegativeInteger(retention?.minUnuploadedKeep, "retention.minUnuploadedKeep");
  if (typeof retention?.dryRun !== "boolean") throw new Error("trash config: retention.dryRun must be a boolean");
  if (typeof retention?.requireExplicitApply !== "boolean") {
    throw new Error("trash config: retention.requireExplicitApply must be a boolean");
  }
  finiteNonNegative(retention?.remoteVerificationHorizonMs, "retention.remoteVerificationHorizonMs");

  const capture = config.capture;
  finiteNonNegative(capture?.maxEntryBytes, "capture.maxEntryBytes");
  finiteNonNegative(capture?.minFreeBytes, "capture.minFreeBytes");
  if (typeof capture?.linkWhenSameDevice !== "boolean") {
    throw new Error("trash config: capture.linkWhenSameDevice must be a boolean");
  }
  if (capture?.onRefuse !== "record") {
    throw new Error('trash config: capture.onRefuse must be "record" (refusals are always journaled)');
  }
  if (!Array.isArray(capture?.excludeGlobs) || capture.excludeGlobs.some((g) => typeof g !== "string" || g.trim() === "")) {
    throw new Error("trash config: capture.excludeGlobs must be a non-empty string array");
  }

  const cloud = config.cloud;
  if (cloud?.retentionDays !== null) {
    finiteNonNegative(cloud?.retentionDays, "cloud.retentionDays");
  }

  // The corrected two-clock invariant: the remote copy must outlive the local
  // one, or a local eviction can be the last copy (§15.11.1, §15.11.2).
  if (
    typeof retention.retentionDays === "number" &&
    typeof cloud?.retentionDays === "number" &&
    cloud.retentionDays < retention.retentionDays
  ) {
    throw new Error(
      "trash config: cloud.retentionDays must be >= retention.retentionDays — " +
        "the cloud window must outlive the local window, or expiring the local payload destroys the last copy",
    );
  }

  return config;
}

export function loadTrashConfig(configPath: string): TrashConfig {
  if (!existsSync(configPath)) return structuredClone(DEFAULT_TRASH_CONFIG);
  const raw = readFileSync(configPath, "utf8");
  let parsed: TrashConfig;
  try {
    parsed = JSON.parse(raw) as TrashConfig;
  } catch (error) {
    throw new Error(`trash config: ${configPath} is not valid JSON (${(error as Error).message})`);
  }
  return validateTrashConfig(mergeTrashConfig(parsed));
}

/** Writers create the parent directory (mode 0700) and replace atomically. */
export function saveTrashConfig(configPath: string, config: TrashConfig): void {
  validateTrashConfig(config);
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

/**
 * The `trash config set|unset` allowlist — dotted paths, like the fleet's
 * `domains config show|set|unset` precedent. Unknown keys are refused rather
 * than silently stored.
 */
export const CONFIG_KEYS: readonly string[] = [
  "storage.maxSizeBytes",
  "retention.maxTotalBytes",
  "retention.maxEntries",
  "retention.retentionDays",
  "retention.minUnuploadedKeep",
  "retention.dryRun",
  "retention.requireExplicitApply",
  "retention.remoteVerificationHorizonMs",
  "capture.maxEntryBytes",
  "capture.minFreeBytes",
  "capture.linkWhenSameDevice",
  "capture.excludeGlobs",
  "cloud.retentionDays",
];

function getPath(config: TrashConfig, key: string): unknown {
  const [group, field] = key.split(".");
  const section = (config as unknown as Record<string, Record<string, unknown>>)[group!];
  return section?.[field!];
}

function parseValue(key: string, raw: string): unknown {
  const value = raw.trim();
  if (key === "capture.excludeGlobs") {
    if (value === "" || value === "[]") return [];
    const parts = value.startsWith("[") ? (JSON.parse(value) as unknown) : value.split(",");
    if (!Array.isArray(parts)) throw new Error(`${key} expects a JSON array or a comma-separated list`);
    return parts.map((p) => String(p).trim()).filter((p) => p.length > 0);
  }
  if (value === "never") {
    if (key === "retention.retentionDays" || key === "cloud.retentionDays") return null;
    throw new Error(`"never" is only meaningful for retention.retentionDays and cloud.retentionDays`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  // A TTL suffix is meaningful only for the two clocks. `parseExpiry` requires
  // the unit, so a bare number still falls through to the integer branch below.
  const isClock = key === "retention.retentionDays" || key === "cloud.retentionDays";
  if (isClock && /^\d+[mhd]$/.test(value)) {
    const ms = parseExpiry(value);
    if (ms === null) throw new Error(`invalid TTL "${raw}" — use 30d, 24h, 45m or never`);
    return ms / 86_400_000;
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value);
  throw new Error(`cannot parse value "${raw}" for ${key}`);
}

/** Apply one `config set`; returns the validated next config. */
export function setConfigValue(config: TrashConfig, key: string, raw: string): TrashConfig {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`unknown config key "${key}" — known keys: ${CONFIG_KEYS.join(", ")}`);
  }
  const next = structuredClone(config);
  const [group, field] = key.split(".");
  const section = (next as unknown as Record<string, Record<string, unknown>>)[group!]!;
  section[field!] = parseValue(key, raw);
  return validateTrashConfig(next);
}

/** Reset one key to its default (`config unset`). */
export function unsetConfigValue(config: TrashConfig, key: string): TrashConfig {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`unknown config key "${key}" — known keys: ${CONFIG_KEYS.join(", ")}`);
  }
  return setConfigValue(config, key, JSON.stringify(getPath(DEFAULT_TRASH_CONFIG, key)));
}
