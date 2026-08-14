import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { dataDir, daemonLogPath, dbPath, ensureDataDir, launchdPlistPath, pidFilePath, systemdServicePath } from "./paths.js";

function withDataDirEnv<T>(value: string | undefined, run: () => T): T {
  const old = process.env.LOOPS_DATA_DIR;
  if (value === undefined) delete process.env.LOOPS_DATA_DIR;
  else process.env.LOOPS_DATA_DIR = value;
  try {
    return run();
  } finally {
    if (old === undefined) delete process.env.LOOPS_DATA_DIR;
    else process.env.LOOPS_DATA_DIR = old;
  }
}

describe("paths", () => {
  test("LOOPS_DATA_DIR overrides the default data dir and anchors derived paths", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-paths-"));
    try {
      withDataDirEnv(root, () => {
        expect(dataDir()).toBe(root);
        expect(dbPath()).toBe(join(root, "loops.db"));
        expect(pidFilePath()).toBe(join(root, "daemon.pid"));
        expect(daemonLogPath()).toBe(join(root, "daemon.log"));
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("defaults to ~/.hasna/loops without creating anything", () => {
    withDataDirEnv(undefined, () => {
      expect(dataDir()).toBe(join(homedir(), ".hasna", "loops"));
      expect(dbPath()).toBe(join(homedir(), ".hasna", "loops", "loops.db"));
    });
  });

  test("ensureDataDir creates the directory with owner-only permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-paths-ensure-"));
    const target = join(root, "nested", "data");
    try {
      const created = withDataDirEnv(target, () => ensureDataDir());
      expect(created).toBe(target);
      expect(existsSync(target)).toBe(true);
      expect(statSync(target).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("service unit paths live under the user home", () => {
    expect(systemdServicePath()).toBe(join(homedir(), ".config", "systemd", "user", "loops-daemon.service"));
    expect(launchdPlistPath()).toBe(join(homedir(), "Library", "LaunchAgents", "com.hasna.loops.daemon.plist"));
  });
});
