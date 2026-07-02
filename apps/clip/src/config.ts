import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveConfigPath } from "./paths.js";
import type { ClipClientOptions, JsonObject } from "./types.js";

export interface ClipConfig extends JsonObject {
  baseUrl?: string;
  host?: string;
  port?: number;
}

export function readConfig(options: ClipClientOptions = {}): ClipConfig {
  const path = resolveConfigPath(options);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ClipConfig : {};
  } catch {
    return {};
  }
}

export function writeConfig(config: ClipConfig, options: ClipClientOptions = {}): ClipConfig {
  const path = resolveConfigPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function updateConfig(key: string, value: string, options: ClipClientOptions = {}): ClipConfig {
  const config = readConfig(options);
  if (key === "port") {
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("port must be between 1 and 65535");
    config.port = port;
  } else if (key === "baseUrl" || key === "host") {
    config[key] = value;
  } else {
    config[key] = value;
  }
  return writeConfig(config, options);
}
