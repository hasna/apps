/**
 * Path encoding/decoding for Claude Code session storage.
 *
 * Claude Code stores sessions in ~/.claude/projects/<encoded-path>/
 * where the encoded path replaces / with - (e.g., /Users/alice/Workspace → -Users-alice-Workspace)
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { dataDir } from "@hasna/paths";

/** Encode a filesystem path to a Claude Code project directory name. */
export function encodePath(fsPath: string): string {
  return fsPath.replace(/\//g, "-");
}

/** Decode a Claude Code project directory name back to a filesystem path. */
export function decodePath(encoded: string): string {
  // The leading - represents the root /
  if (encoded.startsWith("-")) {
    return "/" + encoded.slice(1).replace(/-/g, "/");
  }
  return encoded.replace(/-/g, "/");
}

/** Get the Claude Code projects directory. */
export function getClaudeProjectsDir(): string {
  return process.env.CLAUDE_PATH
    ? join(process.env.CLAUDE_PATH, "projects")
    : join(homedir(), ".claude", "projects");
}

/** Get the Claude base directory. */
export function getClaudeBaseDir(): string {
  return process.env.CLAUDE_PATH || join(homedir(), ".claude");
}

/** Get the Codex sessions directory (date-foldered rollout JSONL files). */
export function getCodexSessionsDir(): string {
  return process.env.CODEX_PATH
    ? join(process.env.CODEX_PATH, "sessions")
    : join(homedir(), ".codex", "sessions");
}

/** The sessions app slug used by the @hasna/paths resolver. */
export const APP = "sessions" as const;

/**
 * The sessions data-root resolution — the legacy `~/.hasna/sessions` default,
 * resolved through the @hasna/paths resolver (XDG / macOS home layout).
 *
 * The legacy `~/.hasna/sessions` default stays the effective data root until
 * the XDG data home is adopted — the operator sets `HASNA_DATA_HOME` (the
 * data-kind override — a deliberate opt-in to the XDG layout), or the store
 * has already been physically migrated there (`sessions.db` exists at the
 * resolver root) — so an existing local store never becomes invisible on
 * upgrade. The pre-existing `HASNA_SESSIONS_DIR` /
 * `HASNA_SESSIONS_DB_PATH` / `SESSIONS_DB_PATH` overrides keep their
 * precedence above this default.
 *
 * Everything accepts an explicit env object (default `process.env`) so the
 * resolver is deterministic in tests and honors the same `$HOME`-first home
 * resolution the package has always used.
 */

/** The effective user home, mirroring the pre-existing resolution (`HOME` || `USERPROFILE` || os.homedir()). */
export function getHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG legacy sessions data root: ~/.hasna/sessions. */
export function getLegacySessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getHomeDir(env), ".hasna", APP);
}

/**
 * The @hasna/paths-resolved sessions data root (XDG / macOS home layout):
 * `~/.local/share/hasna/sessions` on Linux, `~/Library/Application
 * Support/Hasna/sessions` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution, and the env object is passed through so
 * `HASNA_DATA_HOME` in the caller's env is honored.
 */
export function getResolverSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env["HOME"] || env["USERPROFILE"];
  return dataDir({ app: APP, home, env });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the sessions data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (a deliberate opt-in to the XDG layout) or the store has
 * already been physically migrated there (`sessions.db` exists). A machine
 * that only redirects another kind (e.g. cache to tmpfs) must NOT have its
 * data home moved, and a live store at the legacy home must never become
 * invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "sessions.db"));
}

/**
 * The effective sessions data root: the resolver (XDG) data root once adopted
 * (`HASNA_DATA_HOME` set, or the store already migrated there); otherwise the
 * legacy `~/.hasna/sessions` default — an existing store never becomes
 * invisible on upgrade. The pre-existing `HASNA_SESSIONS_DIR` /
 * `HASNA_SESSIONS_DB_PATH` / `SESSIONS_DB_PATH` overrides sit above this
 * default in `getSessionsDir()` / `getSessionsDbPath()`.
 */
export function getEffectiveSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HASNA_SESSIONS_DIR) return env.HASNA_SESSIONS_DIR;
  const resolved = getResolverSessionsDir(env);
  return adoptResolverDataRoot(resolved, env)
    ? resolve(resolved)
    : resolve(getLegacySessionsDir(env));
}

/** Get the sessions base directory, with auto-migration from legacy path. */
export function getSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HASNA_SESSIONS_DIR) {
    const dir = env.HASNA_SESSIONS_DIR;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  const effective = getEffectiveSessionsDir(env);

  if (!existsSync(effective)) {
    mkdirSync(effective, { recursive: true });
  }
  migrateLegacySessionsDb(effective, env);

  return effective;
}

