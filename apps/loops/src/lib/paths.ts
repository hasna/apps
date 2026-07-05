import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Home directory honoring a runtime `HOME` override. `os.homedir()` snapshots
 * `HOME` at process start and (under Bun) ignores later reassignment, so tests
 * that set `process.env.HOME` to a temp dir would otherwise resolve the *real*
 * home — which let the daemon-install tests overwrite the live
 * `~/.config/systemd/user/loops-daemon.service` with fixture garbage. In
 * production `HOME` is set at startup, so this resolves identically.
 */
function homeDir(): string {
  const home = process.env.HOME?.trim();
  return home ? home : homedir();
}

export function dataDir(): string {
  return process.env.LOOPS_DATA_DIR || join(homeDir(), ".hasna", "loops");
}

export function ensureDataDir(): string {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function dbPath(): string {
  return join(dataDir(), "loops.db");
}

export function pidFilePath(): string {
  return join(dataDir(), "daemon.pid");
}

export function daemonLogPath(): string {
  return join(dataDir(), "daemon.log");
}

export function systemdServicePath(): string {
  return join(homeDir(), ".config", "systemd", "user", "loops-daemon.service");
}

export function launchdPlistPath(): string {
  return join(homeDir(), "Library", "LaunchAgents", "com.hasna.loops.daemon.plist");
}
