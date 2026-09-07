import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const SERVICE_NAME = "shortlinks";
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", SERVICE_NAME);

/**
 * The environment the app-home helpers read. Every helper takes the env the
 * CALLER hands over (defaulting to the live process env) instead of reading
 * `process.env` behind the caller's back: a caller-built environment — a test
 * fixture, an env injected into the MCP server or the SDK — must never leak the
 * on-box store into the real `~/.hasna/shortlinks` (hasna/apps#1720
 * validation: `bun test` used to plant `~/.hasna/shortlinks/shortlinks.db` on
 * the station this way).
 */
export type ConfigEnv = Record<string, string | undefined>;

export interface ShortlinksConfig {
  defaultDomain?: string;
  publicBaseUrl?: string;
  cloudflare?: {
    accountId?: string;
    workerName?: string;
    origin?: string;
  };
}

/**
 * The app home. `SHORTLINKS_HOME` names the directory itself; otherwise
 * `HASNA_HOME` replaces `~/.hasna` exactly as it does for the @hasna/contracts
 * credential chain (`$HASNA_HOME/shortlinks`); otherwise `$HOME/.hasna/shortlinks`.
 * A pure derivation — nothing on disk is created here. A declared-but-blank
 * variable means unset, as everywhere else at this app's seam.
 */
export function getDataDir(env: ConfigEnv = process.env): string {
  const explicit = env.SHORTLINKS_HOME?.trim();
  if (explicit) return resolve(explicit);
  const hasnaHome = env.HASNA_HOME?.trim();
  if (hasnaHome) return resolve(hasnaHome, SERVICE_NAME);
  const home = env.HOME?.trim();
  if (home) return resolve(home, ".hasna", SERVICE_NAME);
  return DEFAULT_DATA_DIR;
}

export function ensureDataDir(env: ConfigEnv = process.env): string {
  const dir = getDataDir(env);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Path of the config file. A lookup creates nothing; only a write creates the app home. */
export function getConfigPath(env: ConfigEnv = process.env): string {
  return join(getDataDir(env), "config.json");
}

export function getClickSaltPath(env: ConfigEnv = process.env): string {
  return join(getDataDir(env), "click-salt");
}

/**
 * The on-box SQLite path: an explicit path, else `SHORTLINKS_DB`, else
 * `<app home>/shortlinks.db`. A derivation only — OPENING the database is what
 * creates it (and its directory), and only the explicit local opt-in does that;
 * a hosted-mode read (`doctor`, MCP startup) creates nothing under the app home.
 */
export function getDatabasePath(explicitPath?: string, env: ConfigEnv = process.env): string {
  if (explicitPath) return resolve(explicitPath);
  const fromEnv = env.SHORTLINKS_DB?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(getDataDir(env), `${SERVICE_NAME}.db`);
}

function readClickSaltFile(path: string): string | null {
  try {
    const saved = readFileSync(path, "utf-8").trim();
    return saved || null;
  } catch {
    return null;
  }
}

function clickSaltError(path: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Could not initialize click salt at ${path}. Set SHORTLINKS_CLICK_SALT or fix data directory permissions. ${detail}`);
}

export function getClickSalt(env: ConfigEnv = process.env): string {
  const explicit = env.SHORTLINKS_CLICK_SALT?.trim();
  if (explicit) return explicit;

  const path = getClickSaltPath(env);
  const saved = readClickSaltFile(path);
  if (saved) return saved;

  const generated = randomBytes(32).toString("hex");
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, `${generated}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(tempPath, path);
      return generated;
    } catch (error) {
      const winner = readClickSaltFile(path);
      if (winner) return winner;
      throw clickSaltError(path, error);
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup; the canonical salt remains at path.
      }
    }
  } catch (error) {
    const winner = readClickSaltFile(path);
    if (winner) return winner;
    throw clickSaltError(path, error);
  }
}

export function loadConfig(env: ConfigEnv = process.env): ShortlinksConfig {
  const path = getConfigPath(env);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ShortlinksConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfig(config: ShortlinksConfig, env: ConfigEnv = process.env): void {
  const path = getConfigPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

export function updateConfig(patch: ShortlinksConfig, env: ConfigEnv = process.env): ShortlinksConfig {
  const current = loadConfig(env);
  const next: ShortlinksConfig = {
    ...current,
    ...patch,
    cloudflare: {
      ...current.cloudflare,
      ...patch.cloudflare,
    },
  };
  saveConfig(next, env);
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
