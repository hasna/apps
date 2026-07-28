import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionConfigDir } from "./accounts.js";

type Env = Record<string, string | undefined>;

/**
 * Fast mode is a per-config-dir agent setting (`fastMode` in that dir's
 * `settings.json`, toggled with `/fast`). The statusline payload does not
 * carry it, so it is read from the same config dir that names the session's
 * account — per-process via `CLAUDE_CONFIG_DIR`, like everything in
 * `accounts.ts`, so concurrent sessions under different profiles never
 * report each other's toggle.
 */
export function sessionFastMode(env: Env = process.env): boolean {
  try {
    const raw = readFileSync(join(sessionConfigDir(env), "settings.json"), "utf8");
    return JSON.parse(raw)?.fastMode === true;
  } catch {
    return false;
  }
}
