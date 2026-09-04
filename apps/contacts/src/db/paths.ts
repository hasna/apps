/**
 * contacts data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/contacts` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides.
 */
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome, stateDir as resolverStateDir } from "@hasna/contracts/paths";

function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function home(): string {
  return resolveEffectiveHome();
}

/**
 * The contacts data root (ruling #1668). It creates only the requested target
 * directory and never scans or adopts older homes.
 */
export function getDataDir(): string {
  const base = home();
  const target = resolverDataDir({ app: "contacts", home: base });
  ensurePrivateDir(target);
  return target;
}

/**
 * The contacts state root (ruling #1668).
 */
export function getStateDir(): string {
  const base = home();
  const target = resolverStateDir({ app: "contacts", home: base });
  ensurePrivateDir(target);
  return target;
}

export function getDbPath(): string {
  if (process.env["HASNA_CONTACTS_DB_PATH"]) return process.env["HASNA_CONTACTS_DB_PATH"];
  if (process.env["CONTACTS_DB_PATH"]) return process.env["CONTACTS_DB_PATH"];
  return join(getDataDir(), "contacts.db");
}