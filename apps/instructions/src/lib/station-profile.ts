// Station profile injector.
//
// Owner request 2026-08-24: every agent session on a station should carry a
// compact GLOBAL system-prompt block naming the station and basic facts about
// it — platform, user, workspace/home, live status where cheap, and the
// installed packages under the station's hasna-scoped npm orgs — without
// eating much context.
//
// Design constraints honoured here:
//   - STATIC/CACHED: the block is generated into a per-station cache file
//     (`station-profile.md` inside the instructions data root) by
//     `instructions station-profile refresh`, and session renders read the
//     CACHE, never live probes. Refreshing is a cadence/setup action, not a
//     per-session cost.
//   - ADDITIVE: the cache file is a brand-new file. Nothing existing in the
//     instructions data root or in rendered homes is modified, and renders
//     without a cache file are byte-identical to renders before this feature.
//   - IDEMPOTENT: regeneration with unchanged inputs produces byte-identical
//     output (no timestamps inside the block itself), so a refresh that found
//     nothing new does not churn rendered homes.
//   - SAFE EVERYWHERE: macOS + Linux; every external input (manifest JSON,
//     package directory, `machines details` probe) is best-effort and falls
//     back to local OS facts or omission, never a hard failure. No secrets:
//     the block carries station ids, paths, package names, and a coarse status
//     stamp only.
//   - PUBLISH-GUARD SAFE: this is a public @hasna package, so the published
//     artifact must not contain the private-org marker string (the repo's
//     publish guard refuses tarballs that carry it). Package scope labels in
//     the block are therefore never spelled in code: they come from the
//     actual directory names discovered in the bun global store at refresh
//     time (for example a private-org scope directory is labelled by its own
//     name). The code only filters for names containing the public "hasna"
//     token.
//
// Sources of truth, in priority order:
//   1. The machines fleet manifest (`~/.hasna/machines/machines.json`, or
//      $HASNA_MACHINES_MANIFEST_PATH) — the authoritative station record:
//      id, hostname, tailscaleName, platform, workspacePath, metadata.user.
//   2. Local OS facts (hostname, platform, arch, user, home) as fallback when
//      the manifest is absent or does not list this machine.
//   3. Installed hasna packages: a synchronous readdir of the bun global
//      module directory (`$BUN_INSTALL/install/global/node_modules`, default
//      `~/.bun/...`). `bun pm ls -g` is NOT used: on a bare bun global
//      install it fails with "could not open .../package.json" (measured
//      2026-08-24), while the directory listing is static, synchronous, and
//      dependency-free.
//   4. Live status: a best-effort `machines details --json` probe at REFRESH
//      time only (measured ~90 ms); omitted entirely when the `machines`
//      binary is unavailable or the probe fails.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch as osArch, homedir, hostname as osHostname, platform as osPlatform, userInfo as osUserInfo } from "node:os";
import { dirname, join } from "node:path";
import type { SessionInstructionSource } from "./session-render.js";
import { getRawStoreRoot } from "./raw-store-root.js";

/** Cache filename inside the instructions data root (see getRawStoreRoot). */
export const STATION_PROFILE_CACHE_FILENAME = "station-profile.md";

/** Source id injected into session renders; not a `global-*` slug on purpose. */
export const STATION_PROFILE_SOURCE_ID = "station-profile";
/** Machine layer (rank 40) — after global/tool/account, before division/workspace/repo/… */
export const STATION_PROFILE_LAYER = "machine" as const;

/** Hard context budget for the whole block (owner: <600 chars; enforced). */
export const STATION_PROFILE_MAX_BYTES = 600;
/** Longest name prefix shown before "…" for a scope (126 @hasna packages on station01). */
export const STATION_PROFILE_MAX_HASNA_NAMES = 12;
/** Non-primary scopes show their full name list only up to this many names,
 *  then degrade to a count (keeps the block inside the byte budget). */
export const STATION_PROFILE_FULL_NAMES_MAX = 6;

/** The public primary scope, always shown count + top names. */
export const STATION_PROFILE_PRIMARY_SCOPE = "@hasna";

export const MACHINES_MANIFEST_PATH_ENV = "HASNA_MACHINES_MANIFEST_PATH";
export const BUN_INSTALL_ENV = "BUN_INSTALL";

export interface StationProfileStatus {
  state: string;
  lastSeenAt: string | null;
}

export interface StationProfileMachine {
  /** Station id from the fleet manifest, or the local hostname. */
  id: string;
  hostname: string;
  tailscaleName: string | null;
  platform: string;
  arch: string;
  user: string | null;
  homeDir: string;
  workspacePath: string | null;
  status: StationProfileStatus | null;
}

export interface StationProfileScope {
  /** The scope directory name as found on disk, e.g. "@hasna". */
  scope: string;
  /** Package names under the scope (alphabetical). */
  names: string[];
}

