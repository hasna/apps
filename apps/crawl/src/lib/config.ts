import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CrawlConfig } from "../types/index.js";
import { getDataDir } from "../db/database.js";

const CONFIG_DIR = getDataDir();
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: CrawlConfig = {
  userAgent: "open-crawl/1.0 (+https://github.com/hasna/open-crawl)",
  defaultDelay: 1000,
  maxConcurrent: 5,
  maxDepth: 3,
  maxPages: 100,
  storeHtml: false,
  defaultRender: false,
  aiProvider: "openai",
  screenshotViewport: { width: 1280, height: 720 },
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readConfigFile(): CrawlConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CrawlConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfigFile(config: CrawlConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getConfig(): CrawlConfig {
  return readConfigFile();
}

export function setConfig(updates: Partial<CrawlConfig>): CrawlConfig {
  const current = readConfigFile();
  const next: CrawlConfig = { ...current, ...updates };
  if (updates.screenshotViewport) {
    next.screenshotViewport = {
      ...current.screenshotViewport,
      ...updates.screenshotViewport,
    };
  }
  writeConfigFile(next);
  return next;
}

export function resetConfig(): CrawlConfig {
  const config = { ...DEFAULT_CONFIG };
  writeConfigFile(config);
  return config;
}
