import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import type { Provider, SafetyConfig } from "../types/index.js";

const CONFIG_DIR = join(process.env.HOME ?? "~", ".hasna", "computer");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/** Full configuration schema */
export interface ComputerConfig {
  /** Default AI provider */
  provider: Provider;
  /** Default model (per provider) */
  model?: string;
  /** Maximum steps per task */
  maxSteps: number;
  /** Save screenshots to disk by default */
  saveScreenshots: boolean;
  /** Screenshots directory (default: ~/.hasna/computer/screenshots/<session>) */
  screenshotsDir?: string;
  /** Max screenshot width before sending to AI model */
  screenshotMaxWidth: number;
  /** REST API port */
  port: number;
  /** Safety rules */
  safety: SafetyConfig;
}

/** Default configuration */
export const DEFAULT_CONFIG: ComputerConfig = {
  provider: "anthropic",
  maxSteps: 50,
  saveScreenshots: false,
  screenshotMaxWidth: 1280,
  port: 19450,
  safety: {
    blockedApps: [
      "Keychain Access",
      "System Preferences",
      "System Settings",
    ],
    blockedDomains: [],
    confirmClicks: false,
    maxActionsPerMinute: 60,
    allowPasswordTyping: false,
  },
};

/** Load config from disk, merged with defaults */
export function loadConfig(): ComputerConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const user = JSON.parse(raw) as Partial<ComputerConfig>;
      return mergeConfig(DEFAULT_CONFIG, user);
    }
  } catch {
    // Invalid JSON or read error — use defaults
  }
  return { ...DEFAULT_CONFIG, safety: { ...DEFAULT_CONFIG.safety } };
}

/** Save config to disk */
export function saveConfig(config: ComputerConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

/** Get a single config value by dot path (e.g. "safety.blockedApps") */
export function getConfigValue(key: string): unknown {
  const config = loadConfig();
  const parts = key.split(".");
  let obj: any = config;
  for (const part of parts) {
    if (obj == null || typeof obj !== "object") return undefined;
    obj = obj[part];
  }
  return obj;
}

/** Set a single config value by dot path */
export function setConfigValue(key: string, value: unknown): void {
  const config = loadConfig();
  const parts = key.split(".");
  let obj: any = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null || typeof obj[parts[i]] !== "object") {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]];
  }
  const lastKey = parts[parts.length - 1];

  // Auto-parse value types
  if (value === "true") value = true;
  else if (value === "false") value = false;
  else if (typeof value === "string" && /^\d+$/.test(value)) value = parseInt(value as string);

  obj[lastKey] = value;
  saveConfig(config);
}

/** Deep merge user config on top of defaults */
function mergeConfig(
  defaults: ComputerConfig,
  user: Partial<ComputerConfig>
): ComputerConfig {
  return {
    provider: user.provider ?? defaults.provider,
    model: user.model ?? defaults.model,
    maxSteps: user.maxSteps ?? defaults.maxSteps,
    saveScreenshots: user.saveScreenshots ?? defaults.saveScreenshots,
    screenshotsDir: user.screenshotsDir ?? defaults.screenshotsDir,
    screenshotMaxWidth: user.screenshotMaxWidth ?? defaults.screenshotMaxWidth,
    port: user.port ?? defaults.port,
    safety: {
      blockedApps: user.safety?.blockedApps ?? defaults.safety.blockedApps,
      blockedDomains: user.safety?.blockedDomains ?? defaults.safety.blockedDomains,
      confirmClicks: user.safety?.confirmClicks ?? defaults.safety.confirmClicks,
      maxActionsPerMinute: user.safety?.maxActionsPerMinute ?? defaults.safety.maxActionsPerMinute,
      allowPasswordTyping: user.safety?.allowPasswordTyping ?? defaults.safety.allowPasswordTyping,
    },
  };
}

/** Get config file path */
export function getConfigPath(): string {
  return CONFIG_PATH;
}
