import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Environment helpers for the loops runner.
 *
 * The machine-wide client configuration the runner's spawned CLIs used to
 * inherit from `~/.hasna/cloud/*.env` is retired: every hosted Hasna CLI now
 * resolves its own credentials through the shared `@hasna/contracts` 1.0.2
 * resolver (Keychain -> disk -> env) per call, so no loader and no injected
 * env prefix is needed on a station (owner ruling 2026-09-04, hasna/apps#1720).
 */

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

/**
 * The Bun global install's dependency bin directory.
 *
 * `bun add -g <pkg>` symlinks ONLY the directly-installed package's `bin`
 * entries into `$BUN_INSTALL/bin`. The bins of everything else it resolves —
 * every transitive dependency — are materialized at
 * `$BUN_INSTALL/install/global/node_modules/.bin`, a directory bun never puts
 * on PATH.
 *
 * So a companion CLI that is installed as a *dependency* rather than as its
 * own top-level global package is "not found" (exit 127) even though it is on
 * the machine and on PATH's own terms healthy. `accounts` is the live example
 * on this fleet: it is present at
 * `~/.bun/install/global/node_modules/@hasna/accounts` and at
 * `~/.bun/install/global/node_modules/.bin/accounts`, while `~/.bun/bin`
 * contains no `accounts` link at all.
 *
 * Measured 2026-09-10 on bun 1.3.14; npm 11 behaves the same way (only the
 * top-level package's bins reach the prefix bin dir; the rest land in
 * `<pkg>/node_modules/.bin`). Neither package manager can be configured out of
 * this, and it is not fixable from a package manifest — the fix is to search
 * the directory the install actually wrote.
 */
export function bunGlobalDependencyBinDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir();
  const installRoots = [env.BUN_INSTALL, join(home, ".bun")];
  return compactPathParts(
    installRoots.map((root) => (root ? join(root, "install", "global", "node_modules", ".bin") : undefined)),
  );
}

export function commonExecutableDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir();
  return compactPathParts([
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    ...bunGlobalDependencyBinDirs(env),
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
