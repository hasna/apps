process.env.TESTERS_DB_PATH = ":memory:";
// Force the on-box (local SQLite) Store transport for this hermetic test —
// the ambient environment may point testers at a cloud/self_hosted API.
process.env.HASNA_TESTERS_STORAGE_MODE = "local";
delete process.env.HASNA_TESTERS_MODE;
delete process.env.HASNA_TESTERS_API_URL;
delete process.env.HASNA_TESTERS_API_KEY;

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { resetStore } from "../store/index.js";
import { runRepoTests } from "./repo-executor.js";
import type { RepoDiscoverySnapshot, RepoSpec } from "./repo-discovery.js";

let baseDir = "";
let repoPath = "";
let testersDir = "";
let argsPath = "";

function makeSpec(file: string): RepoSpec {
  return {
    file,
    fromGlob: "**/*.spec.ts",
    testCount: 1,
    mtimeMs: 0,
    contentHash: file,
  };
}

function makeSnapshot(specFiles: string[]): RepoDiscoverySnapshot {
  return {
    repoPath,
    configPath: "playwright.config.ts",
    configRaw: "export default {};",
    specs: specFiles.map(makeSpec),
    totalTests: specFiles.length,
    packageManager: {
      npm: true,
      yarn: false,
      pnpm: false,
      bun: false,
      preferred: "npm",
    },
    devScripts: {
      dev: null,
      test: null,
      seed: null,
      build: null,
    },
    readiness: {
      playwrightInstalled: true,
      browsersInstalled: true,
      configExists: true,
      specsFound: specFiles.length > 0,
      ready: true,
      issues: [],
    },
    prep: {
      installCmd: null,
      installBrowsersCmd: null,
      startDevCmd: null,
      buildCmd: null,
      seedCmd: null,
    },
    suggestedUrl: "http://localhost:3000",
    workingDir: repoPath,
    snapshotAt: new Date().toISOString(),
    cacheKey: "test-cache",
  };
}

function writeSpec(relativePath: string): void {
  const fullPath = join(repoPath, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, "import { test } from '@playwright/test';\ntest('ok', async () => {});\n", "utf-8");
}

function installFakePlaywright(opts: { exitCode?: number } = {}): void {
  const binDir = join(repoPath, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const playwrightBin = join(binDir, "playwright");
  const exitCode = opts.exitCode ?? 0;
  // Emit a passing test outcome on success, a failing one on nonzero exit, so
  // the parsed spec status agrees with the (propagated) process exit code.
  const outcome = exitCode === 0 ? "expected" : "unexpected";
  const testsJson = `[{ title: "fake test", outcome: "${outcome}" }]`;
  writeFileSync(
    playwrightBin,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  suites: [],
  tests: ${testsJson}
}));
process.exit(${exitCode});
`,
    "utf-8",
  );
  chmodSync(playwrightBin, 0o755);
}

function readPlaywrightArgs(): string[] {
  return JSON.parse(readFileSync(argsPath, "utf-8")) as string[];
}

describe("repo executor (shell-injection safe)", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "testers-repo-executor-"));
    repoPath = join(baseDir, "repo");
    testersDir = join(baseDir, "testers");
    argsPath = join(baseDir, "playwright-args.json");
    mkdirSync(repoPath, { recursive: true });
    process.env.HASNA_TESTERS_DIR = testersDir;
    resetDatabase();
    resetStore();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.HASNA_TESTERS_DIR;
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("passes malicious extra args without invoking a shell", async () => {
    const specFile = "tests/a.spec.ts";
    const markerPath = join(baseDir, "extra-pwned");
    const maliciousExtra = `--grep=smoke; touch ${markerPath} #`;

    writeSpec(specFile);
    installFakePlaywright();

    const result = await runRepoTests({
      snapshot: makeSnapshot([specFile]),
      specFiles: [specFile],
      extraArgs: [maliciousExtra],
      timeout: 5000,
    });

    expect(result.status).toBe("passed");
    // If a shell had interpreted the args, the marker file would exist.
    expect(existsSync(markerPath)).toBe(false);
    expect(readPlaywrightArgs()).toEqual(["test", specFile, "--reporter", "json", maliciousExtra]);
  });

  test("passes malicious selected spec filenames without invoking a shell", async () => {
    const specFile = "tests/a.spec.ts; touch tmp/spec-pwned #.spec.ts";
    const markerPath = join(repoPath, "tmp", "spec-pwned");

    mkdirSync(join(repoPath, "tmp"), { recursive: true });
    writeSpec(specFile);
    installFakePlaywright();

    const result = await runRepoTests({
      snapshot: makeSnapshot([specFile]),
      specFiles: [specFile],
      extraArgs: [],
      timeout: 5000,
    });

    expect(result.status).toBe("passed");
    expect(existsSync(markerPath)).toBe(false);
    expect(readPlaywrightArgs()).toEqual(["test", specFile, "--reporter", "json"]);
  });

  test("reports failure when Playwright exits nonzero", async () => {
    const specFile = "tests/a.spec.ts";

    writeSpec(specFile);
    installFakePlaywright({ exitCode: 1 });

    const result = await runRepoTests({
      snapshot: makeSnapshot([specFile]),
      specFiles: [specFile],
      extraArgs: [],
      timeout: 5000,
    });

    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.specResults[0]?.status).toBe("failed");
    expect(result.specResults[0]?.exitCode).toBe(1);
  });
});
