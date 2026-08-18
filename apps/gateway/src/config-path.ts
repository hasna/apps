import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const GATEWAY_CONFIG_FILENAME = "gateway.config.json";
export const GATEWAY_CONFIG_PATH_ENV = "GATEWAY_CONFIG_PATH";

export interface LegacyConfigMigrationResult {
  migrated: boolean;
  from?: string;
  to?: string;
  reason: string;
}

/**
 * The canonical default config location: ~/.hasna/gateway/gateway.config.json.
 * The GATEWAY_CONFIG_PATH override and an explicit --config flag both take
 * precedence over this default.
 */
export function canonicalGatewayConfigPath(home = process.env["HOME"] || process.env["USERPROFILE"] || homedir()): string {
  return join(home, ".hasna", "gateway", GATEWAY_CONFIG_FILENAME);
}

/**
 * The legacy default: <cwd>/gateway.config.json. The one-time migration copies
 * it into the canonical location when the canonical file does not yet hold
 * data. The legacy file is never deleted and never moved — per-project configs
 * passed via an explicit --config are untouched.
 */
export function legacyCwdConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, GATEWAY_CONFIG_FILENAME);
}

/**
 * One-time safe migration of a legacy cwd-relative config into the canonical
 * ~/.hasna/gateway/ location. Idempotent and resumable:
 * - canonical file exists            -> no-op (never overwrites existing data)
 * - no legacy file at <cwd>          -> no-op
 * - dry-run                          -> reports intent, copies nothing
 * - otherwise                        -> copy + verify, legacy file left in place
 */
export function migrateLegacyConfigFile(options: { cwd?: string; home?: string; dryRun?: boolean } = {}): LegacyConfigMigrationResult {
  const to = canonicalGatewayConfigPath(options.home);
  const from = legacyCwdConfigPath(options.cwd);
  if (existsSync(to)) {
    return { migrated: false, to, reason: "canonical config already exists" };
  }
  if (!existsSync(from)) {
    return { migrated: false, from, reason: "no legacy config at <cwd>/gateway.config.json" };
  }
  if (options.dryRun) {
    return { migrated: true, from, to, reason: "dry-run: would copy legacy config to canonical location" };
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  if (!existsSync(to)) {
    return { migrated: false, from, to, reason: "copy failed: canonical config missing after copy" };
  }
  return { migrated: true, from, to, reason: "copied legacy config to canonical location; legacy file left in place" };
}

/**
 * Resolves the default config path: the GATEWAY_CONFIG_PATH override wins,
 * otherwise the canonical ~/.hasna/gateway/gateway.config.json, triggering the
 * one-time legacy migration when a <cwd>/gateway.config.json exists and the
 * canonical file does not yet hold data.
 */
export function resolveDefaultConfigPath(options: { cwd?: string; home?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const env = options.env ?? process.env;
  const override = env[GATEWAY_CONFIG_PATH_ENV];
  if (override) {
    return override;
  }
  const canonical = canonicalGatewayConfigPath(options.home);
  if (existsSync(canonical)) {
    return canonical;
  }
  const legacy = legacyCwdConfigPath(options.cwd);
  if (existsSync(legacy)) {
    migrateLegacyConfigFile({ cwd: options.cwd, home: options.home });
    return canonical;
  }
  return canonical;
}
