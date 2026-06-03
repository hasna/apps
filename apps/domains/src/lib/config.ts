/**
 * Persistent config stored at ~/.hasna/domains/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
 * AWS profile to use for domain purchases. For this app, domains are bought in
 * the hasna-xyz-infra account. Resolved from config, then env. Applying it sets
 * process.env.AWS_PROFILE when no explicit AWS creds are already present.
 */
export function getPurchaseProfile(): string | undefined {
  return loadConfig().purchase_aws_profile
    ?? process.env["DOMAINS_PURCHASE_AWS_PROFILE"]
    ?? undefined;
}

/** Set AWS_PROFILE from config for purchase ops if no explicit creds are set. */
export function applyPurchaseProfile(): string | undefined {
  if (process.env["AWS_ACCESS_KEY_ID"] || process.env["AWS_PROFILE"]) return process.env["AWS_PROFILE"];
  const profile = getPurchaseProfile();
  if (profile) process.env["AWS_PROFILE"] = profile;
  return profile;
}

function configPath(): string {
  return join(homedir(), ".hasna", "domains", "config.json");
}

export function loadConfig(): DomainsConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as DomainsConfig;
  } catch {
    return {};
  }
}

export function saveConfig(config: DomainsConfig): void {
  const path = configPath();
  const dir = join(homedir(), ".hasna", "domains");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

export function setConfigKey(keyPath: string, value: string): DomainsConfig {
  const config = loadConfig();
  const parts = keyPath.split(".");

  if (parts.length === 1) {
    (config as Record<string, unknown>)[parts[0]!] = value;
  } else if (parts.length === 2 && parts[0] === "contact") {
    if (!config.contact) config.contact = {};
    (config.contact as Record<string, unknown>)[parts[1]!] = value;
  } else {
    throw new Error(`Unknown config key: ${keyPath}`);
  }

  saveConfig(config);
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
