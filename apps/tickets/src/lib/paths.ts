import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/** Env var names for the exact-app home override (XDG migration wave convention). */
export const HASNA_TICKETS_HOME_ENV = "HASNA_TICKETS_HOME";
export const TICKETS_HOME_ENV = "TICKETS_HOME";

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

/** Pre-XDG default home: `~/.hasna/tickets`. */
export function legacyHomeDir(): string {
  return join(effectiveHome(), ".hasna", "tickets");
}

/**
 * The @hasna/paths-resolved data home for tickets (XDG / macOS home layout).
 * The home override mirrors the pre-existing `$HOME`-first resolution so the
 * resolver follows the same home the legacy path does.
 */
export function resolverHome(): string {
  return dataDir({
    app: "tickets",
    home: effectiveHome(),
  });
}

/**
 * Whether the resolver (XDG) home should be adopted as the tickets home.
 * Adopted only when the operator sets `HASNA_DATA_HOME` (the data-kind
 * override — a deliberate opt-in to the XDG layout) or the store has already
 * been physically migrated there (`config.json` or `tickets.db` exists at the
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
    existsSync(join(resolved, "tickets.db"))
  );
}

/** The exact-app override root: `HASNA_TICKETS_HOME`, then `TICKETS_HOME`. */
export function exactTicketsDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const key of [HASNA_TICKETS_HOME_ENV, TICKETS_HOME_ENV]) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

/** Whether an exact-app override root is set (used to skip legacy migration). */
export function hasExactTicketsOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(exactTicketsDir(env));
}

function copyDirectory(sourceDir: string, targetDir: string): void {
  try {
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir)) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      try {
        const stat = statSync(sourcePath);
        if (stat.isDirectory()) {
          copyDirectory(sourcePath, targetPath);
        } else if (stat.isFile() && !existsSync(targetPath)) {
          copyFileSync(sourcePath, targetPath);
        }
      } catch {
        // Best-effort legacy migration; unreadable entries should not block startup.
      }
    }
  } catch {
    // Best-effort legacy migration; unreadable directories should not block startup.
  }
}

/**
 * Copy-forward the pre-`.hasna` legacy `~/.tickets` store into the effective
 * tickets home (which may be the legacy `~/.hasna/tickets` default or the
 * adopted XDG data home). Best-effort only — existing effective-home data wins.
 */
function migrateLegacyTicketsDir(home: string, targetDir: string): void {
  const legacyDir = join(home, ".tickets");
  if (existsSync(legacyDir)) {
    copyDirectory(legacyDir, targetDir);
  }
}

/**
 * The effective tickets data dir: an exact-app override
 * (`HASNA_TICKETS_HOME`, then `TICKETS_HOME`) wins unconditionally; otherwise
 * the @hasna/paths (XDG) data home once adopted; otherwise the legacy
 * `~/.hasna/tickets` default. The directory is created on first use, and the
 * pre-`.hasna` legacy `.tickets` store is copy-forwarded into it best-effort.
 */
export function getTicketsDir(): string {
  const exact = exactTicketsDir();
  let dir: string;
  if (exact) {
    dir = resolve(exact);
  } else {
    const resolved = resolverHome();
    dir = resolve(adoptResolverHome(resolved) ? resolved : legacyHomeDir());
  }
  migrateLegacyTicketsDir(effectiveHome(), dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The SQLite database path inside the effective tickets data dir. */
export function getTicketsDbPath(): string {
  return join(getTicketsDir(), "tickets.db");
}

/** The training-data directory inside the effective tickets data dir. */
export function getTrainingDir(): string {
  return join(getTicketsDir(), "training");
}
