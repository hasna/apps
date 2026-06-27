import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "../db/database";
import { getSignaturesDir } from "./files";
import { renderPageToPng } from "./pdf-renderer";

const originalCwd = process.cwd();

afterEach(() => {
  closeDatabase();
  process.chdir(originalCwd);
});

async function withTempHome<T>(
  run: (home: string) => T | Promise<T>,
): Promise<T> {
  const originalHome = process.env["HOME"];
  const originalUserProfile = process.env["USERPROFILE"];
  const originalDbPath = process.env["SIGNATURES_DB_PATH"];
  const originalHasnaDbPath = process.env["HASNA_SIGNATURES_DB_PATH"];
  const home = mkdtempSync(join(tmpdir(), "signatures-home-"));
  try {
    process.env["HOME"] = home;
    delete process.env["USERPROFILE"];
    delete process.env["SIGNATURES_DB_PATH"];
    delete process.env["HASNA_SIGNATURES_DB_PATH"];
    return await run(home);
  } finally {
    if (originalHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = originalHome;
    if (originalUserProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = originalUserProfile;
    if (originalDbPath === undefined) delete process.env["SIGNATURES_DB_PATH"];
    else process.env["SIGNATURES_DB_PATH"] = originalDbPath;
    if (originalHasnaDbPath === undefined) {
      delete process.env["HASNA_SIGNATURES_DB_PATH"];
    } else {
      process.env["HASNA_SIGNATURES_DB_PATH"] = originalHasnaDbPath;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

describe("hasna home migration", () => {
  it("migrates legacy signature files into ~/.hasna/signatures", async () => {
    await withTempHome((home) => {
      const legacyDir = join(home, ".signatures");
      const canonicalDir = join(home, ".hasna", "signatures");
      mkdirSync(join(legacyDir, "documents"), { recursive: true });
      writeFileSync(join(legacyDir, "documents", "contract.md"), "legacy");

      const dir = getSignaturesDir();

      expect(dir).toBe(canonicalDir);
      expect(
        readFileSync(join(canonicalDir, "documents", "contract.md"), "utf8"),
      ).toBe("legacy");
    });
  });

  it("migrates legacy render cache into ~/.hasna/signatures/cache", async () => {
    await withTempHome(async (home) => {
      const legacyCache = join(home, ".signatures", "cache");
      const canonicalCache = join(home, ".hasna", "signatures", "cache");
      mkdirSync(legacyCache, { recursive: true });
      writeFileSync(join(legacyCache, "cached-page.png"), "legacy-cache");
      const fakePdf = join(home, "fake.pdf");
      writeFileSync(fakePdf, "not a real pdf");

      await renderPageToPng(fakePdf, 1);

      expect(
        readFileSync(join(canonicalCache, "cached-page.png"), "utf8"),
      ).toBe("legacy-cache");
    });
  });

  it("copies legacy global database into ~/.hasna/signatures", async () => {
    await withTempHome((home) => {
      const workDir = join(home, "work");
      const legacyDir = join(home, ".signatures");
      const canonicalDb = join(home, ".hasna", "signatures", "signatures.db");
      mkdirSync(workDir, { recursive: true });
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "signatures.db"), "");
      process.chdir(workDir);

      getDatabase();
      closeDatabase();

      expect(existsSync(canonicalDb)).toBe(true);
    });
  });
});
