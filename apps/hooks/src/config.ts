/**
 * Runtime configuration for @hasna/hooks.
 *
 * Presence of an API URL selects the remote registry; absence means the local
 * store is authoritative. There is deliberately no mode concept.
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

export function resolveApiUrl(): string | undefined {
  const envUrl =
    process.env.HASNA_HOOKS_API_URL ??
    process.env.HOOKS_API_URL ??
    process.env.HASNA_HOOKS_REGISTRY_URL ??
    process.env.HOOKS_REGISTRY_URL;
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const cfg = readConfig();
  return cfg.api_url ? cfg.api_url.replace(/\/+$/, "") : undefined;
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
