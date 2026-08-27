import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CrawlConfig } from "../types/index.js";
import { getDataDir } from "../db/database.js";

// Lazy, not module scope: getDataDir() resolves the effective data root and
// migrates the legacy dir as a side effect. Running it at import time would
// make `crawl-mcp --version`/`crawl-serve --version` touch the data dir
// before the early-arg guard answers (todos row 7e5f8f3d).
function configDir(): string {
  return getDataDir();
}

function configFile(): string {
  return join(configDir(), "config.json");
}

const DEFAULT_CONFIG: CrawlConfig = {
  userAgent: "crawl/1.0 (+https://github.com/hasna/crawl)",
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
  if (!existsSync(configDir())) {
    mkdirSync(configDir(), { recursive: true });
  }
}

function readConfigFile(): CrawlConfig {
  try {
    if (!existsSync(configFile())) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = readFileSync(configFile(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<CrawlConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfigFile(config: CrawlConfig): void {
  ensureConfigDir();
  writeFileSync(configFile(), JSON.stringify(config, null, 2), "utf-8");
}

export function getConfigPath(): string {
  return configFile();
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
