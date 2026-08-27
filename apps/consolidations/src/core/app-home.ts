import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cacheDir, configDir, dataDir, stateDir } from "@hasna/paths";

// App slug, kept local (not imported from config.js) so app-home never creates
// a circular import: config.ts resolves the default DB path through app-home.
const APP = "consolidations" as const;

/**
 * Resolves the consolidations home directories via the @hasna/paths resolver
 * (XDG / macOS home layout), enforcing 0700 permissions so that SQLite data,
 * exports, and pre-migration backups are never world-readable.
 *
 * Subdir mapping once the XDG home is adopted:
 *   config   -> config home          (~/.config/hasna/consolidations)
 *   data     -> data home            (~/.local/share/hasna/consolidations) — holds consolidations.db
 *   exports  -> data home/exports
 *   backups  -> data home/backups
 *   logs     -> state home/logs      (~/.local/state/hasna/consolidations/logs)
 *   tmp      -> cache home/tmp       (~/.cache/hasna/consolidations/tmp)
 *
 * Until the XDG home is adopted (or an exact-app override is set), the legacy
 * `~/.hasna/consolidations` default stays the effective home and subdirs stay
 * under it, so an existing store and layout never become invisible on upgrade.
 */
export const APP_HOME_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;

const OPTIONS = { app: APP } as const;

/** Pre-XDG default home: ~/.hasna/consolidations. */
export const LEGACY_HOME_DIR = join(homedir(), ".hasna", APP);

/** The @hasna/paths-resolved data home for consolidations (XDG layout). */
export function resolverHome(): string {
  return dataDir(OPTIONS);
}

/**
 * Whether the resolver (XDG) home should be adopted as the store home. The
 * resolver home is adopted only when the operator has set `HASNA_DATA_HOME`
 * (the data-kind override — a deliberate opt-in to the XDG layout) or the
 * store has already been physically migrated there (`consolidations.db`
 * exists). A machine that only redirects another kind (e.g. cache to tmpfs)
 * must NOT have its data home moved, and a live store at the legacy home must
 * never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "consolidations.db"));
}

/** The exact-app override root (HASNA_CONSOLIDATIONS_HOME ?? CONSOLIDATIONS_HOME), when set. */
function exactAppOverride(): string | undefined {
  const override = process.env["HASNA_CONSOLIDATIONS_HOME"] ?? process.env["CONSOLIDATIONS_HOME"];
  return override && override.trim() ? override.trim() : undefined;
}

/**
 * Absolute path to the effective app home. The exact-app override
 * (`HASNA_CONSOLIDATIONS_HOME` / `CONSOLIDATIONS_HOME`) wins unconditionally;
 * otherwise the resolver (XDG) data home once adopted (`HASNA_DATA_HOME` set,
 * or the store already migrated there); otherwise the legacy
 * `~/.hasna/consolidations` default — an existing store never becomes
 * invisible on upgrade.
 */
export function appHome(): string {
  const override = exactAppOverride();
  if (override) return resolve(override);
  const resolved = resolverHome();
  return adoptResolverHome(resolved) ? resolve(resolved) : resolve(LEGACY_HOME_DIR);
}

/** Absolute path to a sub-directory under the effective app home. */
export function appHomeDir(sub: (typeof APP_HOME_SUBDIRS)[number]): string {
  // An exact-app override, or the pre-adoption default, keeps the legacy
  // subdir layout under the effective home.
  if (exactAppOverride() || !adoptResolverHome(resolverHome())) {
    return join(appHome(), sub);
  }
  switch (sub) {
    case "config":
      return configDir(OPTIONS);
    case "data":
      return dataDir(OPTIONS);
    case "exports":
      return join(dataDir(OPTIONS), "exports");
    case "backups":
      return join(dataDir(OPTIONS), "backups");
    case "logs":
      return join(stateDir(OPTIONS), "logs");
    case "tmp":
      return join(cacheDir(OPTIONS), "tmp");
  }
}

/** The live store path — at the root of the effective home, matching the pre-migration layout. */
export function getDefaultDbPath(): string {
  return join(appHome(), `${APP}.db`);
}

/** Ensure the app-home tree exists with directory mode 0700. Best-effort, idempotent. */
export function ensureAppHome(): string {
  const base = appHome();
  mkdirSync(base, { recursive: true, mode: 0o700 });
  for (const sub of APP_HOME_SUBDIRS) {
    const dir = appHomeDir(sub);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best-effort on platforms without POSIX perms
    }
  }
  return base;
}
