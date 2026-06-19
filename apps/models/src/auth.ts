import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { getAuthConfigPath } from "./paths.js";
import type { AuthStatus } from "./types.js";

interface AuthConfig {
  huggingface?: {
    token?: string;
    secretKey?: string;
  };
}

const HF_ENV_KEYS = [
  "HF_TOKEN",
  "HUGGINGFACE_HUB_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "HUGGINGFACE_TOKEN",
];

const DEFAULT_HF_SECRET_KEYS = [
  "huggingface/token",
  "huggingface/live/token",
  "hf/token",
];

let cachedResolution: { token: string | null; status: AuthStatus } | null = null;

function readAuthConfig(): AuthConfig {
  try {
    return JSON.parse(readFileSync(getAuthConfigPath(), "utf8")) as AuthConfig;
  } catch {
    return {};
  }
}

function writeAuthConfig(config: AuthConfig): void {
  const path = getAuthConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function fromEnv(): string | null {
  for (const key of HF_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function readSecret(key: string): string | null {
  const result = spawnSync("secrets", ["get", key], {
    encoding: "utf8",
    env: process.env,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

function secretCandidates(config: AuthConfig): string[] {
  const configured = [
    process.env["HASNA_MODELS_HF_SECRET_KEY"],
    process.env["HF_SECRET_KEY"],
    config.huggingface?.secretKey,
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set([...configured, ...DEFAULT_HF_SECRET_KEYS])];
}

export function redactAuthStatus(status: AuthStatus): AuthStatus {
  const { secretKey: _secretKey, ...rest } = status;
  return rest;
}

export function resolveHuggingFaceToken(): { token: string | null; status: AuthStatus } {
  if (cachedResolution) return cachedResolution;

  const envToken = fromEnv();
  if (envToken) {
    cachedResolution = { token: envToken, status: { provider: "huggingface", available: true, source: "env" } };
    return cachedResolution;
  }

  const config = readAuthConfig();
  const configToken = config.huggingface?.token?.trim();
  if (configToken) {
    cachedResolution = { token: configToken, status: { provider: "huggingface", available: true, source: "config" } };
    return cachedResolution;
  }

  for (const key of secretCandidates(config)) {
    const token = readSecret(key);
    if (token) {
      cachedResolution = {
        token,
        status: {
          provider: "huggingface",
          available: true,
          source: "secrets",
          secretKey: key,
        },
      };
      return cachedResolution;
    }
  }

  cachedResolution = { token: null, status: { provider: "huggingface", available: false, source: "none" } };
  return cachedResolution;
}

export function getHuggingFaceAuthStatus(): AuthStatus {
  return redactAuthStatus(resolveHuggingFaceToken().status);
}

export function saveHuggingFaceSecretRef(secretKey: string): AuthStatus {
  const config = readAuthConfig();
  config.huggingface = { ...config.huggingface, secretKey };
  delete config.huggingface.token;
  writeAuthConfig(config);
  cachedResolution = null;
  return redactAuthStatus({ provider: "huggingface", available: Boolean(readSecret(secretKey)), source: "secrets", secretKey });
}
