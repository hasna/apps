import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const SERVICE_NAME = "shortlinks";
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", SERVICE_NAME);

export interface ShortlinksConfig {
  defaultDomain?: string;
  publicBaseUrl?: string;
  mode?: "local" | "remote" | "api";
  api?: {
    baseUrl?: string;
    token?: string;
    tokenEnv?: string;
  };
  cloudflare?: {
    accountId?: string;
    workerName?: string;
    origin?: string;
  };
}

export function getDataDir(): string {
  return resolve(process.env.SHORTLINKS_HOME || DEFAULT_DATA_DIR);
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigPath(): string {
  return join(ensureDataDir(), "config.json");
}

export function getDatabasePath(explicitPath?: string): string {
  if (explicitPath) return resolve(explicitPath);
  if (process.env.SHORTLINKS_DB) return resolve(process.env.SHORTLINKS_DB);
  return join(ensureDataDir(), `${SERVICE_NAME}.db`);
}

export function loadConfig(): ShortlinksConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ShortlinksConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfig(config: ShortlinksConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

export function updateConfig(patch: ShortlinksConfig): ShortlinksConfig {
  const current = loadConfig();
  const next: ShortlinksConfig = {
    ...current,
    ...patch,
    api: {
      ...current.api,
      ...patch.api,
    },
    cloudflare: {
      ...current.cloudflare,
      ...patch.cloudflare,
    },
  };
  saveConfig(next);
  return next;
}

export function getApiBaseUrl(config = loadConfig()): string | null {
  const baseUrl = process.env.SHORTLINKS_API_URL || process.env.HASNA_SHORTLINKS_API_URL || config.api?.baseUrl || "";
  return baseUrl ? baseUrl.replace(/\/+$/, "") : null;
}

export function getApiToken(config = loadConfig()): string | null {
  const envName = config.api?.tokenEnv || "SHORTLINKS_API_TOKEN";
  const token =
    process.env[envName] ||
    process.env.SHORTLINKS_API_TOKEN ||
    process.env.HASNA_SHORTLINKS_API_TOKEN ||
    config.api?.token ||
    "";
  return token || null;
}

export function normalizeHostname(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) throw new Error("Domain is required.");
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  let hostname: string;
  try {
    hostname = new URL(withProtocol).hostname;
  } catch {
    throw new Error(`Invalid domain: ${input}`);
  }
  hostname = hostname.replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes("..")) {
    throw new Error(`Invalid domain: ${input}`);
  }
  return hostname;
}

export function formatShortUrl(hostname: string, slug: string, publicBaseUrl?: string): string {
  if (publicBaseUrl) {
    const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
    return new URL(slug, base).toString();
  }
  return `https://${hostname}/${slug}`;
}
