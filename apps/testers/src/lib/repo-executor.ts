// Repo-native Playwright test execution.
// Runs discovered specs through the repo's own Playwright install,
// captures results and maps them onto the existing Run/Result model.

import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createRun, updateRun } from "../db/runs.js";
import { updateResult } from "../db/results.js";
import { getDatabase, uuid, now } from "../db/database.js";
import { getTestersDir } from "./paths.js";
import type { RepoDiscoverySnapshot, RepoSpec } from "./repo-discovery.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepoRunSpecResult {
  specFile: string;
  status: "passed" | "failed" | "error" | "skipped";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Parseable test names and their individual status */
  testResults: { name: string; status: "passed" | "failed" | "skipped" }[];
  error?: string;
}

export interface RepoRunOptions {
  /** Discovery snapshot for the repo */
  snapshot: RepoDiscoverySnapshot;
  /** Specific spec files to run (defaults to all discovered) */
  specFiles?: string[];
  /** Extra args to pass to Playwright */
  extraArgs?: string[];
  /** Timeout per spec file in ms */
  timeout?: number;
  /** Project ID for result storage */
  projectId?: string;
  /** URL the dev server is running on */
  url?: string;
  /** Model hint (stored in run metadata) */
  model?: string;
  /** Run label */
  label?: string;
}

export interface RepoRunResult {
  runId: string;
  specResults: RepoRunSpecResult[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  durationMs: number;
  status: "passed" | "failed" | "error";
}

// ─── Playwright Command Resolution ───────────────────────────────────────────

function resolvePlaywrightCmd(repoPath: string): string[] {
  // Prefer local playwright binary (always needs the 'test' subcommand)
  const localPw = join(repoPath, "node_modules", ".bin", "playwright");
  if (existsSync(localPw)) {
    return [localPw, "test"];
  }

  // Fall back to npx playwright test
  return ["npx", "playwright", "test"];
}

function buildPlaywrightArgs(specFiles: string[], extraArgs: string[] = []): string[] {
  const args: string[] = [];

  // If specific files, pass them
  if (specFiles.length > 0) {
    args.push(...specFiles);
  }

  // JSON reporter for machine-parseable output
  args.push("--reporter", "json");

  if (extraArgs.length > 0) {
    args.push(...extraArgs);
  }

  return args;
}

// ─── Execution ───────────────────────────────────────────────────────────────

function runPlaywright(
  repoPath: string,
  workingDir: string,
  specFiles: string[],
  extraArgs: string[],
  timeoutMs: number,
): { exitCode: number | null; stdout: string; stderr: string; durationMs: number } {
  const cmd = resolvePlaywrightCmd(repoPath);
  const args = buildPlaywrightArgs(specFiles, extraArgs, workingDir);

  const startTime = Date.now();

  try {
    // Use --reporter=line for terminal output, also get JSON via --reporter=json
    const result = execSync(`${cmd.join(" ")} ${args.join(" ")}`, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
      env: { ...process.env, CI: "1" },
    }).toString();

    return {
      exitCode: 0,
      stdout: result,
      stderr: "",
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const exitCode = err.status ?? err.code ?? -1;

    return {
      exitCode: typeof exitCode === "number" ? exitCode : -1,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    };
  }
}

function parsePlaywrightJsonOutput(stdout: string, stderr: string): RepoRunSpecResult["testResults"] {
  const testResults: RepoRunSpecResult["testResults"] = [];

  // Playwright JSON reporter outputs a single large JSON object (pretty-printed)
  // Try parsing the entire output first
  try {
    const obj = JSON.parse(stdout);
    if (obj.suites) {
      for (const suite of obj.suites) {
        collectTestsFromSuite(suite, testResults);
      }
    }
    if (obj.tests && Array.isArray(obj.tests)) {
      for (const test of obj.tests) {
        testResults.push({
          name: test.title || test.name || "unknown test",
          status: test.outcome === "expected" ? "passed" : test.outcome === "skipped" ? "skipped" : "failed",
        });
      }
    }
  } catch {
    // Not a single JSON object — try line-by-line (NDJSON format)
    const lines = stdout.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.suites) {
          for (const suite of obj.suites) {
            collectTestsFromSuite(suite, testResults);
          }
        }
        if (obj.tests && Array.isArray(obj.tests)) {
          for (const test of obj.tests) {
            testResults.push({
              name: test.title || test.name || "unknown test",
              status: test.outcome === "expected" ? "passed" : test.outcome === "skipped" ? "skipped" : "failed",
            });
          }
        }
      } catch {
        // Not JSON, skip
      }
    }
  }

  // Fallback: parse terminal output for test results
  if (testResults.length === 0) {
    const passed = (stdout.match(/✓/g) || []).length;
    const failed = (stdout.match(/✗/g) || []).length;
    if (passed > 0 || failed > 0) {
      testResults.push({ name: `${passed} passed, ${failed} failed`, status: failed > 0 ? "failed" : "passed" });
    } else {
      // Exit code is our best indicator
      testResults.push({ name: "suite", status: stdout.includes("Error") ? "failed" : "passed" });
    }
  }

  return testResults;
}

