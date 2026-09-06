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
