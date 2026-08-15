import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { TestersConfig, ModelPreset } from "../types/index.js";
import { MODEL_MAP } from "../types/index.js";
import { getTestersDir } from "./paths.js";

const CONFIG_DIR = getTestersDir();
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
export const DEFAULT_IMAGE_MODEL = "gpt-image-2";

/**
 * Returns the hardcoded default configuration.
 */
export function getDefaultConfig(): TestersConfig {
  return {
    defaultModel: "claude-haiku-4-5-20251001",
    defaultImageModel: DEFAULT_IMAGE_MODEL,
    models: { ...MODEL_MAP },
    browser: {
      headless: true,
      viewport: { width: 1280, height: 720 },
      timeout: 120_000,
    },
    screenshots: {
      dir: join(getTestersDir(), "screenshots"),
      format: "png",
      quality: 90,
      fullPage: false,
    },
    selfHeal: false, // opt-in: set to true to enable AI-powered selector repair
  };
}

/**
 * Loads configuration from ~/.hasna/testers/config.json (if it exists),
 * merges with defaults, and applies environment variable overrides.
 */
export function loadConfig(): TestersConfig {
  const defaults = getDefaultConfig();
  let fileConfig: Partial<TestersConfig> = {};

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      fileConfig = JSON.parse(raw) as Partial<TestersConfig>;
    } catch {
      // Malformed config file — fall through to defaults
    }
  }

  const config: TestersConfig = {
    defaultModel: fileConfig.defaultModel ?? defaults.defaultModel,
    defaultImageModel: fileConfig.defaultImageModel ?? defaults.defaultImageModel,
    models: fileConfig.models
      ? { ...defaults.models, ...fileConfig.models }
      : { ...defaults.models },
    browser: fileConfig.browser
      ? { ...defaults.browser, ...fileConfig.browser }
      : { ...defaults.browser },
    screenshots: fileConfig.screenshots
      ? { ...defaults.screenshots, ...fileConfig.screenshots }
      : { ...defaults.screenshots },
    anthropicApiKey: fileConfig.anthropicApiKey,
    todosDbPath: fileConfig.todosDbPath,
    judgeModel: fileConfig.judgeModel,
    judgeProvider: fileConfig.judgeProvider,
    selfHeal: fileConfig.selfHeal ?? false,
    conversationsSpace: fileConfig.conversationsSpace,
    prodDebug: fileConfig.prodDebug,
  };

  // Environment variable overrides
  const envModel = process.env["TESTERS_MODEL"];
  if (envModel) {
    config.defaultModel = envModel;
  }

  const envImageModel = process.env["TESTERS_IMAGE_MODEL"];
  if (envImageModel) {
    config.defaultImageModel = envImageModel;
  }

  const envScreenshotsDir = process.env["TESTERS_SCREENSHOTS_DIR"];
  if (envScreenshotsDir) {
    config.screenshots.dir = envScreenshotsDir;
  }

  const envApiKey = process.env["ANTHROPIC_API_KEY"];
  if (envApiKey) {
    config.anthropicApiKey = envApiKey;
  }

  const envSelfHeal = process.env["TESTERS_SELF_HEAL"];
  if (envSelfHeal !== undefined) {
    config.selfHeal = ["1", "true", "yes", "on"].includes(envSelfHeal.toLowerCase());
  }

  return config;
}

/**
 * Resolves a model name or preset key to a full model identifier.
 * If `nameOrId` matches a preset key (quick, thorough, deep), returns
 * the corresponding model ID from MODEL_MAP. Otherwise returns the
 * input string unchanged.
 */
export function resolveModel(nameOrId: string): string {
  if (nameOrId in MODEL_MAP) {
    return MODEL_MAP[nameOrId as ModelPreset];
  }
  return nameOrId;
}
