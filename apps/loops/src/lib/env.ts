import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Machine-wide Hasna client configuration: the API endpoints and credentials
 * every `@hasna/*` CLI needs to reach its configured server instead of a stale
 * on-box SQLite file.
 *
 * Interactive shells get these from a shell rc file. Spawned ones do not: a
 * non-interactive `bash -c` reads no rc file, and `/bin/sh` (dash on Linux)
 * ignores `BASH_ENV` as well, so a child inherits only what its parent already
 * had. The loops runner is started by a launcher that sources a single file, so
 * without this loader every CLI invoked from a loop resolved to the on-box
 * store and answered with months-old data **at exit 0** — a confident wrong
 * answer, indistinguishable from a right one. See todos de1f78af.
 *
 * These files are read, never sourced. They are plain `KEY=value` (optionally
 * `export `-prefixed and quoted) and shelling out to source them would mean
 * executing arbitrary code from disk on every spawn, for no gain.
 */
function clientEnvDir(env: NodeJS.ProcessEnv): string {
  const explicit = env.HASNA_CLIENT_ENV_DIR?.trim();
  if (explicit) return explicit;
  const home = env.HOME?.trim() || homedir();
  return join(home, ".hasna", "cloud");
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
  }
  return value;
}

function parseEnvFile(contents: string, into: Record<string, string>): void {
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = assignment.indexOf("=");
    if (eq <= 0) continue;
    const key = assignment.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    into[key] = unquote(assignment.slice(eq + 1).trim());
  }
}

/**
 * Parsed contents of every `*.env` in the Hasna client config directory, applied
 * in sorted filename order so a later file wins a duplicate key (matching the
 * shell glob the rc files use).
 *
 * Never throws: a missing, unreadable or malformed file yields fewer keys, not
 * a failed run. Set `LOOPS_CLIENT_ENV=0` to disable loading entirely.
 */
export function hasnaClientEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (env.LOOPS_CLIENT_ENV?.trim() === "0") return {};
  const dir = clientEnvDir(env);
  const result: Record<string, string> = {};
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".env")).sort();
  } catch {
    return result;
  }
  for (const name of names) {
    try {
      parseEnvFile(readFileSync(join(dir, name), "utf8"), result);
    } catch {
      // An unreadable or binary file must not take the run down with it.
    }
  }
  return result;
}

function compactPathParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const value = part?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function commonExecutableDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir();
  return compactPathParts([
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, "bin"),
    env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin") : undefined,
    env.PNPM_HOME,
    env.NPM_CONFIG_PREFIX ? join(env.NPM_CONFIG_PREFIX, "bin") : undefined,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]);
}

export function normalizeExecutionPath(env: NodeJS.ProcessEnv = process.env): string {
  return compactPathParts([...(env.PATH ?? "").split(delimiter), ...commonExecutableDirs(env)]).join(delimiter);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function executableExists(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (command.includes("/")) return isExecutable(command);
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && isExecutable(join(dir, command))) return true;
  }
  return false;
}

export function commandNotFoundMessage(command: string, env: NodeJS.ProcessEnv = process.env): string {
  return `Executable not found in PATH: ${command}. Effective PATH=${env.PATH || "(empty)"}`;
}
