/**
 * Persistent config stored in the domains config directory.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getDefaultConfigPath, resolverHome } from "./app-home.js";

export interface DomainContact {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address_line_1?: string;
  city?: string;
  state?: string;
  country_code?: string;
  zip_code?: string;
  organization_name?: string;
}

export interface DomainsConfig {
  default_registrar?: string;
  default_dns?: string;
  /** AWS profile/account used for domain purchases (Route53 Domains). */
  purchase_aws_profile?: string;
  contact?: DomainContact;
}

/**
 * AWS profile to use for Route 53 domain purchases. Resolved from config, then
 * env. Applying it sets process.env.AWS_PROFILE when no explicit AWS creds are
 * already present.
 */
export function getPurchaseProfile(): string | undefined {
  return process.env["DOMAINS_PURCHASE_AWS_PROFILE"]
    ?? loadConfig().purchase_aws_profile
    ?? undefined;
}

/** Set AWS_PROFILE from config for purchase ops if no explicit creds are set. */
export function applyPurchaseProfile(): string | undefined {
  if (process.env["AWS_ACCESS_KEY_ID"] || process.env["AWS_PROFILE"]) return process.env["AWS_PROFILE"];
  const profile = getPurchaseProfile();
  if (profile) process.env["AWS_PROFILE"] = profile;
  return profile;
}

function canonicalHome(env: NodeJS.ProcessEnv): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

export interface LegacyConfigMigrationReport {
  dryRun: boolean;
  wouldCopy: boolean;
  copied: boolean;
}

/**
 * One-time migration from the previous XDG config default
 * ($XDG_CONFIG_HOME/open-domains/config.json) into the canonical
 * ~/.hasna/domains/config.json. Copies, verifies by size and sha256, records a
 * receipt, never deletes the source, never overwrites existing canonical data,
 * and is idempotent (receipt + canonical file both skip it). dryRun reports
 * whether the config would be copied and writes nothing.
 */
export function migrateLegacyConfig(
  env: NodeJS.ProcessEnv = process.env,
  dryRun = false,
): LegacyConfigMigrationReport {
  const report: LegacyConfigMigrationReport = { dryRun, wouldCopy: false, copied: false };
  const home = canonicalHome(env);
  const canonicalDir = resolverHome(env);
  const newPath = join(canonicalDir, "config.json");
  if (existsSync(newPath)) return report;
  if (existsSync(join(canonicalDir, ".migrated-from-xdg-config.receipt.json"))) return report;

  const xdgConfig = env["XDG_CONFIG_HOME"]?.trim() || join(home, ".config");
  const oldPath = join(xdgConfig, "open-domains", "config.json");
  if (!existsSync(oldPath)) return report;
  report.wouldCopy = true;
  if (dryRun) return report;

  mkdirSync(canonicalDir, { recursive: true });
  copyFileSync(oldPath, newPath);
  const oldBytes = readFileSync(oldPath);
  const newBytes = readFileSync(newPath);
  if (!oldBytes.equals(newBytes)) {
    throw new Error(
      `Refusing migration: copied ${newPath} does not byte-match ${oldPath}; the canonical config was not populated.`,
    );
  }
  writeFileSync(
    join(canonicalDir, ".migrated-from-xdg-config.receipt.json"),
    `${JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        from: oldPath,
        to: newPath,
        bytes: newBytes.byteLength,
        sha256: createHash("sha256").update(newBytes).digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  report.copied = true;
  return report;
}

/**
 * The default config location — `config.json` at the root of the effective
 * domains home, resolved through `@hasna/paths` (legacy `~/.hasna/domains`
 * until the XDG data home is adopted). Env overrides (DOMAINS_CONFIG_PATH /
 * DOMAINS_CONFIG_DIR) are honored unchanged and win over the default.
 */
export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env["DOMAINS_CONFIG_PATH"]) return env["DOMAINS_CONFIG_PATH"];
  const dir = env["DOMAINS_CONFIG_DIR"];
  if (dir) return join(dir, "config.json");

  // The one-time migration from the previous XDG config default targets the
  // resolver data root (ruling #1668).
  migrateLegacyConfig(env);
  return getDefaultConfigPath(env);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DomainsConfig {
  const path = getConfigPath(env);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DomainsConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: DomainsConfig, env: NodeJS.ProcessEnv = process.env): void {
  const path = getConfigPath(env);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

export function setConfigKey(keyPath: string, value: string, env: NodeJS.ProcessEnv = process.env): DomainsConfig {
  const config = loadConfig(env);
  const parts = keyPath.split(".");

  if (parts.length === 1) {
    (config as Record<string, unknown>)[parts[0]!] = value;
  } else if (parts.length === 2 && parts[0] === "contact") {
    if (!config.contact) config.contact = {};
    (config.contact as Record<string, unknown>)[parts[1]!] = value;
  } else {
    throw new Error(`Unknown config key: ${keyPath}`);
  }

  saveConfig(config, env);
  return config;
}

/** Return a DomainContactInfo-shaped object from config, with CLI opts overriding stored values */
export function resolveContact(opts: {
  email?: string; firstName?: string; lastName?: string;
  phone?: string; address?: string; city?: string; state?: string;
  country?: string; zip?: string; org?: string;
}): {
  first_name: string; last_name: string; email: string; phone: string;
  address_line_1: string; city: string; state: string; country_code: string;
  zip_code: string; organization_name?: string;
} {
  const cfg = loadConfig().contact ?? {};
  const get = (opt: string | undefined, cfgKey: keyof DomainContact) =>
    opt || cfg[cfgKey] || "";

  const first_name   = get(opts.firstName, "first_name");
  const last_name    = get(opts.lastName, "last_name");
  const email        = get(opts.email, "email");
  const phone        = get(opts.phone, "phone");
  const address_line_1 = get(opts.address, "address_line_1");
  const city         = get(opts.city, "city");
  const state        = get(opts.state, "state");
  const country_code = get(opts.country, "country_code");
  const zip_code     = get(opts.zip, "zip_code");
  const organization_name = opts.org || cfg.organization_name;

  const missing = (["first_name","last_name","email","phone","address_line_1","city","state","country_code","zip_code"] as const)
    .filter((k) => !{ first_name, last_name, email, phone, address_line_1, city, state, country_code, zip_code }[k]);

  if (missing.length > 0) {
    throw new Error(
      `Missing registrant contact fields: ${missing.join(", ")}.\n` +
      `Set defaults with: domains config set contact.<field> <value>`
    );
  }

  return { first_name, last_name, email, phone, address_line_1, city, state, country_code, zip_code, organization_name };
}

export function getConfigKey(keyPath: string): string | undefined {
  const config = loadConfig();
  const parts = keyPath.split(".");

  if (parts.length === 1) {
    return (config as Record<string, unknown>)[parts[0]!] as string | undefined;
  } else if (parts.length === 2 && parts[0] === "contact") {
    return (config.contact as Record<string, unknown> | undefined)?.[parts[1]!] as string | undefined;
  }
  return undefined;
}
