import { homedir } from "node:os";
import { join } from "node:path";

export function catalogHome(): string {
  return process.env["CATALOG_HOME"] ?? join(homedir(), ".hasna", "catalog");
}

export function catalogDbPath(): string {
  return process.env["CATALOG_DB_PATH"] ?? join(catalogHome(), "catalog.db");
}

export function defaultOpensourceRoot(): string {
  return process.env["CATALOG_OPENSOURCE_ROOT"] ?? join(homedir(), "workspace", "hasna", "opensource");
}
