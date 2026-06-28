import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { getDatabasePath } from "../db/database.js";
import { getTodosGlobalDir } from "./sync-utils.js";

function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true" || value === "yes";
}

function isUnder(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`);
}

export function databasePathFromDatabase(db?: { filename?: string | null }): string | undefined {
  const filename = db?.filename;
  return typeof filename === "string" && filename.trim() ? filename : undefined;
}

export function isEphemeralTodosDatabase(dbPath?: string): boolean {
  const resolvedPath = dbPath ?? getDatabasePath();
  if (resolvedPath === ":memory:" || resolvedPath.startsWith("file::memory:")) return true;
  return isUnder(tmpdir(), resolvedPath);
}

export function hasExplicitSharedEventsStore(): boolean {
  return Boolean(process.env["HASNA_EVENTS_DIR"] || process.env["HASNA_EVENTS_HOME"]);
}

export function usesIsolatedTodosHome(): boolean {
  return isUnder(tmpdir(), getTodosGlobalDir());
}

export function shouldEmitSharedTaskEvents(dbPath?: string): boolean {
  if (envFlag("TODOS_DISABLE_SHARED_EVENTS")) return false;
  if (envFlag("TODOS_ALLOW_EPHEMERAL_SHARED_EVENTS")) return true;
  if (!isEphemeralTodosDatabase(dbPath)) return true;
  return hasExplicitSharedEventsStore();
}

export function shouldDeliverLocalLifecycleHooks(dbPath?: string): boolean {
  if (envFlag("TODOS_DISABLE_LOCAL_EVENT_HOOKS")) return false;
  if (envFlag("TODOS_ALLOW_EPHEMERAL_LOCAL_EVENT_HOOKS")) return true;
  if (!isEphemeralTodosDatabase(dbPath)) return true;
  return usesIsolatedTodosHome();
}
