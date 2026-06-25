import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import {
  type SearchConfig,
  DEFAULT_CONFIG,
  validateSearchProviderNames,
} from "../types/index.js";

export interface ConfigDiagnostics {
  path: string;
  exists: boolean;
  valid: boolean;
  errors: string[];
}

export function getConfigDir(): string {
  const override = Bun.env.HASNA_SEARCH_DIR ?? Bun.env.SEARCH_DATA_DIR;
  if (override) {
    mkdirSync(override, { recursive: true });
    return override;
  }

  const home = Bun.env.HOME ?? "/tmp";
  const dir = `${home}/.hasna/search`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigPath(): string {
  return `${getConfigDir()}/config.json`;
}

const CONFIG_KEYS = new Set<keyof SearchConfig>(Object.keys(DEFAULT_CONFIG) as Array<keyof SearchConfig>);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireInteger(value: unknown, label: string, min = 1): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

export function hasConfigKey(key: string): key is keyof SearchConfig {
  return CONFIG_KEYS.has(key as keyof SearchConfig);
}

function validateConfigValue(
  key: keyof SearchConfig,
  value: unknown,
  current: SearchConfig,
): SearchConfig[keyof SearchConfig] {
  switch (key) {
    case "defaultLimit":
      return requireInteger(value, key, 1);
    case "defaultProviders":
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error(`${key} must be an array of provider names`);
      }
      return validateSearchProviderNames(value);
    case "defaultProfile":
      if (value !== null && typeof value !== "string") {
        throw new Error(`${key} must be a string or null`);
      }
      return value;
    case "router": {
      if (!isRecord(value)) throw new Error(`${key} must be an object`);
      const allowed = new Set(["enabled", "model", "maxProviders", "timeoutMs"]);
      for (const nestedKey of Object.keys(value)) {
        if (!allowed.has(nestedKey)) throw new Error(`Unknown router config key: ${nestedKey}`);
      }
      return {
        ...current.router,
        ...(value.enabled !== undefined && { enabled: requireBoolean(value.enabled, "router.enabled") }),
        ...(value.model !== undefined && { model: requireString(value.model, "router.model") }),
        ...(value.maxProviders !== undefined && {
          maxProviders: Math.min(5, requireInteger(value.maxProviders, "router.maxProviders", 1)),
        }),
        ...(value.timeoutMs !== undefined && {
          timeoutMs: requireInteger(value.timeoutMs, "router.timeoutMs", 250),
        }),
      };
    }
    case "transcriber": {
      if (!isRecord(value)) throw new Error(`${key} must be an object`);
      const allowed = new Set(["baseUrl", "fallbackCli"]);
      for (const nestedKey of Object.keys(value)) {
        if (!allowed.has(nestedKey)) throw new Error(`Unknown transcriber config key: ${nestedKey}`);
      }
      return {
        ...current.transcriber,
        ...(value.baseUrl !== undefined && { baseUrl: requireString(value.baseUrl, "transcriber.baseUrl") }),
        ...(value.fallbackCli !== undefined && {
          fallbackCli: requireString(value.fallbackCli, "transcriber.fallbackCli"),
        }),
      };
    }
    case "dedup":
    case "indexAutoRefresh":
    case "recordLocalResults":
      return requireBoolean(value, key);
    case "maxConcurrent":
      return requireInteger(value, key, 1);
    case "providerTimeoutMs":
      return requireInteger(value, key, 1);
    case "indexStaleMinutes":
      return requireInteger(value, key, 0);
  }
}

export function validateConfigUpdates(
  updates: Record<string, unknown>,
  current: SearchConfig = getConfig(),
): Partial<SearchConfig> {
  const validated: Partial<SearchConfig> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!hasConfigKey(key)) throw new Error(`Unknown config key: ${key}`);
    (validated as Record<string, unknown>)[key] = validateConfigValue(key, value, current);
  }
  return validated;
}

function loadConfig(path = getConfigPath()): SearchConfig {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Partial<SearchConfig>;
  const merged = {
    ...DEFAULT_CONFIG,
    ...parsed,
    router: {
      ...DEFAULT_CONFIG.router,
      ...(parsed.router ?? {}),
    },
    transcriber: {
      ...DEFAULT_CONFIG.transcriber,
      ...(parsed.transcriber ?? {}),
    },
  };
  return {
    ...DEFAULT_CONFIG,
    ...validateConfigUpdates(merged as Record<string, unknown>, DEFAULT_CONFIG),
  } as SearchConfig;
}

export function getConfigDiagnostics(): ConfigDiagnostics {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      valid: true,
      errors: [],
    };
  }

  try {
    loadConfig(path);
    return {
      path,
      exists: true,
      valid: true,
      errors: [],
    };
  } catch (err) {
    return {
      path,
      exists: true,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}

export function getConfig(): SearchConfig {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    return loadConfig(path);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setConfig(updates: Partial<SearchConfig> | Record<string, unknown>): SearchConfig {
  const current = getConfig();
  const validated = validateConfigUpdates(updates as Record<string, unknown>, current);
  const merged = { ...current, ...validated };
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

export function resetConfig(): SearchConfig {
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  return { ...DEFAULT_CONFIG };
}

export function getConfigValue(key: keyof SearchConfig): unknown {
  const config = getConfig();
  return config[key];
}

export function setConfigValue(key: keyof SearchConfig, value: unknown): SearchConfig {
  return setConfig({ [key]: value } as Partial<SearchConfig>);
}
