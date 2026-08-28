// Centralized path resolution for terminal global data directory.
// Migrated from ~/.terminal/ to ~/.hasna/terminal/ with backward compat.
// The data home now resolves through the @hasna/paths resolver (XDG / macOS
// home layout, honoring HASNA_*_HOME overrides), while the legacy
// ~/.hasna/terminal home stays the effective home until the terminal store
// has actually been migrated to the XDG data home or the operator sets the
// data-kind override HASNA_DATA_HOME.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { dataDir } from "@hasna/paths";

/** The primary config file — its existence at a home marks the store as physically located there. */
const CONFIG_SENTINEL_FILE = "config.json";

/** Exact-app data-home override env var names, in precedence order. */
export const HASNA_TERMINAL_DIR_ENV = "HASNA_TERMINAL_DIR";
export const TERMINAL_DIR_ENV = "TERMINAL_DIR";

/** The effective user home, mirroring the pre-existing resolution ($HOME || $USERPROFILE || os.homedir()). */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || homedir();
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
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for terminal.
 * The home is injected so the resolver follows the same home the legacy path
 * does (`$HOME`-first, matching the pre-existing resolution).
 */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "terminal", home: getHomeDir(env) || undefined, env });
}

/** The legacy (pre-XDG) data root: ~/.hasna/terminal */
export function legacyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", "terminal");
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`config.json` exists). A machine that only redirects another kind (e.g.
 * cache to tmpfs) must NOT have its data home moved, and a live store at the
 * legacy home must never become invisible on upgrade.
 */
export function adoptResolverHome(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, CONFIG_SENTINEL_FILE));
}

/** The exact-app override root, when set: `HASNA_TERMINAL_DIR` wins over the legacy `TERMINAL_DIR`. Empty values are treated as unset. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env[HASNA_TERMINAL_DIR_ENV];
  if (dir && dir.trim()) return resolve(dir.trim());
  const legacy = env[TERMINAL_DIR_ENV];
  if (legacy && legacy.trim()) return resolve(legacy.trim());
  return undefined;
}

/**
 * Get the global terminal data directory.
 * New default (once adopted): the @hasna/paths-resolved data home
 * (`~/.local/share/hasna/terminal` on Linux, `~/Library/Application
 * Support/Hasna/terminal` on macOS).
 * Legacy default: ~/.hasna/terminal/
 * Legacy migration: copy missing files from ~/.terminal/ forward if it exists
 * Env overrides: HASNA_TERMINAL_DIR, TERMINAL_DIR, and the resolver's
 * HASNA_DATA_HOME.
 */
export function getTerminalDir(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;

  const resolved = resolverHome(env);
  const effective = adoptResolverHome(resolved, env) ? resolve(resolved) : legacyHomeDir(env);

  const legacyTerminal = join(getHomeDir(env), ".terminal");
  if (existsSync(legacyTerminal)) {
    copyDirectory(legacyTerminal, effective);
  }

  if (!existsSync(effective)) {
    mkdirSync(effective, { recursive: true });
  }

  return effective;
}
