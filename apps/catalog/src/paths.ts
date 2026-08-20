import { homedir } from "node:os";
import { join } from "node:path";

function envOr(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function catalogHome(): string {
  return envOr("CATALOG_HOME", join(homedir(), ".hasna", "catalog"));
}

export function catalogDbPath(): string {
  return envOr("CATALOG_DB_PATH", join(catalogHome(), "catalog.db"));
}

export function defaultOpensourceRoot(): string {
  return envOr("CATALOG_OPENSOURCE_ROOT", join(homedir(), "workspace", "hasna", "opensource"));
}
