import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { getDataRoot, getDbPath } from "./paths.js";
import type { JsonObject, JsonValue } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The effective data home, resolved through `@hasna/paths` (XDG / macOS home
 * layout) with a gated legacy adoption: an exact-app `HASNA_SNAPSHOTS_DIR`
 * override wins; otherwise the resolver data home once adopted (`HASNA_DATA_HOME`
 * set, or `snapshots.sqlite` already migrated there); otherwise the legacy
 * `~/.hasna/snapshots` default. See src/paths.ts.
 */
export function defaultDataDir(): string {
  return getDataRoot();
}

/** The default sqlite store path: `HASNA_SNAPSHOTS_DB_PATH` wins; otherwise `snapshots.sqlite` under the effective data home. */
export function defaultDbPath(): string {
  return getDbPath();
}

export function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function stableJson(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    const sorted: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson(value[key]);
    }
    return sorted;
  }
  return value;
}

export function safeParseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

export function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 2_000
  });
  return result.status === 0;
}

export interface CommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export function runCommand(command: string, args: string[] = [], timeoutMs = 5_000): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message
  };
}

export function tmuxCommand(args: string[] = []): string[] {
  return ["tmux", ...tmuxArgs(args)];
}

export function tmuxArgs(args: string[] = []): string[] {
  const socketPath = process.env.HASNA_SNAPSHOTS_TMUX_SOCKET_PATH;
  if (socketPath) return ["-S", socketPath, ...args];
  const socketName = process.env.HASNA_SNAPSHOTS_TMUX_SOCKET;
  if (socketName) return ["-L", socketName, ...args];
  return args;
}

export function runTmux(args: string[] = [], timeoutMs = 5_000): CommandResult {
  return runCommand("tmux", tmuxArgs(args), timeoutMs);
}

export function runJsonCommand(command: string, args: string[] = [], timeoutMs = 5_000): JsonValue | undefined {
  const result = runCommand(command, args, timeoutMs);
  if (!result.ok) return undefined;
  return safeParseJson(result.stdout);
}

export function redactText(input: string): string {
  return input
    .replace(/([A-Za-z_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|COOKIE)[A-Za-z_]*=)[^\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(https?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi, "$1[redacted]$2");
}

export function redactJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactJson);
  }
  if (value && typeof value === "object") {
    const redacted: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      if (/token|secret|key|password|pass|cookie/i.test(key)) {
        redacted[key] = "[redacted]";
      } else {
        redacted[key] = redactJson(child);
      }
    }
    return redacted;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  return value;
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function slugPart(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || sha256(value).slice(0, 12);
}

export function fileExists(path: string | undefined): path is string {
  return Boolean(path && existsSync(path));
}

const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

/**
 * Parse a human duration ("30s", "5m", "2h", "7d", "1500ms", or a bare
 * integer meaning seconds) into milliseconds. Compound forms like "1h30m"
 * are accepted. Throws on malformed input so a misconfigured gate fails
 * loudly instead of silently disabling itself.
 */
export function parseDuration(text: string): number {
  const input = String(text).trim();
  if (!input) throw new Error(`Invalid duration: ${JSON.stringify(text)}`);
  const token = /^(\d+)(ms|s|m|h|d)?/;
  let remaining = input;
  let totalMs = 0;
  let matched = false;
  while (remaining) {
    const match = remaining.match(token);
    if (!match || match[0].length === 0) throw new Error(`Invalid duration: ${JSON.stringify(text)}`);
    totalMs += Number(match[1]) * DURATION_UNIT_MS[match[2] ?? "s"];
    remaining = remaining.slice(match[0].length);
    matched = true;
  }
  if (!matched) throw new Error(`Invalid duration: ${JSON.stringify(text)}`);
  return totalMs;
}

/** Render a millisecond duration compactly ("72h", "90m", "30s", "250ms"). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return `${ms}ms`;
  const units: Array<[string, number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1_000],
    ["ms", 1]
  ];
  for (const [suffix, size] of units) {
    if (ms >= size && ms % size === 0) return `${ms / size}${suffix}`;
  }
  return `${ms}ms`;
}

/**
 * Resolve the restore max-age limit: an explicit value wins; otherwise the
 * HASNA_SNAPSHOTS_MAX_AGE environment variable (a duration string) applies;
 * otherwise the gate is disabled. A malformed env value throws so a
 * misconfiguration fails loudly instead of silently disabling the gate.
 */
export function resolveMaxAgeMs(explicit?: number): number | undefined {
  if (explicit !== undefined) return explicit;
  const envValue = process.env.HASNA_SNAPSHOTS_MAX_AGE;
  if (envValue === undefined || envValue === "") return undefined;
  return parseDuration(envValue);
}
