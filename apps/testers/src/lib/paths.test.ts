import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getTestersDir } from "./paths.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHasnaDir = process.env.HASNA_TESTERS_DIR;
const originalTestersDir = process.env.TESTERS_DIR;

let tempHome: string | undefined;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHasnaDir === undefined) delete process.env.HASNA_TESTERS_DIR;
  else process.env.HASNA_TESTERS_DIR = originalHasnaDir;
  if (originalTestersDir === undefined) delete process.env.TESTERS_DIR;
  else process.env.TESTERS_DIR = originalTestersDir;

  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

describe("getTestersDir", () => {
  it("copies legacy ~/.testers state into ~/.hasna/testers and returns the new dir", () => {
    tempHome = mkdtempSync(join(tmpdir(), "testers-home-"));
    const legacyDir = join(tempHome, ".testers");
    const newDir = join(tempHome, ".hasna", "testers");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "config.json"), "{\"screenshots\":true}");

    process.env.HOME = tempHome;
    delete process.env.USERPROFILE;
    delete process.env.HASNA_TESTERS_DIR;
    delete process.env.TESTERS_DIR;

    expect(getTestersDir()).toBe(newDir);
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("screenshots");
    expect(existsSync(join(legacyDir, "config.json"))).toBe(true);
  });
});
