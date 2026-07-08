import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { TablesBase, createBase } from "../lib/base.js";
import { serializeBase } from "../lib/serialize.js";
import { deserializeBase } from "../lib/serialize.js";

/** Root directory for local base files (override with HASNA_TABLES_DIR). */
export function dataDir(): string {
  return process.env.HASNA_TABLES_DIR ?? join(homedir(), ".hasna", "tables");
}

/**
 * Resolve a base reference to a filesystem path. If it looks like a path
 * (ends in .json or is absolute/relative with a separator) it is used directly;
 * otherwise it is treated as a named base under the data dir.
 */
export function resolveBasePath(ref: string): string {
  if (ref.endsWith(".json") || isAbsolute(ref) || ref.includes("/")) {
    return resolve(ref);
  }
  return join(dataDir(), `${ref}.json`);
}

export function baseExists(ref: string): boolean {
  return existsSync(resolveBasePath(ref));
}

export function loadBaseFile(ref: string): TablesBase {
  const path = resolveBasePath(ref);
  if (!existsSync(path)) throw new Error(`Base not found: ${path}`);
  return TablesBase.fromJSON(deserializeBase(readFileSync(path, "utf8")));
}

export function saveBaseFile(ref: string, model: TablesBase): string {
  const path = resolveBasePath(ref);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeBase(model, true));
  return path;
}

export function createBaseFile(ref: string, name: string): { model: TablesBase; path: string } {
  const model = createBase(name);
  const path = saveBaseFile(ref, model);
  return { model, path };
}
