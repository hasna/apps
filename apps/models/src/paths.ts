import { homedir } from "node:os";
import { join } from "node:path";

export function getModelsHome(): string {
  return process.env["HASNA_MODELS_HOME"] || join(homedir(), ".hasna", "models");
}

export function getDbPath(): string {
  return process.env["HASNA_MODELS_DB"] || join(getModelsHome(), "models.db");
}

export function getAuthConfigPath(): string {
  return join(getModelsHome(), "auth.json");
}

export function getCacheRoot(): string {
  return process.env["HASNA_MODELS_CACHE"] || join(getModelsHome(), "cache");
}

export function getInstallRoot(): string {
  return process.env["HASNA_MODELS_INSTALLS"] || join(getModelsHome(), "installs");
}
