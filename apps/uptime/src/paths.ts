import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function uptimeHome(): string {
  return process.env.HASNA_UPTIME_HOME || join(homedir(), ".hasna", "uptime");
}

export function uptimeDbPath(): string {
  return process.env.HASNA_UPTIME_DB || join(uptimeHome(), "uptime.db");
}

export function ensureUptimeHome(): string {
  const home = uptimeHome();
  mkdirSync(home, { recursive: true });
  return home;
}
