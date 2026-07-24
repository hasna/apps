// Keep this regression suite hermetic: force the testers Store to the on-box
// SQLite transport so it never routes to the cloud `/v1` API (a cloud-wired
// station or CI would otherwise make these tests hit the network and hang).
process.env.HASNA_TESTERS_STORAGE_MODE = "local";
delete process.env.HASNA_TESTERS_API_URL;
delete process.env.HASNA_TESTERS_API_KEY;
process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { closeDatabase, resetDatabase } from "../db/database.js";
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

function writePlaywrightConfig(): void {
  writeFileSync(join(repoPath, "playwright.config.ts"), "export default { testDir: 'tests' };\n", "utf-8");
}

function installFakePlaywright(opts: { exitCode?: number } = {}): void {
  const binDir = join(repoPath, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const playwrightBin = join(binDir, "playwright");
  writeFileSync(
    playwrightBin,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  suites: [],
  tests: [{ title: "fake test", outcome: "expected" }]
}));
process.exit(${opts.exitCode ?? 0});
`,
    "utf-8",
  );
  chmodSync(playwrightBin, 0o755);
}

function readPlaywrightArgs(): string[] {
  return JSON.parse(readFileSync(argsPath, "utf-8")) as string[];
}

describe("repo executor", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "testers-repo-executor-"));
    repoPath = join(baseDir, "repo");
    testersDir = join(baseDir, "testers");
    argsPath = join(baseDir, "playwright-args.json");
    mkdirSync(repoPath, { recursive: true });
    process.env.HASNA_TESTERS_DIR = testersDir;
    resetDatabase();
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

  test("reports failure when Playwright exits nonzero with passing JSON", async () => {
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

  test("repo run CLI passes malicious extra args without invoking a shell", () => {
    const specFile = "tests/e2e/cli.spec.ts";
    const markerPath = join(baseDir, "cli-extra-pwned");
    const maliciousExtra = `--grep=cli; touch ${markerPath} #`;

    writePlaywrightConfig();
    writeSpec(specFile);
    installFakePlaywright();

    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "--no-color",
        "repo",
        "run",
        repoPath,
        "--refresh",
        "--spec",
        specFile,
        "--extra",
        maliciousExtra,
        "--timeout",
        "5000",
        "--json",
      ],
      env: { ...process.env, HASNA_TESTERS_STORAGE_MODE: "local", TESTERS_DB_PATH: ":memory:", HASNA_TESTERS_DIR: testersDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.total).toBe(1);
    expect(existsSync(markerPath)).toBe(false);
    expect(readPlaywrightArgs()).toEqual(["test", specFile, "--reporter", "json", maliciousExtra]);
  });

  test("repo run CLI passes malicious spec filenames without invoking a shell", () => {
    const specFile = "tests/e2e/cli.spec.ts; touch tmp/cli-spec-pwned #.spec.ts";
    const markerPath = join(repoPath, "tmp", "cli-spec-pwned");

    mkdirSync(join(repoPath, "tmp"), { recursive: true });
    writePlaywrightConfig();
    writeSpec(specFile);
    installFakePlaywright();

    const proc = spawnSync({
      cmd: [
        "bun",
        "run",
        "src/cli/index.tsx",
        "--no-color",
        "repo",
        "run",
        repoPath,
        "--refresh",
        "--spec",
        specFile,
        "--timeout",
        "5000",
        "--json",
      ],
      env: { ...process.env, HASNA_TESTERS_STORAGE_MODE: "local", TESTERS_DB_PATH: ":memory:", HASNA_TESTERS_DIR: testersDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.total).toBe(1);
    expect(existsSync(markerPath)).toBe(false);
    expect(readPlaywrightArgs()).toEqual(["test", specFile, "--reporter", "json"]);
  });
});
