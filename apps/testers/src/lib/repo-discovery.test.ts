// Regression suite for repo-native Playwright browser detection (PLA16-00071).
//
// Defect (QA row 73766b01): `testers repo discover` kept claiming "Playwright
// browsers not installed" even after `npx playwright install` had run, because
// checkPlaywrightBrowserInstalled() only looked at repo-local paths
// (node_modules/.cache/ms-playwright and <repo>/.cache/ms-playwright) and never
// at the global browser cache where Playwright actually installs browsers:
//   - PLAYWRIGHT_BROWSERS_PATH (when set)
//   - macOS:   ~/Library/Caches/ms-playwright
//   - Linux:   ~/.cache/ms-playwright
//   - Windows: %USERPROFILE%\AppData\Local\ms-playwright
//
// These tests are hermetic: they point PLAYWRIGHT_BROWSERS_PATH / HOME at temp
// directories so they do not depend on whether this machine has browsers
// installed. Each test restores process.env in `finally`.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRepo } from "./repo-discovery.js";

let repoPath = "";
let testersDir = "";
let savedEnv: Record<string, string | undefined> = {};

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-disc-"));
  // Minimal package.json so package-manager/dev-script detection is stable.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  return dir;
}

function saveEnv() {
  savedEnv = {
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
    HOME: process.env.HOME,
    HASNA_TESTERS_DIR: process.env.HASNA_TESTERS_DIR,
  };
}

function restoreEnv() {
  if (savedEnv.PLAYWRIGHT_BROWSERS_PATH === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  else process.env.PLAYWRIGHT_BROWSERS_PATH = savedEnv.PLAYWRIGHT_BROWSERS_PATH;
  if (savedEnv.HOME === undefined) delete process.env.HOME;
  else process.env.HOME = savedEnv.HOME;
  if (savedEnv.HASNA_TESTERS_DIR === undefined) delete process.env.HASNA_TESTERS_DIR;
  else process.env.HASNA_TESTERS_DIR = savedEnv.HASNA_TESTERS_DIR;
}

beforeEach(() => {
  saveEnv();
  repoPath = makeRepo();
  testersDir = mkdtempSync(join(tmpdir(), "repo-disc-td-"));
  process.env.HASNA_TESTERS_DIR = testersDir;
  // Isolate HOME so global-cache detection cannot read the real machine's cache.
  process.env.HOME = mkdtempSync(join(tmpdir(), "repo-disc-home-"));
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
});

afterEach(() => {
  restoreEnv();
  for (const dir of [repoPath, testersDir]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  repoPath = "";
  testersDir = "";
});

describe("repo discovery browser detection", () => {
  test("PLAYWRIGHT_BROWSERS_PATH with an ms-playwright/ subdir counts as installed", () => {
    const pwPath = mkdtempSync(join(tmpdir(), "repo-disc-pw-"));
    try {
      mkdirSync(join(pwPath, "ms-playwright", "chromium-9999"), { recursive: true });
      process.env.PLAYWRIGHT_BROWSERS_PATH = pwPath;

      const snap = discoverRepo({ repoPath, refresh: true });
      expect(snap.readiness.browsersInstalled).toBe(true);
    } finally {
      rmSync(pwPath, { recursive: true, force: true });
    }
  });

  test("PLAYWRIGHT_BROWSERS_PATH pointing straight at browser revisions counts as installed", () => {
    const pwPath = mkdtempSync(join(tmpdir(), "repo-disc-pw2-"));
    try {
      mkdirSync(join(pwPath, "chromium-9999"), { recursive: true });
      process.env.PLAYWRIGHT_BROWSERS_PATH = pwPath;

      const snap = discoverRepo({ repoPath, refresh: true });
      expect(snap.readiness.browsersInstalled).toBe(true);
    } finally {
      rmSync(pwPath, { recursive: true, force: true });
    }
  });

  test("macOS default global cache (~/Library/Caches/ms-playwright) counts as installed", () => {
    // HOME is already isolated to a temp dir in beforeEach.
    mkdirSync(join(process.env.HOME!, "Library", "Caches", "ms-playwright", "chromium-9999"), {
      recursive: true,
    });

    const snap = discoverRepo({ repoPath, refresh: true });
    expect(snap.readiness.browsersInstalled).toBe(true);
  });

  test("repo-local node_modules/.cache/ms-playwright still counts as installed", () => {
    mkdirSync(join(repoPath, "node_modules", ".cache", "ms-playwright", "chromium-9999"), {
      recursive: true,
    });

    const snap = discoverRepo({ repoPath, refresh: true });
    expect(snap.readiness.browsersInstalled).toBe(true);
  });

  test("no browsers anywhere reports not installed", () => {
    const snap = discoverRepo({ repoPath, refresh: true });
    expect(snap.readiness.browsersInstalled).toBe(false);
  });
});
