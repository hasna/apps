import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { installStartup } from "./install.js";

interface InstallEnv {
  home: string;
  dataDir: string;
  restore: () => void;
}

function withInstallEnv(): InstallEnv {
  const oldHome = process.env.HOME;
  const oldDataDir = process.env.LOOPS_DATA_DIR;
  const home = mkdtempSync(join(tmpdir(), "loops-home-"));
  const dataDir = mkdtempSync(join(tmpdir(), "loops-data-"));
  process.env.HOME = home;
  process.env.LOOPS_DATA_DIR = dataDir;
  return {
    home,
    dataDir,
    restore: () => {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = oldDataDir;
      rmSync(home, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

const LOCAL = { local: true } as const;

describe("installStartup", () => {
  test("refuses a direct installer call without explicit local confirmation before writing", () => {
    const env = withInstallEnv();
    try {
      rmSync(env.dataDir, { recursive: true, force: true });
      expect(() => installStartup("loops-daemon", "/usr/bin/bun", ["run"], "linux")).toThrow(
        "startup installation requires an explicit --local confirmation",
      );
      expect(existsSync(env.dataDir)).toBe(false);
      expect(existsSync(join(env.home, ".config", "systemd", "user", "loops-daemon.service"))).toBe(false);
    } finally {
      env.restore();
    }
  });

  test("writes loops-daemon service with top-level run command and explicit local opt-in", () => {
    const env = withInstallEnv();
    try {
      const result = installStartup("loops-daemon", "/usr/bin/bun", ["run"], "linux", LOCAL);
      const service = readFileSync(result.path, "utf8");
      expect(service).toContain("ExecStart=/usr/bin/bun loops-daemon run");
      expect(service).not.toContain("loops-daemon daemon run");
      expect(service).toContain('Environment="HASNA_LOOPS_LOCAL=1"');
      expect(service).toContain(`${process.env.HOME}/.local/bin`);
      expect(service).toContain(`${process.env.HOME}/.bun/bin`);
      expect(result.local).toBe(true);
    } finally {
      env.restore();
    }
  });

  test("pins the unit to the resolved data dir and the user-session basic target", () => {
    const env = withInstallEnv();
    try {
      const result = installStartup("loops-daemon", "/usr/bin/bun", ["run"], "linux", LOCAL);
      const service = readFileSync(result.path, "utf8");
      expect(service).toContain("After=basic.target");
      expect(service).not.toContain("After=default.target");
      expect(service).toContain("WantedBy=default.target");
      expect(service).toContain(`WorkingDirectory=${env.dataDir}`);
      expect(service).toContain(`Environment="LOOPS_DATA_DIR=${env.dataDir}"`);
      expect(service).toContain('Environment="PATH=');
    } finally {
      env.restore();
    }
  });

  test("quotes systemd ExecStart parts containing spaces and escapes percent signs", () => {
    const env = withInstallEnv();
    try {
      const result = installStartup("/opt/my tools/cli.js", "/usr/bin/bun", ["run", "50%"], "linux", LOCAL);
      expect(readFileSync(result.path, "utf8")).toContain('ExecStart=/usr/bin/bun "/opt/my tools/cli.js" run 50%%');
    } finally {
      env.restore();
    }
  });

  test("xml-escapes plist values, uses launchctl bootstrap/bootout, and writes the local opt-in", () => {
    const env = withInstallEnv();
    try {
      const result = installStartup("/opt/a&b/<cli>.js", "/usr/bin/bun", ["run"], "darwin", LOCAL);
      const plist = readFileSync(result.path, "utf8");
      expect(plist).toContain("<string>/opt/a&amp;b/&lt;cli&gt;.js</string>");
      expect(plist).not.toContain("<string>/opt/a&b/<cli>.js</string>");
      expect(plist).toContain(`<key>LOOPS_DATA_DIR</key><string>${env.dataDir}</string>`);
      expect(plist).toContain("<key>HASNA_LOOPS_LOCAL</key><string>1</string>");
      expect(plist).toContain(`<key>WorkingDirectory</key><string>${env.dataDir}</string>`);
      expect(result.instructions.some((line) => line.includes("launchctl bootstrap gui/$(id -u)"))).toBe(true);
      expect(result.instructions.some((line) => line.includes("launchctl bootout gui/$(id -u)"))).toBe(true);
      expect(result.instructions.some((line) => line.includes("load -w"))).toBe(false);
    } finally {
      env.restore();
    }
  });

  test("rejects unsupported platforms", () => {
    const env = withInstallEnv();
    try {
      expect(() => installStartup("loops-daemon", "/usr/bin/bun", ["run"], "win32", LOCAL)).toThrow(
        "startup install is not implemented for win32",
      );
    } finally {
      env.restore();
    }
  });
});
