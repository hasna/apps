import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The home directory for bridge data. Fleet law: app data lives at
 * ~/.hasna/bridge — never cwd-relative. HOME is read directly so a fake HOME
 * in tests is honored; when HOME is unset we fall back to the passwd-backed
 * `os.homedir()` (the real user home), never `process.cwd()`.
 */
export function homeDir(): string {
  return process.env["HOME"] || homedir();
}

export function bridgeHome(): string {
  return process.env["BRIDGE_HOME"] || join(homeDir(), ".hasna", "bridge");
}

export function defaultConfigPath(): string {
  return process.env["BRIDGE_CONFIG"] || join(bridgeHome(), "config.json");
}
