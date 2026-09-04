import { readFileSync, statSync } from "node:fs";
import { runnerEnvPath } from "../lib/paths.js";

/**
 * The per-station runner configuration surface, read from a single mode-600
 * file (the loops data dir's runner.env, honoring LOOPS_DATA_DIR). The control
 * plane URL and key are credentials; the machine id and claim scope are the
 * runner's deployment identity. All four live in the file so that a package
 * update (version bump + service restart) never touches per-station config.
 *
 * The file is read, never sourced: it is plain `KEY=value` (optionally
 * `export `-prefixed and quoted), and shelling out to source it would mean
 * executing arbitrary code from disk on every runner start, for no gain.
 */
export const RUNNER_ENV_FILE_KEYS = [
  "HASNA_LOOPS_API_URL",
  "HASNA_LOOPS_API_KEY",
  "LOOPS_RUNNER_MACHINE_ID",
  "LOOPS_RUNNER_CLAIM_SCOPE",
] as const satisfies readonly string[];

export type RunnerEnvFileKey = (typeof RUNNER_ENV_FILE_KEYS)[number];

function isRunnerEnvKey(key: string): key is RunnerEnvFileKey {
  return (RUNNER_ENV_FILE_KEYS as readonly string[]).includes(key);
}

export interface RunnerEnvFileLoad {
  /** Absolute path of the env file (resolved, may not exist). */
  envFile: string;
  /** Whether the file exists and was parsed. */
  present: boolean;
  /** The loaded values for keys that were not already set in the given env. */
  loaded: Record<string, string>;
}

function parseKey(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const eq = assignment.indexOf("=");
  if (eq <= 0) return undefined;
  const key = assignment.slice(0, eq).trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : undefined;
}

function parseValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
  }
  return value;
}

/**
 * Load the runner env file. Only keys not already set (non-blank) in `env`
 * are returned, so an explicit shell value always wins over the file. Fails
 * closed: a group/other-readable file is refused (it may hold the control
 * plane API key), naming the path and the chmod remedy, never a value.
 */
export function loadRunnerEnvFile(env: NodeJS.ProcessEnv = process.env): RunnerEnvFileLoad {
  const envFile = runnerEnvPath();
  let contents: string;
  let mode: number;
  try {
    const stat = statSync(envFile);
    mode = stat.mode;
    contents = readFileSync(envFile, "utf8");
  } catch {
    return { envFile, present: false, loaded: {} };
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `loops runner env file ${envFile} is group/other-readable (mode 0${(mode & 0o777).toString(8)}); `
        + `run: chmod 600 ${envFile}`,
    );
  }
  const loaded: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const key = parseKey(line);
    if (!key || !isRunnerEnvKey(key)) continue;
    const eq = line.indexOf("=");
    const value = parseValue(line.slice(eq + 1));
    if (!value) continue;
    const alreadySet = env[key]?.trim();
    if (alreadySet) continue;
    loaded[key] = value;
  }
  return { envFile, present: true, loaded };
}

/**
 * Apply the runner env file into `env` (default: process.env), filling only
 * keys that are not already set. Returns the load result.
 */
export function applyRunnerEnvFile(env: NodeJS.ProcessEnv = process.env): RunnerEnvFileLoad {
  const result = loadRunnerEnvFile(env);
  for (const [key, value] of Object.entries(result.loaded)) {
    env[key] = value;
  }
  return result;
}