function collectTestsFromSuite(suite: any, results: RepoRunSpecResult["testResults"]) {
  if (suite.specs) {
    for (const spec of suite.specs) {
      const title = spec.title || spec.name || "unknown test";
      // spec.tests array has test results
      if (spec.tests && Array.isArray(spec.tests)) {
        for (const t of spec.tests) {
          results.push({
            name: title,
            status: t.outcome === "expected" ? "passed" : t.outcome === "skipped" ? "skipped" : "failed",
          });
        }
      }
    }
  }
  if (suite.suites) {
    for (const sub of suite.suites) {
      collectTestsFromSuite(sub, results);
    }
  }
}

function determineSpecStatus(exitCode: number | null, testResults: RepoRunSpecResult["testResults"]): RepoRunSpecResult["status"] {
  if (exitCode === null) return "error";
  if (exitCode === 0) return "passed";
  if (testResults.length > 0 && testResults.every((t) => t.status === "passed")) return "passed";
  if (exitCode > 128) return "error"; // signal/timeout
  return "failed";
}

// ─── Per-Spec Execution ─────────────────────────────────────────────────────

function runSingleSpec(
  repoPath: string,
  workingDir: string,
  spec: RepoSpec,
  extraArgs: string[],
  timeoutMs: number,
): RepoRunSpecResult {
  const result = runPlaywright(repoPath, workingDir, [spec.file], extraArgs, timeoutMs);

  const testResults = parsePlaywrightJsonOutput(result.stdout, result.stderr);
  const status = determineSpecStatus(result.exitCode, testResults);

  return {
    specFile: spec.file,
    status,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    testResults,
    error: result.exitCode !== 0 && result.stderr ? result.stderr.slice(0, 2000) : undefined,
  };
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

export async function runRepoTests(opts: RepoRunOptions): Promise<RepoRunResult> {
  const { snapshot } = opts;
  const specFiles = opts.specFiles ?? snapshot.specs.map((s) => s.file);
  const timeout = opts.timeout ?? 300000; // 5 min default
  const workingDir = opts.snapshot.workingDir;
  const repoPath = snapshot.repoPath;

  // Create run record
  const url = opts.url ?? snapshot.suggestedUrl ?? "http://localhost:3000";
  const run = createRun({
    projectId: opts.projectId,
    url,
    model: opts.model ?? "repo-native",
    headed: false,
    parallel: 1,
    metadata: {
      runType: "repo-native",
      repoPath,
      configPath: snapshot.configPath,
      cacheKey: snapshot.cacheKey,
      label: opts.label,
    },
  });

  const specResults: RepoRunSpecResult[] = [];
  const startTime = Date.now();

  // Run each spec file
  for (const specFile of specFiles) {
    const spec = snapshot.specs.find((s) => s.file === specFile);
    if (!spec) continue;

    const result = runSingleSpec(repoPath, workingDir, spec, opts.extraArgs ?? [], timeout);
    specResults.push(result);

    // Create result record directly (bypass FK constraint since repo-native
    // results don't have a corresponding scenario row)
    const resultId = uuid();
    const timestamp = now();
    const db = getDatabase();
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      const reasoning = result.status === "passed"
        ? "All tests passed"
        : (result.error ?? "").slice(0, 500) || null;
      const errorStr = result.status !== "passed"
        ? (result.error ?? null)
        : null;

      db.query(`
        INSERT INTO results (id, run_id, scenario_id, status, reasoning, error, steps_completed, steps_total, duration_ms, model, tokens_used, cost_cents, metadata, created_at, persona_id, persona_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, NULL, NULL)
      `).run(
        resultId,
        run.id,
        "__repo__",
        result.status,
        reasoning,
        errorStr,
        result.testResults.filter((t) => t.status === "passed").length,
        result.testResults.length || 1,
        result.durationMs,
        "repo-native",
        JSON.stringify({
          specFile: result.specFile,
          exitCode: result.exitCode,
          testResults: result.testResults,
        }),
        timestamp,
      );
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    const resultRecord = { id: resultId };

    // Store raw output to file for later inspection
    if (result.stdout || result.stderr) {
      const reportersDir = join(getTestersDir(), "repo-run-output");
      mkdirSync(reportersDir, { recursive: true });
      const outputFile = join(reportersDir, `${resultRecord.id}.log`);
      writeFileSync(outputFile, `=== stdout ===\n${result.stdout}\n\n=== stderr ===\n${result.stderr}\n`);
    }
  }

  const durationMs = Date.now() - startTime;
  const passed = specResults.filter((r) => r.status === "passed").length;
  const failed = specResults.filter((r) => r.status === "failed").length;
  const skipped = specResults.filter((r) => r.status === "skipped").length;
  const errored = specResults.filter((r) => r.status === "error").length;
  const status = failed > 0 || errored > 0 ? "failed" : "passed";

  // Update run with final counts (metadata is stored as JSON string)
  const runMeta = run.metadata ?? {};
  updateRun(run.id, {
    status,
    total: specResults.length,
    passed,
    failed: failed + errored,
    metadata: JSON.stringify({
      ...runMeta,
      specResults: specResults.map((r) => ({
        specFile: r.specFile,
        status: r.status,
        exitCode: r.exitCode,
        testCount: r.testResults.length,
        durationMs: r.durationMs,
      })),
    }),
  });

  return {
    runId: run.id,
    specResults,
    total: specResults.length,
    passed,
    failed,
    skipped,
    errored,
    durationMs,
    status,
  };
}

// ─── Prep (safe prerequisite steps) ─────────────────────────────────────────

export interface PrepResult {
  steps: { cmd: string; success: boolean; output: string; durationMs: number }[];
  allSucceeded: boolean;
}

export function runPrep(
  snapshot: RepoDiscoverySnapshot,
  steps: ("install" | "browsers" | "dev" | "build" | "seed")[],
): PrepResult {
  const { prep } = snapshot;
  const results: PrepResult["steps"] = [];

  for (const step of steps) {
    let cmd: string | null = null;
    switch (step) {
      case "install": cmd = prep.installCmd; break;
      case "browsers": cmd = prep.installBrowsersCmd; break;
      case "dev": cmd = prep.startDevCmd; break;
      case "build": cmd = prep.buildCmd; break;
      case "seed": cmd = prep.seedCmd; break;
    }

    if (!cmd) {
      results.push({ cmd: step, success: true, output: "Not needed (already satisfied)", durationMs: 0 });
      continue;
    }

    const startTime = Date.now();
    try {
      const output = execSync(cmd, {
        cwd: snapshot.workingDir,
        encoding: "utf-8",
        timeout: 120000,
        maxBuffer: 50 * 1024 * 1024,
        env: { ...processSyncEnv() },
      });
      results.push({
        cmd,
        success: true,
        output: output.slice(0, 1000),
        durationMs: Date.now() - startTime,
      });
    } catch (err: any) {
      const stdout = err.stdout?.toString() ?? "";
      const stderr = err.stderr?.toString() ?? "";
      results.push({
        cmd,
        success: false,
        output: (stderr || stdout).slice(0, 1000),
        durationMs: Date.now() - startTime,
      });
    }
  }

  return {
    steps: results,
    allSucceeded: results.every((r) => r.success),
  };
}

function processSyncEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CI: "1", FORCE_COLOR: "0" };
}
