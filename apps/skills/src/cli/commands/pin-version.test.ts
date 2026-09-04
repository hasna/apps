/**
 * `skills pin name@version` (hasna/apps#1630) records only a version this machine fetched:
 * the exact version is pulled (digest-verified) first; a failed pull records nothing; and
 * without an instance the request is refused instead of inventing a pin.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectConfigPath } from "../../lib/project-state.js";
import { pinExactVersion } from "./install.js";
import { useDefaultTestTimeout } from "../../test-preload.js";

useDefaultTestTimeout();

let dir = "";
let previousCwd = "";

beforeEach(() => {
  previousCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "skills-pin-version-"));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(previousCwd);
  rmSync(dir, { recursive: true, force: true });
});

describe("pinExactVersion", () => {
  test("pulls the exact version first and records the version the pull installed", async () => {
    const pulled: string[] = [];
    const result = await pinExactVersion("release-notes", "2.1.0", {
      useRemote: true,
      overwrite: false,
      pull: async (spec) => {
        pulled.push(spec);
        return { success: true, version: "2.1.0" };
      },
    });
    expect(pulled).toEqual(["release-notes@2.1.0"]);
    expect(result).toMatchObject({ success: true, version: "2.1.0", source: "remote", mode: "pin" });
    const config = JSON.parse(readFileSync(getProjectConfigPath(dir), "utf-8")) as { pinnedSkills: string[]; pins: Record<string, { version: string; source: string }> };
    expect(config.pinnedSkills).toEqual(["release-notes"]);
    expect(config.pins["release-notes"]).toMatchObject({ version: "2.1.0", source: "remote" });
  });

  test("a failed pull records no pin", async () => {
    const result = await pinExactVersion("release-notes", "9.9.9", {
      useRemote: true,
      overwrite: false,
      pull: async () => ({ success: false, error: "Version '9.9.9' of 'release-notes' is not published" }),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("9.9.9");
    expect(() => readFileSync(getProjectConfigPath(dir), "utf-8")).toThrow();
  });

  test("without an instance an exact-version pin is refused", async () => {
    const result = await pinExactVersion("release-notes", "2.1.0", { useRemote: false, overwrite: false, pull: async () => ({ success: true }) });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Skills instance");
  });
});
