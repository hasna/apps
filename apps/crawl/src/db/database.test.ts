import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDataDir } from "./database";

const originalHome = process.env["HOME"];
const originalUserProfile = process.env["USERPROFILE"];
const roots: string[] = [];

afterEach(() => {
  closeDb();
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
  else process.env["USERPROFILE"] = originalUserProfile;

  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), "open-crawl-home-"));
  roots.push(root);
  process.env["HOME"] = root;
  delete process.env["USERPROFILE"];
  return root;
}

describe("getDataDir", () => {
  for (const legacyName of [".open-crawl", ".crawl"]) {
    it(`migrates legacy ~/${legacyName} into ~/.hasna/crawl`, () => {
      const home = tempHome();
      const legacyDir = join(home, legacyName);
      mkdirSync(join(legacyDir, "screenshots"), { recursive: true });
      writeFileSync(join(legacyDir, "data.db"), "legacy-db");
      writeFileSync(join(legacyDir, "screenshots", "page.txt"), "legacy-screenshot");

      const dataDir = getDataDir();

      expect(dataDir).toBe(join(home, ".hasna", "crawl"));
      expect(readFileSync(join(dataDir, "data.db"), "utf8")).toBe("legacy-db");
      expect(readFileSync(join(dataDir, "screenshots", "page.txt"), "utf8")).toBe("legacy-screenshot");
    });
  }

  it("does not copy legacy data over an existing canonical directory", () => {
    const home = tempHome();
    const canonicalDir = join(home, ".hasna", "crawl");
    const legacyDir = join(home, ".open-crawl");
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(canonicalDir, "data.db"), "canonical");
    writeFileSync(join(legacyDir, "data.db"), "legacy");

    expect(getDataDir()).toBe(canonicalDir);
    expect(readFileSync(join(canonicalDir, "data.db"), "utf8")).toBe("canonical");
  });

  it("creates the canonical directory when no legacy directory exists", () => {
    const home = tempHome();
    const dataDir = getDataDir();

    expect(dataDir).toBe(join(home, ".hasna", "crawl"));
    expect(existsSync(dataDir)).toBe(true);
  });
});
