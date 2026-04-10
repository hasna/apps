import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || "~";
}

export function getDataDir(): string {
  return process.env["HASNA_MACHINES_DIR"] || join(homeDir(), ".hasna", "machines");
}

export function getDbPath(): string {
  return process.env["HASNA_MACHINES_DB_PATH"] || join(getDataDir(), "machines.db");
}

export function getManifestPath(): string {
  return process.env["HASNA_MACHINES_MANIFEST_PATH"] || join(getDataDir(), "machines.json");
}

export function getNotificationsPath(): string {
  return process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] || join(getDataDir(), "notifications.json");
}

export function ensureParentDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  ensureParentDir(join(dir, ".keep"));
  return dir;
}
