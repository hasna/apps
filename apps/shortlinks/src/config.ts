import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const SERVICE_NAME = "shortlinks";
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", SERVICE_NAME);

export interface ShortlinksConfig {
  defaultDomain?: string;
  publicBaseUrl?: string;
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
  const next: ShortlinksConfig = {
    ...loadConfig(),
    ...patch,
    cloudflare: {
      ...loadConfig().cloudflare,
      ...patch.cloudflare,
    },
  };
  saveConfig(next);
  return next;
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
  const labels = hostname.split(".");
  const labelsAreValid = labels.every((label) => (
    label.length >= 1 &&
    label.length <= 63 &&
    /^[a-z0-9-]+$/.test(label) &&
    !label.startsWith("-") &&
    !label.endsWith("-")
  ));
  if (hostname.length > 253 || !labelsAreValid) {
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
