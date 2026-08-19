import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * config.ts computes CONFIG_DIR from getDataDir() at module load, so the HOME
 * and the DB path must be pinned before the module is first imported. Every
 * test re-imports config with a fresh HOME.
 */
let home: string;

async function loadConfig() {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  return await import("./config.js");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crawl-config-"));
  process.env["HOME"] = home;
  delete process.env["USERPROFILE"];
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  delete process.env["HOME"];
  rmSync(home, { recursive: true, force: true });
});

describe("getConfig defaults", () => {
  it("returns the documented defaults when no config file exists", async () => {
    const { getConfig } = await loadConfig();
    const config = getConfig();
    expect(config.userAgent).toContain("crawl/1.0");
    expect(config.defaultDelay).toBe(1000);
    expect(config.maxConcurrent).toBe(5);
    expect(config.maxDepth).toBe(3);
    expect(config.maxPages).toBe(100);
    expect(config.storeHtml).toBe(false);
    expect(config.defaultRender).toBe(false);
    expect(config.aiProvider).toBe("openai");
    expect(config.screenshotViewport).toEqual({ width: 1280, height: 720 });
  });
});

describe("config persistence and merging", () => {
  it("merges a saved partial config over the defaults", async () => {
    const { getConfig, setConfig } = await loadConfig();
    setConfig({ maxPages: 7, defaultDelay: 250 });

    const reloaded = await loadConfig();
    const config = reloaded.getConfig();
    expect(config.maxPages).toBe(7);
    expect(config.defaultDelay).toBe(250);
    // Untouched defaults survive the merge.
    expect(config.maxDepth).toBe(3);
    expect(config.maxConcurrent).toBe(5);
  });

  it("deep-merges screenshotViewport instead of replacing it wholesale", async () => {
    const { getConfig, setConfig } = await loadConfig();
    setConfig({ screenshotViewport: { width: 800 } });

    const config = getConfig();
    expect(config.screenshotViewport).toEqual({ width: 800, height: 720 });
  });

  it("returns defaults for a corrupt config file instead of crashing", async () => {
    const { getConfigPath } = await loadConfig();
    const fs = await import("fs");
    fs.mkdirSync(join(home, ".hasna", "crawl"), { recursive: true });
    fs.writeFileSync(getConfigPath(), "{not valid json", "utf-8");

    const reloaded = await loadConfig();
    expect(reloaded.getConfig().maxPages).toBe(100);
  });

  it("writes the merged config to disk for setConfig", async () => {
    const { getConfigPath, setConfig } = await loadConfig();
    setConfig({ storeHtml: true });

    const fs = await import("fs");
    const raw = JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
    expect(raw.storeHtml).toBe(true);
  });

  it("resetConfig restores the defaults and persists them", async () => {
    const { getConfig, resetConfig, setConfig } = await loadConfig();
    setConfig({ maxPages: 999 });
    const reset = resetConfig();
    expect(reset.maxPages).toBe(100);
    expect(getConfig().maxPages).toBe(100);
  });
});
