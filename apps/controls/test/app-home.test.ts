// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 4:
// the app-home tree (src/core/app-home.ts). ensureControlsAppHome must honor
// HASNA_CONTROLS_HOME, create the full subdirectory set with mode 0700, and
// never touch the real default home while the override is set.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CONTROLS_APP_SUBDIRS, ensureControlsAppHome, getControlsAppHome } from "../src/core/app-home.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "controls-home-"));
  process.env["HASNA_CONTROLS_HOME"] = tmp;
});

afterEach(() => {
  delete process.env["HASNA_CONTROLS_HOME"];
  rmSync(tmp, { recursive: true, force: true });
});

describe("app home: override and containment", () => {
  it("honors HASNA_CONTROLS_HOME over the default home (two-sided)", () => {
    const overridden = getControlsAppHome();
    delete process.env["HASNA_CONTROLS_HOME"];
    const defaulted = getControlsAppHome();
    process.env["HASNA_CONTROLS_HOME"] = tmp;

    expect(overridden).toBe(resolve(tmp));
    expect(overridden).not.toBe(defaulted);
  });

  it("creates the root and all six subdirectories with mode 0700, all inside the override", () => {
    const dirs = ensureControlsAppHome();
    expect(dirs.root).toBe(resolve(tmp));
    for (const name of CONTROLS_APP_SUBDIRS) {
      expect(dirs[name]).toBe(join(resolve(tmp), name));
      expect(existsSync(dirs[name])).toBe(true);
      expect(statSync(dirs[name]).mode & 0o777).toBe(0o700);
      expect(dirs[name].startsWith(resolve(tmp))).toBe(true);
    }
    // Nothing else was created at the home root: exactly the six subdirs.
    expect(readdirSync(resolve(tmp)).sort()).toEqual([...CONTROLS_APP_SUBDIRS].sort());
  });

  it("is idempotent (re-running does not throw)", () => {
    ensureControlsAppHome();
    expect(() => ensureControlsAppHome()).not.toThrow();
  });
});
