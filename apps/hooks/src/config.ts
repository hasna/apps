/**
 * Runtime configuration for @hasna/hooks.
 *
 * Transport policy (fleet fail-closed doctrine, 2026-09-04): an API URL
 * selects the remote registry; without one the CLI must FAIL CLOSED instead
 * of silently serving the local store. Local mode (bundled registry + local
 * SQLite at the effective data root) is an explicit opt-in via
 * HASNA_HOOKS_LOCAL=1 / HOOKS_LOCAL=1 — never the default for a CLI run.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolveCredential } from "@hasna/contracts/client";
import { join } from "path";
import { getEffectiveDataRoot } from "./lib/app-home.js";

export function getHooksDataDir(): string {
  return getEffectiveDataRoot();
}

export function getCustomHooksDir(): string {
  return join(getHooksDataDir(), "hooks");
}

export function getLockPath(): string {
  const explicit = process.env.HASNA_HOOKS_LOCK_PATH ?? process.env.HOOKS_LOCK_PATH;
  if (explicit) return explicit;
  return join(getHooksDataDir(), "hooks.lock");
}

export function getConfigPath(): string {
  const explicit = process.env.HASNA_HOOKS_CONFIG_PATH ?? process.env.HOOKS_CONFIG_PATH;
  if (explicit) return explicit;
  return join(getHooksDataDir(), "config.json");
}

export interface HooksConfig {
  api_url?: string;
  api_key_ref?: string;
}

export function readConfig(): HooksConfig {
  try {
    const path = getConfigPath();
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8")) as HooksConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: HooksConfig): string {
  const path = getConfigPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return path;
}

/**
 * Registry API URL env keys, in precedence order. Canonical is
 * HASNA_HOOKS_API_URL; the HOOKS_* aliases and the registry-URL spellings are
 * legacy readers kept for compatibility (resolveApiUrl is their only caller).
 */
const REGISTRY_API_URL_ENV_KEYS = [
  "HASNA_HOOKS_API_URL",
  "HOOKS_API_URL",
  "HASNA_HOOKS_REGISTRY_URL",
  "HOOKS_REGISTRY_URL",
] as const;

/**
 * Resolve the configured registry API URL (env first, then config.json
 * api_url), or undefined when none is configured. First-nonblank selection —
 * a set-but-whitespace override must not suppress a valid fallback (the
 * `?.trim() ||` semantics app-home settled for the exact data-root override).
 */
export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of REGISTRY_API_URL_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return value.replace(/\/+$/, "");
  }
  const cfg = readConfig();
  return cfg.api_url ? cfg.api_url.trim().replace(/\/+$/, "") : undefined;
}

/**
 * Whether the CLI is running in api mode: a registry API URL is configured via
 * env (HASNA_HOOKS_API_URL / HOOKS_API_URL / HASNA_HOOKS_REGISTRY_URL /
 * HOOKS_REGISTRY_URL) or via the api_url field in config.json.
 *
 * `hooks init --cloudflare` writes config.json — a deliberate, explicit remote
 * selection — so it counts exactly like the env form.
 */
export function isApiModeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveApiUrl(env) !== undefined;
}

/**
 * Whether the operator has explicitly opted into LOCAL mode (bundled registry
 * + local SQLite store). Canonical opt-in: HASNA_HOOKS_LOCAL=1; the bare
 * HOOKS_LOCAL=1 alias is accepted for compatibility with the other HOOKS_*
 * readers. Local mode is never the default: a CLI run without either this
 * opt-in or an API URL fails closed.
 */
export function isLocalModeOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.HASNA_HOOKS_LOCAL ?? env.HOOKS_LOCAL;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * P1-8: the registry API key resolves through the shared client seam, never
 * by hand — its chain (deliberate override, profile, disk, then the legacy
 * HASNA_HOOKS_API_KEY / HOOKS_API_KEY env variables) is the single path that
 * receives credential-resolution fixes. A secret-valued CLI flag stays
 * removed (a flag value is visible in process listings and shell history);
 * the vault-key-NAME reference (config api_key_ref) is a name, not a value,
 * and is untouched.
 */
export function resolveApiKey(): string | undefined {
  return resolveCredential("hooks", process.env)?.apiKey;
}