export interface StationProfilePackages {
  /** Hasna-named scopes present in the bun global dir; primary scope first,
   *  then alphabetical. Empty when the dir exists but has no hasna scopes. */
  scopes: StationProfileScope[];
}

export interface StationProfileBuildInput {
  machine: StationProfileMachine;
  packages: StationProfilePackages | null;
}

export interface StationProfileRefreshResult {
  path: string;
  content: string;
  bytes: number;
  generatedAt: string;
  machine: StationProfileMachine;
  packages: StationProfilePackages | null;
  statusProbe: "ok" | "skipped" | "failed";
}

function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Cache file path. Lives inside the instructions data root (same env
 *  resolution as getRawStoreRoot) so tests that override HASNA_CONFIGS_HOME
 *  get full isolation. */
export function getStationProfileCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getRawStoreRoot(env), STATION_PROFILE_CACHE_FILENAME);
}

export function getMachinesManifestPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[MACHINES_MANIFEST_PATH_ENV] || join(homeDir(env), ".hasna", "machines", "machines.json");
}

export function getBunGlobalModulesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env[BUN_INSTALL_ENV] || join(homeDir(env), ".bun"), "install", "global", "node_modules");
}

/** Best-effort parse of the fleet manifest. Returns the machines array or
 *  null on any failure — a broken manifest must never break a render. */
export function readMachinesManifest(path: string): Array<Record<string, unknown>> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const machines = (parsed as Record<string, unknown>)["machines"];
    if (!Array.isArray(machines)) return null;
    return machines as Array<Record<string, unknown>>;
  } catch {
    return null;
  }
}

/** Find the manifest record for THIS machine: id, hostname, or tailscaleName
 *  matching the local hostname, in that priority order. */
