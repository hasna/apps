import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, cpSync } from "fs";
import { dataDir } from "@hasna/paths";

/** @hasna/paths options for this app (public OSS app slug "mcps"). */
const RESOLVER_OPTIONS = { app: "mcps" } as const;

/** Pre-XDG default home: ~/.hasna/mcps. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", "mcps");

/** The @hasna/paths-resolved data home for mcps (XDG layout). */
export function resolverHome(): string {
  return dataDir(RESOLVER_OPTIONS);
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`registry.db` exists). A
 * machine that only redirects another kind must NOT have its data home moved,
 * and a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "registry.db"));
}

/** The exact-app override root (`HASNA_MCPS_DATA_DIR` || `MCPS_DATA_DIR`), when set. Empty values are treated as unset. */
function exactAppOverride(): string | undefined {
  const override = process.env.HASNA_MCPS_DATA_DIR || process.env.MCPS_DATA_DIR;
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * Effective data home: the exact-app override wins unconditionally; otherwise
 * the resolver (XDG) home once adopted; otherwise the legacy `~/.hasna/mcps`
 * default.
 */
export function mcpsDataDir(): string {
  const override = exactAppOverride();
  if (override) return override;
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolved : LEGACY_HOME_DIR;
}

function resolveMcpsDir(): string {
  const dir = mcpsDataDir();
  const oldDir = join(homedir(), ".mcps");

  // Auto-migrate: copy old data to the effective home if needed
  if (!existsSync(dir) && existsSync(oldDir)) {
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(oldDir, dir, { recursive: true });
  }

  return dir;
}

export const MCPS_DIR = resolveMcpsDir();
export const DB_PATH = process.env.HASNA_MCPS_DB_PATH ?? process.env.MCPS_DB_PATH ?? join(MCPS_DIR, "registry.db");
export type McpsStorageMode = "local";

export function resolveStorageMode(): McpsStorageMode {
  const raw = process.env.HASNA_MCPS_STORAGE_MODE ?? process.env.MCPS_STORAGE_MODE ?? "local";
  const mode = raw.toLowerCase();
  if (mode !== "local") {
    throw new Error(
      `Unsupported MCPs storage mode "${raw}". @hasna/mcps currently supports local SQLite storage only.`,
    );
  }
  return "local";
}

export const REGISTRY_API_URL = "https://registry.modelcontextprotocol.io/v0/servers";
export const TOOL_PREFIX_SEPARATOR = "__";
