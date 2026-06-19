import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(): string {
  return process.env.LOOPS_DATA_DIR || join(homedir(), ".hasna", "loops");
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
  return join(homedir(), ".config", "systemd", "user", "loops-daemon.service");
}

export function launchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "com.hasna.loops.daemon.plist");
}
