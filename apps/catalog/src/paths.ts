import { homedir } from "node:os";
import { join } from "node:path";

function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined;
}

export function catalogHome(): string {
  return nonBlank(process.env["CATALOG_HOME"]) ?? join(homedir(), ".hasna", "catalog");
}

export function catalogDbPath(): string {
  return nonBlank(process.env["CATALOG_DB_PATH"]) ?? join(catalogHome(), "catalog.db");
}

export function defaultOpensourceRoot(): string {
  return nonBlank(process.env["CATALOG_OPENSOURCE_ROOT"]) ?? join(homedir(), "workspace", "hasna", "opensource");
}
