import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeDb, getDataDir, getDb } from "./database";

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
  const root = mkdtempSync(join(tmpdir(), "crawl-home-"));
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

  it("copies missing legacy files without overwriting an existing canonical directory", () => {
    const home = tempHome();
    const canonicalDir = join(home, ".hasna", "crawl");
    const legacyDir = join(home, ".crawl");
    mkdirSync(canonicalDir, { recursive: true });
    mkdirSync(join(legacyDir, "screenshots"), { recursive: true });
    writeFileSync(join(canonicalDir, "data.db"), "canonical");
    writeFileSync(join(legacyDir, "data.db"), "legacy");
    writeFileSync(join(legacyDir, "config.json"), "legacy-config");
    writeFileSync(join(legacyDir, "screenshots", "page.txt"), "legacy-screenshot");

    expect(getDataDir()).toBe(canonicalDir);
    // Existing canonical file is never overwritten.
    expect(readFileSync(join(canonicalDir, "data.db"), "utf8")).toBe("canonical");
    // Missing legacy files are copied forward even though the canonical dir existed.
    expect(readFileSync(join(canonicalDir, "config.json"), "utf8")).toBe("legacy-config");
    expect(readFileSync(join(canonicalDir, "screenshots", "page.txt"), "utf8")).toBe("legacy-screenshot");
    // Legacy source is preserved, not deleted.
    expect(existsSync(join(legacyDir, "config.json"))).toBe(true);
  });

  it("prefers ~/.open-crawl over ~/.crawl on name collisions", () => {
    const home = tempHome();
    const openCrawl = join(home, ".open-crawl");
    const crawl = join(home, ".crawl");
    mkdirSync(openCrawl, { recursive: true });
    mkdirSync(crawl, { recursive: true });
    writeFileSync(join(openCrawl, "config.json"), "open-crawl-config");
    writeFileSync(join(crawl, "config.json"), "crawl-config");
    writeFileSync(join(crawl, "crawl-only.txt"), "crawl-only");

    const dataDir = getDataDir();

    expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe("open-crawl-config");
    expect(readFileSync(join(dataDir, "crawl-only.txt"), "utf8")).toBe("crawl-only");
  });

  it("ignores a non-directory legacy path", () => {
    const home = tempHome();
    writeFileSync(join(home, ".crawl"), "not-a-directory");

    const dataDir = getDataDir();

    expect(dataDir).toBe(join(home, ".hasna", "crawl"));
    expect(existsSync(dataDir)).toBe(true);
  });

  it("creates the canonical directory when no legacy directory exists", () => {
    const home = tempHome();
    const dataDir = getDataDir();

    expect(dataDir).toBe(join(home, ".hasna", "crawl"));
    expect(existsSync(dataDir)).toBe(true);
  });

  it("adopts the resolver data root when HASNA_DATA_HOME is set", () => {
    const home = tempHome();
    const dataHome = join(home, "xdg-data");
    process.env["HASNA_DATA_HOME"] = dataHome;

    const dataDir = getDataDir();

    expect(dataDir).toBe(join(dataHome, "crawl"));
    expect(existsSync(dataDir)).toBe(true);
    delete process.env["HASNA_DATA_HOME"];
  });

  it("migrates the legacy ~/.hasna/crawl store when HASNA_DATA_HOME redirects the root", () => {
    const home = tempHome();
    const legacyRoot = join(home, ".hasna", "crawl");
    const dataHome = join(home, "xdg-data");
    mkdirSync(join(legacyRoot, "screenshots"), { recursive: true });
    writeFileSync(join(legacyRoot, "data.db"), "live-db");
    writeFileSync(join(legacyRoot, "config.json"), "live-config");
    writeFileSync(join(legacyRoot, "screenshots", "page.txt"), "live-screenshot");
    process.env["HASNA_DATA_HOME"] = dataHome;

    const dataDir = getDataDir();

    expect(dataDir).toBe(join(dataHome, "crawl"));
    expect(readFileSync(join(dataDir, "data.db"), "utf8")).toBe("live-db");
    expect(readFileSync(join(dataDir, "config.json"), "utf8")).toBe("live-config");
    expect(readFileSync(join(dataDir, "screenshots", "page.txt"), "utf8")).toBe("live-screenshot");
    // Legacy source is preserved, not deleted.
    expect(existsSync(join(legacyRoot, "data.db"))).toBe(true);
    delete process.env["HASNA_DATA_HOME"];
  });
});

describe("package install", () => {
  it("does not pre-create the runtime data directory during postinstall", async () => {
    const pkg = (await Bun.file(join(import.meta.dir, "../..", "package.json")).json()) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.postinstall ?? "").not.toContain(".hasna/crawl");
    expect(pkg.scripts?.postinstall ?? "").not.toContain(".crawl");
  });
});

describe("connection concurrency", () => {
  it("applies a busy timeout so cross-process lock contention waits instead of failing", async () => {
    tempHome();
    process.env["CRAWL_DB_PATH"] = join(tmpdir(), `open-crawl-busy-${Date.now()}.db`);
    roots.push(process.env["CRAWL_DB_PATH"]);

    const { getDb } = await import("./database");
    const db = getDb();
    const row = db.query("PRAGMA busy_timeout").get() as { timeout: number } | undefined;

    expect(row?.timeout ?? 0).toBeGreaterThanOrEqual(5000);
  });
});
