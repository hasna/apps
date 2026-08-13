import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_NAME } from "../config.js";

/** Sub-directories provisioned under ~/.hasna/consolidations (all mode 0700). */
export const APP_HOME_SUBDIRS = ["config", "data", "exports", "backups", "logs", "tmp"] as const;

/** Absolute path to ~/.hasna/consolidations. */
export function appHome(): string {
  return join(homedir(), ".hasna", APP_NAME);
}

/** Absolute path to a sub-directory under the app home. */
export function appHomeDir(sub: (typeof APP_HOME_SUBDIRS)[number]): string {
  return join(appHome(), sub);
}

/** Ensure the app-home tree exists with directory mode 0700. Best-effort, idempotent. */
export function ensureAppHome(): string {
  const base = appHome();
  mkdirSync(base, { recursive: true, mode: 0o700 });
  for (const sub of APP_HOME_SUBDIRS) {
    mkdirSync(join(base, sub), { recursive: true, mode: 0o700 });
  }
  return base;
}