export function findLocalManifestMachine(
  machines: Array<Record<string, unknown>> | null,
  hostname: string,
): Record<string, unknown> | null {
  if (!machines) return null;
  const match = (record: Record<string, unknown>): boolean =>
    record["id"] === hostname || record["hostname"] === hostname || record["tailscaleName"] === hostname;
  return machines.find(match) ?? null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metadataUser(record: Record<string, unknown> | null): string | null {
  const metadata = record?.["metadata"];
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const user = (metadata as Record<string, unknown>)["user"];
  return typeof user === "string" && user.trim() ? user : null;
}

/** Best-effort live-status probe via the machines CLI (refresh time only).
 *  Any failure returns null — the block simply omits the status line. */
export function probeMachineStatus(machineId: string): StationProfileStatus | null {
  try {
    const result = spawnSync("machines", ["details", "--json", "--machine", machineId], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0) return null;
    const parsed = JSON.parse(`${result.stdout ?? ""}`) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const status = (parsed as Record<string, unknown>)["status"];
    if (!status || typeof status !== "object" || Array.isArray(status)) return null;
    const state = stringField(status as Record<string, unknown>, "state");
    if (!state) return null;
    return { state, lastSeenAt: stringField(status as Record<string, unknown>, "last_seen_at") };
  } catch {
    return null;
  }
}

/** Resolve the machine facts for this station. Manifest first; local OS
 *  fallback; status best-effort (probe disabled by tests for determinism). */
export function resolveStationProfileMachine(
  env: NodeJS.ProcessEnv = process.env,
  options: { probe?: boolean } = {},
): StationProfileMachine {
  const hostname = osHostname();
  const record = findLocalManifestMachine(readMachinesManifest(getMachinesManifestPath(env)), hostname);
  const home = homeDir(env);
  const platform = stringField(record, "platform") ?? osPlatform();
  const workspacePath = stringField(record, "workspacePath") ?? join(home, platform === "darwin" ? "Workspace" : "workspace");
  const machine: StationProfileMachine = {
    id: stringField(record, "id") ?? hostname,
    hostname: stringField(record, "hostname") ?? hostname,
    tailscaleName: stringField(record, "tailscaleName"),
    platform,
    arch: osArch(),
    user: metadataUser(record) ?? osUserInfo().username ?? null,
    homeDir: home,
    workspacePath,
    status: null,
  };
  if (options.probe !== false) machine.status = probeMachineStatus(machine.id);
  return machine;
}

function scopedPackageNames(modulesDir: string, scope: string): string[] | null {
  const scopeDir = join(modulesDir, scope);
  try {
    if (!existsSync(scopeDir)) return null;
    return readdirNames(scopeDir).sort();
  } catch {
    return null;
  }
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir).filter((name: string) => {
    try {
      return lstatSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

/** Installed hasna packages from the bun global directory. Returns null when
 *  the directory is absent (e.g. npm-managed globals) — the block then says
 *  the listing is unavailable instead of guessing. Scope labels come from the
 *  directory names themselves, never from literals in this package (the
 *  publish guard refuses private-org marker strings in public tarballs). */
export function resolveStationProfilePackages(env: NodeJS.ProcessEnv = process.env): StationProfilePackages | null {
  const modulesDir = getBunGlobalModulesDir(env);
  let scopeDirs: string[];
  try {
    if (!existsSync(modulesDir)) return null;
    scopeDirs = readdirNames(modulesDir)
      .filter((name) => name.startsWith("@") && name.toLowerCase().includes("hasna"));
  } catch {
    return null;
  }
  const scopes = scopeDirs
    .map((scope) => ({ scope, names: scopedPackageNames(modulesDir, scope) ?? [] }))
    .filter((entry) => entry.names.length > 0)
    .sort((a, b) =>
      a.scope === STATION_PROFILE_PRIMARY_SCOPE ? -1
        : b.scope === STATION_PROFILE_PRIMARY_SCOPE ? 1
          : a.scope.localeCompare(b.scope),
    );
  return { scopes };
}

function truncateList(names: string[], max: number): string {
  if (names.length === 0) return "";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")}, …`;
}

/** Build the compact markdown block. Deterministic for identical inputs.
 *  No own heading: the session renderer already emits a `# Station profile`
 *  section heading around this content, and a second heading would waste
 *  context. */
export function buildStationProfileBlock(input: StationProfileBuildInput): string {
  const { machine, packages } = input;
  const lines: string[] = [];
  const identity = [
    `Station: ${machine.id}`,
    `hostname: ${machine.hostname}`,
  ];
  if (machine.tailscaleName && machine.tailscaleName !== machine.id) {
    identity.push(`tailscale: ${machine.tailscaleName}`);
  }
  lines.push(identity.join(" · "));
  const osParts = [`OS: ${machine.platform}/${machine.arch}`];
  if (machine.user) osParts.push(`user: ${machine.user}`);
  osParts.push(`home: ${machine.homeDir}`);
  lines.push(osParts.join(" · "));
  if (machine.workspacePath) lines.push(`Workspace: ${machine.workspacePath}`);
  if (machine.status) {
    const stamp = machine.status.lastSeenAt
      ? ` (seen ${coarseStamp(machine.status.lastSeenAt)})`
      : "";
    lines.push(`Status: ${machine.status.state}${stamp}`);
  }
  if (packages) {
    const parts = packages.scopes.map(({ scope, names }) => {
      const primary = scope === STATION_PROFILE_PRIMARY_SCOPE;
      const max = primary ? STATION_PROFILE_MAX_HASNA_NAMES : STATION_PROFILE_FULL_NAMES_MAX;
      const label = `${scope}/* ${names.length}`;
      const list = truncateList(names, max);
      return list ? `${label} (${list})` : label;
    });
    if (parts.length > 0) {
      lines.push(`Hasna packages (bun global): ${parts.join("; ")}`);
    }
  } else {
    lines.push("Hasna packages: unavailable (no bun global module directory)");
  }
  return `${lines.join("\n")}\n`;
}

function coarseStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}Z`;
}

/** Regenerate the cache file. Idempotent: writes only when the block
 *  changed. Returns the result regardless of whether a write happened. */
export function refreshStationProfile(
  options: { dryRun?: boolean; env?: NodeJS.ProcessEnv; probe?: boolean } = {},
): StationProfileRefreshResult {
  const env = options.env ?? process.env;
  const machine = resolveStationProfileMachine(env, { probe: options.probe });
  const packages = resolveStationProfilePackages(env);
  const content = buildStationProfileBlock({ machine, packages });
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > STATION_PROFILE_MAX_BYTES) {
    throw new Error(
      `Station profile block is ${bytes} bytes, over the ${STATION_PROFILE_MAX_BYTES}-byte budget. ` +
      `Reduce installed-package enumeration or widen the budget.`,
    );
  }
  const path = getStationProfileCachePath(env);
  const generatedAt = new Date().toISOString();
  if (!options.dryRun) {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (existing !== content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    }
  }
  return {
    path,
    content,
    bytes,
    generatedAt,
    machine,
    packages,
    statusProbe: machine.status ? "ok" : options.probe === false ? "skipped" : "failed",
  };
}

/** Read the cached block, if present. */
export function readStationProfile(env: NodeJS.ProcessEnv = process.env): string | null {
  const path = getStationProfileCachePath(env);
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The session-render source for the cached station profile, or null when no
 *  cache exists (renders then stay byte-identical to pre-feature output). */
export function stationProfileSource(env: NodeJS.ProcessEnv = process.env): SessionInstructionSource | null {
  const content = readStationProfile(env);
  if (content === null) return null;
  return {
    id: STATION_PROFILE_SOURCE_ID,
    label: "Station profile",
    layer: STATION_PROFILE_LAYER,
    order: 0,
    content,
    path: getStationProfileCachePath(env),
    provenance: { source: "station-profile-cache" },
  };
}
