/**
 * The on-disk half of a loop bundle: where it lives, how it is written
 * atomically, and how "has this tree been edited since it was pulled?" is
 * answered without asking the server.
 *
 * Canonical layout (hasna/apps#1724 §3):
 *
 *     ~/.hasna/loops/                 loops data home (paths.ts dataDir())
 *     └── loops/                      the bundle sub-layer
 *         └── <bundle-name>/
 *             ├── loop.json           definition        0600  REQUIRED
 *             ├── manifest.json       digests           0600  REQUIRED
 *             ├── scripts/            executables       0700  optional
 *             ├── README.md           notes             0600  optional
 *             └── .loops-bundle.json  pull marker (local only)
 *
 * `loops/` is a sub-layer, not the app root: an app folder is an index, not a
 * dump, and bundles never sit directly at `~/.hasna/loops/<name>/` where they
 * would collide with `bin/`, `state/`, `logs/` and `loops.db`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Loop, LoopTarget } from "../../types.js";
import { dataDir } from "../paths.js";
import { packageVersion } from "../version.js";
import {
  assertBundleName,
  BundleIntegrityError,
  computeBundleDigest,
  LOOP_BUNDLE_MANIFEST_SCHEMA,
  LOOP_BUNDLE_SCHEMA,
  LOOP_JSON_FILE,
  MANIFEST_FILE,
  MODE_DATA,
  MODE_DIR,
  PULL_MARKER_FILE,
  serializeBundleManifest,
  SCRIPTS_DIR,
  validateBundleManifest,
  type BundleManifest,
} from "./manifest.js";
import { collectBundle, manifestFilesFor, type BundleEntry } from "./pack.js";

/**
 * The bundle sub-layer root.
 *
 * Resolved through the loops path resolver (`paths.ts` -> `app-home.ts`, the
 * @hasna/paths resolver), never a hard-coded string, so the XDG data home and
 * the `LOOPS_DATA_DIR` / `HASNA_LOOPS_DATA_DIR` exact-app overrides keep
 * working. `LOOPS_BUNDLE_ROOT` is a TEST-ONLY escape hatch — it is deliberately
 * not documented as an operator switch (no new *_STORAGE_MODE-shaped env, per
 * hasna/apps#1599).
 */
export function bundleRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LOOPS_BUNDLE_ROOT?.trim();
  if (override) return override;
  return join(dataDir(), "loops");
}

export function bundleDir(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(bundleRoot(env), assertBundleName(name));
}

export function ensureBundleRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = bundleRoot(env);
  mkdirSync(root, { recursive: true, mode: MODE_DIR });
  return root;
}

/** How a local directory came to hold what it holds. */
export type BundleMarkerSource = "pull" | "push" | "materialize";

/**
 * The pull marker. The ONLY proof a directory is loops-managed: a directory
 * without one is never deleted or overwritten by any remote answer.
 */
export interface BundleMarker {
  managedBy: "@hasna/loops";
  bundle: string;
  loopId: string;
  version: number;
  pinnedVersion: number | null;
  bundleDigest: string;
  source: BundleMarkerSource;
  apiUrl?: string;
  syncedAt: string;
}

export function markerPath(dir: string): string {
  return join(dir, PULL_MARKER_FILE);
}

export function readBundleMarker(dir: string): BundleMarker | undefined {
  const file = markerPath(dir);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<BundleMarker>;
    if (parsed.managedBy !== "@hasna/loops" || typeof parsed.bundle !== "string" || typeof parsed.bundleDigest !== "string") {
      return undefined;
    }
    return {
      managedBy: "@hasna/loops",
      bundle: parsed.bundle,
      loopId: typeof parsed.loopId === "string" ? parsed.loopId : "",
      version: typeof parsed.version === "number" ? parsed.version : 0,
      pinnedVersion: typeof parsed.pinnedVersion === "number" ? parsed.pinnedVersion : null,
      bundleDigest: parsed.bundleDigest,
      source: parsed.source === "push" || parsed.source === "materialize" ? parsed.source : "pull",
      ...(typeof parsed.apiUrl === "string" ? { apiUrl: parsed.apiUrl } : {}),
      syncedAt: typeof parsed.syncedAt === "string" ? parsed.syncedAt : new Date(0).toISOString(),
    };
  } catch {
    // A corrupt marker is treated as no marker: the directory is unmanaged, so
    // nothing overwrites it. Failing open here would be the one path that
    // deletes a tree nobody can prove we own.
    return undefined;
  }
}

