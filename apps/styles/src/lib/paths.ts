import { cpSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { dataDir } from "@hasna/paths";

export const LEGACY_STYLES_DIRS = [".open-styles", ".styles"] as const;

/** Env var names for the exact-app home override (XDG migration wave convention). */
export const HASNA_STYLES_HOME_ENV = "HASNA_STYLES_HOME";
export const STYLES_HOME_ENV = "STYLES_HOME";

/**
 * The effective user home, honoring a runtime `HOME` override. `os.homedir()`
 * snapshots `HOME` at process start and (under Bun) ignores later
 * reassignment, so tests that set `process.env.HOME` to a temp dir would
 * otherwise resolve the *real* home. In production `HOME` is set at startup,
 * so this resolves identically.
 */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir();
}

/** Pre-XDG default home: `~/.hasna/styles`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "styles");
}

/**
 * The @hasna/paths-resolved data home for styles (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "styles",
    home: effectiveHome(),
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the styles home.
 * Adopted only when the operator sets `HASNA_DATA_HOME` (the data-kind
 * override — a deliberate opt-in to the XDG layout) or the store has already
 * been physically migrated there (`config.json` or `styles.db` exists at the
 * resolver home). A live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "config.json")) ||
    existsSync(join(resolved, "styles.db"))
  );
}

/** The exact-app override root: `HASNA_STYLES_HOME`, then `STYLES_HOME`. */
export function exactStylesDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const key of [HASNA_STYLES_HOME_ENV, STYLES_HOME_ENV]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactStylesOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(exactStylesDir(env));
}

/**
 * The effective styles data dir: an exact-app override
 * (`HASNA_STYLES_HOME`, then `STYLES_HOME`) wins unconditionally; otherwise
 * the @hasna/paths (XDG) data home once adopted; otherwise the legacy
 * `~/.hasna/styles` default. The directory is created on first use, and the
 * pre-`.hasna` legacy dirs (`.open-styles`, `.styles`) are copy-forwarded into
 * it best-effort.
 */
export function getStylesDir(): string {
  const exact = exactStylesDir();
  let dir: string;
  if (exact) {
    dir = resolve(exact);
  } else {
    const resolved = resolverHome();
    dir = resolve(adoptResolverHome(resolved) ? resolved : legacyHomeDir());
  }
  migrateLegacyStylesDirs(effectiveHome(), dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getTrainingDir(): string {
  return join(getStylesDir(), "training");
}

export function getModelConfigPath(): string {
  return join(getStylesDir(), "config.json");
}

function migrateLegacyStylesDirs(home: string, targetDir: string): void {
  for (const legacyName of LEGACY_STYLES_DIRS) {
    const legacyDir = join(home, legacyName);
    if (!existsSync(legacyDir) || legacyDir === targetDir) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      cpSync(legacyDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    } catch {
      // Best-effort copy-forward only. Existing effective-home data wins.
    }
  }
}
