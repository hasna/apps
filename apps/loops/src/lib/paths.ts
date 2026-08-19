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

/**
 * Per-station runner configuration surface: the control-plane API URL and key
 * plus the runner machine id and claim scope, in a single mode-600 file
 * outside the package. The runner CLI loads it when the corresponding
 * environment variables are unset, and the systemd unit references it via
 * `EnvironmentFile`, so a package update (version bump + service restart)
 * never touches the credential.
 */
export function runnerEnvPath(): string {
  return join(dataDir(), "runner.env");
}

export function runnerLogPath(): string {
  return join(dataDir(), "runner.log");
}

export function runnerSystemdServicePath(): string {
  return join(homeDir(), ".config", "systemd", "user", "loops-runner.service");
}

export function runnerLaunchdPlistPath(): string {
  return join(homeDir(), "Library", "LaunchAgents", "com.hasna.loops.runner.plist");
}

export function systemdServicePath(): string {
  return join(homeDir(), ".config", "systemd", "user", "loops-daemon.service");
}

export function launchdPlistPath(): string {
  return join(homeDir(), "Library", "LaunchAgents", "com.hasna.loops.daemon.plist");
}