export function writeBundleMarker(dir: string, marker: Omit<BundleMarker, "managedBy">): void {
  writeFileSync(markerPath(dir), `${JSON.stringify({ managedBy: "@hasna/loops", ...marker }, null, 2)}\n`, { mode: MODE_DATA });
  chmodSync(markerPath(dir), MODE_DATA);
}

/** Where a bundle's local state sits relative to what it was pulled/pushed as. */
export type BundleLocalState = "absent" | "unmanaged" | "clean" | "dirty";

export interface LocalBundle {
  name: string;
  dir: string;
  state: BundleLocalState;
  marker?: BundleMarker;
  manifest?: BundleManifest;
  /** Digest recomputed from the tree right now, absent when the directory has no files. */
  digest?: string;
  /** Paths whose content or mode differs from `manifest.json`. Names only — never contents. */
  changedPaths: string[];
}

/**
 * Classify a bundle directory.
 *
 * `dirty` is decided against `manifest.json` (the file that travels with the
 * bundle), not against the marker, so a locally edited script is dirty even on
 * a station that never pulled — which is exactly the state the executor must
 * refuse to run.
 */
export function inspectLocalBundle(name: string, env: NodeJS.ProcessEnv = process.env): LocalBundle {
  const dir = bundleDir(name, env);
  if (!existsSync(dir)) return { name, dir, state: "absent", changedPaths: [] };
  const marker = readBundleMarker(dir);
  const manifestFile = join(dir, MANIFEST_FILE);
  if (!existsSync(manifestFile)) {
    return { name, dir, state: marker ? "dirty" : "unmanaged", marker, changedPaths: [MANIFEST_FILE] };
  }
  const manifest = validateBundleManifest(JSON.parse(readFileSync(manifestFile, "utf8")));
  const collected = collectBundle(dir);
  const changedPaths = diffPaths(manifest, collected.files);
  return {
    name,
    dir,
    state: changedPaths.length === 0 ? "clean" : "dirty",
    marker,
    manifest,
    digest: collected.bundleDigest,
    changedPaths,
  };
}

function diffPaths(manifest: BundleManifest, actual: ReturnType<typeof manifestFilesFor>): string[] {
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const changed: string[] = [];
  for (const file of actual) {
    const other = expected.get(file.path);
    if (!other) changed.push(file.path);
    else if (other.sha256 !== file.sha256 || other.mode !== file.mode || other.size !== file.size) changed.push(file.path);
    expected.delete(file.path);
  }
  for (const path of expected.keys()) changed.push(path);
  return changed.sort();
}

// ── loop.json ────────────────────────────────────────────────────────────────

/**
 * Runtime columns. Never written into `loop.json` and ignored when read back.
 *
 * A bundle carrying `nextRunAt` would resurrect a stale schedule on pull, which
 * is the single most likely way to make this feature dangerous: pulling a
 * three-week-old bundle would make the loop instantly due, on every station
 * that pulled it, at once.
 */
const RUNTIME_ONLY_KEYS = new Set([
  "nextRunAt",
  "retryScheduledFor",
  "archivedAt",
  "archivedFromStatus",
  "createdAt",
  "updatedAt",
  "tenantId",
  "latestRunId",
  "latestRunStatus",
  "lastRunAt",
  "execution",
  "bundleName",
  "bundlePinnedVersion",
]);

export interface LoopBundleDefinition extends Record<string, unknown> {
  schema: typeof LOOP_BUNDLE_SCHEMA;
  id: string;
  name: string;
  status: string;
  schedule: unknown;
  target: unknown;
}

