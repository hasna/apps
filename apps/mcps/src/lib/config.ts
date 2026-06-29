import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, cpSync } from "fs";

function resolveMcpsDir(): string {
  const explicit = process.env.HASNA_MCPS_DATA_DIR ?? process.env.MCPS_DATA_DIR;
  if (explicit) return explicit;

  const newDir = join(homedir(), ".hasna", "mcps");
  const oldDir = join(homedir(), ".mcps");

  // Auto-migrate: copy old data to new location if needed
  if (!existsSync(newDir) && existsSync(oldDir)) {
    mkdirSync(join(homedir(), ".hasna"), { recursive: true });
    cpSync(oldDir, newDir, { recursive: true });
  }

  return newDir;
}

export const MCPS_DIR = resolveMcpsDir();
export const DB_PATH = process.env.HASNA_MCPS_DB_PATH ?? process.env.MCPS_DB_PATH ?? join(MCPS_DIR, "registry.db");
export type McpsStorageMode = "local";

export function resolveStorageMode(): McpsStorageMode {
  const raw = process.env.HASNA_MCPS_STORAGE_MODE ?? process.env.MCPS_STORAGE_MODE ?? "local";
  const mode = raw.toLowerCase();
  if (mode !== "local") {
    throw new Error(
      `Unsupported MCPs storage mode "${raw}". @hasna/mcps currently supports local SQLite storage only.`,
    );
  }
  return "local";
}

export const REGISTRY_API_URL = "https://registry.modelcontextprotocol.io/v0/servers";
export const TOOL_PREFIX_SEPARATOR = "__";