function ensureExplicitDbPath(dbPath: string): string {
  if (dbPath === ":memory:") return dbPath;
  const dir = dirname(dbPath);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dbPath;
}

/** Get the sessions database path. */
export function getSessionsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HASNA_SESSIONS_DB_PATH) return ensureExplicitDbPath(env.HASNA_SESSIONS_DB_PATH);
  if (env.SESSIONS_DB_PATH) return ensureExplicitDbPath(env.SESSIONS_DB_PATH);

  if (env.HASNA_SESSIONS_DIR) {
    const dir = getSessionsDir(env);
    return join(dir, "sessions.db");
  }

  const effective = getEffectiveSessionsDir(env);
  const newDbPath = join(effective, "sessions.db");

  migrateLegacySessionsDb(effective, env);

  return newDbPath;
}

function migrateLegacySessionsDb(effectiveDir: string, env: NodeJS.ProcessEnv): void {
  const newDbPath = join(effectiveDir, "sessions.db");
  const legacyDbPath = join(getHomeDir(env), ".sessions", "sessions.db");
  const legacyDefaultDbPath = join(getLegacySessionsDir(env), "sessions.db");

  if (!existsSync(effectiveDir)) {
    mkdirSync(effectiveDir, { recursive: true });
  }
  // The `~/.sessions` root predates `~/.hasna/sessions`: its db was copied to
  // the legacy default root once, and the original was never deleted. When the
  // legacy default root already holds a store, the `~/.sessions` file is a
  // stale already-migrated original — copying it into a fresh adopted
  // (resolver) root would fork the store from stale state and make sessions
  // recorded since the earlier migration invisible. Only migrate `~/.sessions`
  // when no newer store exists anywhere.
  if (!existsSync(newDbPath) && !existsSync(legacyDefaultDbPath) && existsSync(legacyDbPath)) {
    copyFileSync(legacyDbPath, newDbPath);
  }
}

/**
 * Find all Claude project directories that match a given filesystem path.
 * A project dir matches if it IS the encoded path or is a CHILD of it.
 */
export function findMatchingProjectDirs(
  projectDirs: string[],
  fsPath: string
): string[] {
  const encoded = encodePath(fsPath);
  return projectDirs.filter(
    (dir) => dir === encoded || dir.startsWith(encoded + "-")
  );
}

/**
 * Resolve the actual filesystem path for an encoded project directory.
 *
 * Since the encoding is lossy (both / and - become -), we can't reliably
 * decode back. Instead we look at:
 * 1. sessions-index.json projectPath field
 * 2. cwd field from the first .jsonl line
 * 3. Fall back to naive decode
 */
export function resolveProjectPath(projectsDir: string, encodedDir: string): string {
  const dirPath = join(projectsDir, encodedDir);

  // Try sessions-index.json first
  const indexPath = join(dirPath, "sessions-index.json");
  if (existsSync(indexPath)) {
    try {
      const data = JSON.parse(readFileSync(indexPath, "utf-8"));
      if (data.entries?.length > 0 && data.entries[0].projectPath) {
        return data.entries[0].projectPath;
      }
    } catch {
      // Fall through
    }
  }

  // Try reading cwd from Claude transcript files. Do not rely on the first
  // line or first file: many sessions start with command/meta records that do
  // not include cwd, and the encoded directory name is lossy for hyphenated
  // project names.
  try {
    const files = readdirSync(dirPath).filter((file) => file.endsWith(".jsonl")).sort();
    for (const file of files) {
      const cwd = findCwdInJsonl(join(dirPath, file));
      if (cwd) return cwd;
    }
  } catch {
    // Fall through
  }

  // Fall back to naive decode
  return decodePath(encodedDir);
}

function findCwdInJsonl(filePath: string): string | null {
  const maxLines = 200;
  const content = readFileSync(filePath, "utf-8");
  let checked = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    checked++;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.cwd === "string" && obj.cwd.length > 0) return obj.cwd;
    } catch {
      // Ignore malformed transcript lines.
    }
    if (checked >= maxLines) break;
  }
  return null;
}

/**
 * Compute the new encoded directory name after relocating a path.
 */
export function computeRelocatedDir(
  currentDir: string,
  oldPath: string,
  newPath: string
): string {
  const oldEncoded = encodePath(oldPath);
  const newEncoded = encodePath(newPath);

  if (currentDir === oldEncoded) {
    return newEncoded;
  }

  if (currentDir.startsWith(oldEncoded + "-")) {
    return newEncoded + currentDir.slice(oldEncoded.length);
  }

  return currentDir;
}