/** Project a loop row into the definition file. Definition fields only. */
export function loopToDefinition(loop: Loop): LoopBundleDefinition {
  return {
    schema: LOOP_BUNDLE_SCHEMA,
    id: loop.id,
    name: loop.name,
    ...(loop.description === undefined ? {} : { description: loop.description }),
    labels: loop.labels ?? [],
    status: loop.status,
    schedule: loop.schedule,
    target: loop.target,
    goal: loop.goal ?? null,
    machine: loop.machine ?? null,
    catchUp: loop.catchUp,
    catchUpLimit: loop.catchUpLimit,
    overlap: loop.overlap,
    maxAttempts: loop.maxAttempts,
    retryDelayMs: loop.retryDelayMs,
    leaseMs: loop.leaseMs,
    expiresAt: loop.expiresAt ?? null,
    expiresAfterRuns: loop.expiresAfterRuns ?? null,
  };
}

/**
 * Parse a definition file. Unknown top-level keys are PRESERVED (a pull->push
 * round trip through an older CLI must not silently drop a field a newer server
 * wrote), while runtime keys are dropped outright.
 */
export function parseDefinition(value: unknown): LoopBundleDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE} must be a JSON object`);
  }
  const raw = value as Record<string, unknown>;
  if (raw.schema !== LOOP_BUNDLE_SCHEMA) {
    throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE}.schema must be "${LOOP_BUNDLE_SCHEMA}"`);
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE}.id must be a non-empty string`);
  if (typeof raw.name !== "string" || raw.name.length === 0) throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE}.name must be a non-empty string`);
  if (!raw.schedule || typeof raw.schedule !== "object") throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE}.schedule must be an object`);
  if (!raw.target || typeof raw.target !== "object") throw new BundleIntegrityError("LOOP_JSON_INVALID", `${LOOP_JSON_FILE}.target must be an object`);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (RUNTIME_ONLY_KEYS.has(key)) continue;
    out[key] = entry;
  }
  return out as LoopBundleDefinition;
}

/** True when the definition's target is an agent target carrying a live prompt. */
export function definitionCarriesPrompt(definition: LoopBundleDefinition): boolean {
  const target = definition.target as Partial<LoopTarget> & { prompt?: unknown; promptSource?: unknown };
  if (!target || typeof target !== "object" || target.type !== "agent") return false;
  return typeof target.prompt === "string" && target.prompt.length > 0;
}

export function serializeDefinition(definition: LoopBundleDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

// ── writing ──────────────────────────────────────────────────────────────────

export interface BuildManifestOptions {
  name: string;
  loopId: string;
  version: number;
  files: BundleManifest["files"];
  archiveSha256?: string;
  carriesPrompt?: boolean;
  reason?: string;
  station?: string;
  agent?: string;
  now?: Date;
}

export function buildManifest(opts: BuildManifestOptions): BundleManifest {
  return validateBundleManifest({
    schema: LOOP_BUNDLE_MANIFEST_SCHEMA,
    version: opts.version,
    loopId: opts.loopId,
    name: assertBundleName(opts.name),
    bundleDigest: computeBundleDigest(opts.files),
    ...(opts.archiveSha256 === undefined ? {} : { archiveSha256: opts.archiveSha256 }),
    createdAt: (opts.now ?? new Date()).toISOString(),
    files: [...opts.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    source: {
      station: opts.station ?? sourceStation(),
      agent: opts.agent ?? sourceAgent(),
      packageVersion: packageVersion(),
      ...(opts.reason === undefined ? {} : { reason: opts.reason.slice(0, 512) }),
    },
    ...(opts.carriesPrompt === undefined ? {} : { carriesPrompt: opts.carriesPrompt }),
  });
}

export function sourceStation(env: NodeJS.ProcessEnv = process.env): string {
  return (env.HASNA_STATION_ID || env.LOOPS_STATION_ID || hostname() || "unknown").slice(0, 64);
}

export function sourceAgent(env: NodeJS.ProcessEnv = process.env): string {
  return (env.LOOPS_AGENT_ID || env.TODOS_AGENT_ID || `${sourceStation(env)}-cli`).slice(0, 128);
}

/**
 * Install an entry set into `dir` atomically.
 *
 * Stage into a sibling temp directory, move the existing tree aside, rename the
 * staged tree in, then remove the backup. A crash therefore leaves EITHER the
 * old tree or the new one — never a half-written mixture, which for a directory
 * of executables would mean running a script from one version against a config
 * from another.
 */
export function installBundleTree(
  dir: string,
  entries: readonly BundleEntry[],
  manifest: BundleManifest,
  opts: { onStaged?: (staged: string) => void } = {},
): void {
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true, mode: MODE_DIR });
  const staged = mkdtempSync(join(parent, ".loops-stage-"));
  const backup = `${dir}.loops-backup-${process.pid}-${Date.now()}`;
  try {
    for (const entry of entries) {
      const target = join(staged, entry.path);
      mkdirSync(dirname(target), { recursive: true, mode: MODE_DIR });
      writeFileSync(target, entry.bytes, { mode: entry.mode });
      // writeFileSync's mode is masked by umask on creation and ignored for an
      // existing file, so the contract mode is applied explicitly.
      chmodSync(target, entry.mode);
    }
    const manifestTarget = join(staged, MANIFEST_FILE);
    writeFileSync(manifestTarget, serializeBundleManifest(manifest), { mode: MODE_DATA });
    chmodSync(manifestTarget, MODE_DATA);
    chmodSync(staged, MODE_DIR);
    opts.onStaged?.(staged);
    const hadPrevious = existsSync(dir);
    if (hadPrevious) renameSync(dir, backup);
    try {
      renameSync(staged, dir);
    } catch (error) {
      if (hadPrevious) renameSync(backup, dir);
      throw error;
    }
    if (hadPrevious) rmSync(backup, { recursive: true, force: true });
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

/** Create the skeleton `init` and `materialize` both produce. */
export function writeBundleSkeleton(
  dir: string,
  name: string,
  definition: LoopBundleDefinition,
  opts: { readme?: string; now?: Date; reason?: string } = {},
): BundleManifest {
  mkdirSync(dir, { recursive: true, mode: MODE_DIR });
  mkdirSync(join(dir, SCRIPTS_DIR), { recursive: true, mode: MODE_DIR });
  chmodSync(join(dir, SCRIPTS_DIR), MODE_DIR);
  const loopJson = join(dir, LOOP_JSON_FILE);
  writeFileSync(loopJson, serializeDefinition(definition), { mode: MODE_DATA });
  chmodSync(loopJson, MODE_DATA);
  if (opts.readme !== undefined) {
    const readme = join(dir, "README.md");
    writeFileSync(readme, opts.readme, { mode: MODE_DATA });
    chmodSync(readme, MODE_DATA);
  }
  const collected = collectBundle(dir);
  const manifest = buildManifest({
    name: assertBundleName(name),
    loopId: definition.id,
    version: 0,
    files: collected.files,
    carriesPrompt: definitionCarriesPrompt(definition),
    reason: opts.reason,
    now: opts.now,
  });
  const manifestFile = join(dir, MANIFEST_FILE);
  writeFileSync(manifestFile, serializeBundleManifest(manifest), { mode: MODE_DATA });
  chmodSync(manifestFile, MODE_DATA);
  return manifest;
}

function bundleNameFor(dir: string): string {
  return dir.split("/").filter(Boolean).pop() ?? "";
}

/** Recompute a directory's manifest in place after an edit (used by `init`/`materialize`). */
export function refreshManifest(dir: string, opts: { version?: number; reason?: string; now?: Date } = {}): BundleManifest {
  const manifestFile = join(dir, MANIFEST_FILE);
  const previous = existsSync(manifestFile)
    ? validateBundleManifest(JSON.parse(readFileSync(manifestFile, "utf8")))
    : undefined;
  const definition = parseDefinition(JSON.parse(readFileSync(join(dir, LOOP_JSON_FILE), "utf8")));
  const collected = collectBundle(dir);
  const manifest = buildManifest({
    name: previous?.name ?? bundleNameFor(dir),
    loopId: definition.id,
    version: opts.version ?? previous?.version ?? 0,
    files: collected.files,
    carriesPrompt: definitionCarriesPrompt(definition),
    reason: opts.reason,
    now: opts.now,
  });
  writeFileSync(manifestFile, serializeBundleManifest(manifest), { mode: MODE_DATA });
  chmodSync(manifestFile, MODE_DATA);
  return manifest;
}
