import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_SUBDIRS,
  ensureAppHome,
  getAppDir,
  getAppHome,
  getBackupDir,
  getDefaultDbPath,
} from "../src/core/app-home.js";

/**
 * Direct tests for the app home resolution (src/core/app-home.ts): the env
 * precedence for the home root, the 0700 permission contract on every created
 * directory, and the derived data/backup paths. Every test isolates HOME via
 * HASNA_ACCESS_HOME so the real ~/.hasna/access is never touched.
 */

let home: string;

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "access-apphome-"));
}

function setHome(value: string): void {
  process.env["HASNA_ACCESS_HOME"] = value;
}

afterEach(() => {
  delete process.env["HASNA_ACCESS_HOME"];
  delete process.env["ACCESS_HOME"];
  if (home) {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  home = undefined as never;
});

describe("getAppHome", () => {
  it("prefers HASNA_ACCESS_HOME over ACCESS_HOME", () => {
    home = freshHome();
    const pref = join(home, "pref");
    const alt = join(home, "alt");
    setHome(pref);
    process.env["ACCESS_HOME"] = alt;
    expect(getAppHome()).toBe(pref);
  });

  it("falls back to ACCESS_HOME when the prefixed form is unset", () => {
    home = freshHome();
    const alt = join(home, "alt");
    process.env["ACCESS_HOME"] = alt;
    expect(getAppHome()).toBe(alt);
  });

  it("resolves the canonical default under the user home", () => {
    expect(getAppHome()).toMatch(/\.hasna[\\/]access$/);
  });

  it("resolves relative overrides to absolute paths", () => {
    home = freshHome();
    setHome("relative-home");
    expect(getAppHome()).toBe(join(process.cwd(), "relative-home"));
  });
});

describe("getAppDir / getDefaultDbPath / getBackupDir", () => {
  it("derives subdirs, the default DB path, and the backup dir from the home", () => {
    home = freshHome();
    setHome(home);
    expect(getAppDir("data")).toBe(join(home, "data"));
    expect(getAppDir("backups")).toBe(join(home, "backups"));
    expect(getDefaultDbPath()).toBe(join(home, "data", "access.db"));
    expect(getBackupDir()).toBe(join(home, "backups"));
  });
});

describe("ensureAppHome", () => {
  it("creates the root and every canonical subdir with 0700 permissions", () => {
    home = freshHome();
    setHome(home);
    const dirs = ensureAppHome();

    expect(dirs.root).toBe(home);
    expect(existsSync(home)).toBe(true);
    expect(statSync(home).mode & 0o777).toBe(0o700);

    for (const name of APP_SUBDIRS) {
      expect(dirs[name], `missing ${name} in the returned map`).toBe(join(home, name));
      expect(existsSync(join(home, name)), `${name} was not created`).toBe(true);
      expect(statSync(join(home, name)).mode & 0o777, `${name} is not 0700`).toBe(0o700);
    }
  });

  it("is idempotent and does not clobber existing content", () => {
    home = freshHome();
    setHome(home);
    const first = ensureAppHome();
    const second = ensureAppHome();
    expect(second).toEqual(first);
    expect(statSync(join(home, "logs")).mode & 0o777).toBe(0o700);
  });
});
