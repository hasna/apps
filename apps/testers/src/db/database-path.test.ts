import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveDbPath } from "./database.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHasnaDbPath = process.env.HASNA_TESTERS_DB_PATH;
const originalTestersDbPath = process.env.TESTERS_DB_PATH;

let tempHome: string | undefined;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHasnaDbPath === undefined) delete process.env.HASNA_TESTERS_DB_PATH;
  else process.env.HASNA_TESTERS_DB_PATH = originalHasnaDbPath;
  if (originalTestersDbPath === undefined) delete process.env.TESTERS_DB_PATH;
  else process.env.TESTERS_DB_PATH = originalTestersDbPath;

  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});

describe("resolveDbPath", () => {
  it("copies legacy ~/.testers database into ~/.hasna/testers and returns the new path", () => {
    tempHome = mkdtempSync(join(tmpdir(), "testers-db-home-"));
    const legacyDir = join(tempHome, ".testers");
    const newDir = join(tempHome, ".hasna", "testers");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "testers.db"), "legacy-db");

    process.env.HOME = tempHome;
    delete process.env.USERPROFILE;
    delete process.env.HASNA_TESTERS_DB_PATH;
    delete process.env.TESTERS_DB_PATH;

    expect(resolveDbPath()).toBe(join(newDir, "testers.db"));
    expect(readFileSync(join(newDir, "testers.db"), "utf8")).toBe("legacy-db");
    expect(existsSync(join(legacyDir, "testers.db"))).toBe(true);
  });
});
