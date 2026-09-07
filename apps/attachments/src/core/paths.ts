import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { resolvePath } from "@hasna/paths";
import { ATTACHMENTS_DB_PATH_ENV_KEYS } from "./local-opt-in";

/** Non-authoritative configuration only. No mkdir, legacy discovery, or copying. */
export function ensureAttachmentsDataDir(): string {
  return resolvePath("config", { app: "attachments" });
}

export const HASNA_ATTACHMENTS_DB_PATH_ENV = "HASNA_ATTACHMENTS_DB_PATH";

function expandHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * The on-box SQLite database path (pure — no filesystem side effects).
 *
 * An explicit `HASNA_ATTACHMENTS_DB_PATH` / `ATTACHMENTS_DB_PATH` wins
 * (precedence 1 — the narrowest signal, answered before the resolver, see
 * local-opt-in.ts). Otherwise the default lives under the @hasna/paths data
 * root. Legacy data is preserved in place; nothing is discovered, copied or
 * imported.
 */
export function resolveAttachmentsDbPathValue(): string {
  const explicit = ATTACHMENTS_DB_PATH_ENV_KEYS.map((key) => process.env[key]?.trim()).find(
    (value): value is string => !!value,
  );
  return explicit
    ? expandHomePath(explicit)
    : join(resolvePath("data", { app: "attachments" }), "db.sqlite");
}

/**
 * The on-box SQLite database path, with the parent directory created so the
 * store opens on first use.
 */
export function getAttachmentsDbPath(): string {
  const dbPath = resolveAttachmentsDbPathValue();
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}
