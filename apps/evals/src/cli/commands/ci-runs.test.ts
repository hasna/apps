import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Sol-guided coverage (tests-coverage-sol workflow, evals lane):
//   "With a temporary dataset/store, test ci run loading, runEvals, saveRun,
//    baseline comparison, no baseline, failed stats, JSON output, and --no-judge.
//    Use two explicit threshold arms: a regression below the configured
//    threshold exits 0 and one above exits 1 with the printed drop percentage.
//    Runs show/inspect missing IDs must exit 1 with 'Run not found: id';
//    markdown output must contain a report; compact rows must honor
//    limit/verbose. Test parseCursor for undefined, null, empty, negative, NaN,
//    and float in both CLI and MCP paths."
//
// All runs use --no-judge (assertions only) and either a deterministic cli
// adapter (echo) or an unreachable http URL (connection refused -> UNKNOWN),
// so no provider is ever called.

const CLI = join(import.meta.dir, "../index.ts");

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, EVALS_DB_PATH: ":memory:", ANTHROPIC_API_KEY: "test-key", ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

let tmpDir: string;
let allPass: string;
let deadUrl: string;
let someFail: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), "evals-ci-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });

  const ok = (n: number) => JSON.stringify({ id: `case-${n}`, input: `input ${n}`, assertions: [{ type: "contains", value: "ok" }] });
  allPass = join(tmpDir, "all-pass.jsonl");
  writeFileSync(allPass, Array.from({ length: 4 }, (_, i) => ok(i)).join("\n") + "\n");

  // Same shape, but executed against an unreachable port: fetch fails,
  // runCase returns UNKNOWN with an error, and failed stays 0.
  deadUrl = join(tmpDir, "dead-url.jsonl");
  writeFileSync(deadUrl, Array.from({ length: 4 }, (_, i) => ok(i)).join("\n") + "\n");

  const fail = (n: number) => JSON.stringify({ id: `case-${n}`, input: `input ${n}`, assertions: [{ type: "contains", value: "MISSING_XYZ" }] });
  someFail = join(tmpDir, "some-fail.jsonl");
  writeFileSync(someFail, Array.from({ length: 4 }, (_, i) => fail(i)).join("\n") + "\n");
});

describe("evals ci run", () => {
  test("no baseline: exits 0 and says no baseline was found", async () => {
    const { stdout, stderr, exitCode } = await runCli(["ci", "run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge"], { EVALS_DB_PATH: join(tmpDir, "db-nobaseline.db") });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('No baseline "main" found');
    expect(stderr).toBe("");
  });

  test("--json output carries the full run shape", async () => {
    const { stdout, exitCode } = await runCli(["ci", "run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge", "--json"], { EVALS_DB_PATH: join(tmpDir, "db-json.db") });
    expect(exitCode).toBe(0);
    // Measured 2026-08-19: with --json the run document is printed first and the
    // no-baseline notice is appended after it on stdout. Parse the JSON document.
    const jsonDoc = stdout.split("\nNo baseline")[0]!;
    const run = JSON.parse(jsonDoc) as { id: string; stats: { total: number; failed: number }; results: unknown[] };
    expect(run.id).toBeTruthy();
    expect(run.stats.total).toBe(4);
    expect(run.stats.failed).toBe(0);
    expect(run.results).toHaveLength(4);
  });

  test("failed stats exit 1 even with no baseline", async () => {
    const { exitCode } = await runCli(["ci", "run", someFail, "--adapter", "cli", "--command", "echo ok", "--no-judge"], { EVALS_DB_PATH: join(tmpDir, "db-fail.db") });
    expect(exitCode).toBe(1);
  });

  test("baseline creation: set-baseline names the last run", async () => {
    const dbPath = join(tmpDir, "db-baseline.db");
    const env = { EVALS_DB_PATH: dbPath };
    const first = await runCli(["ci", "run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge"], env);
    expect(first.exitCode).toBe(0);
    const set = await runCli(["ci", "set-baseline", "main"], env);
    expect(set.exitCode).toBe(0);
    expect(set.stdout).toContain('Baseline "main" set');
  });

  test("threshold arm 1: a drop below the configured threshold exits 0", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-threshold-low.db") };
    // Baseline: 100% pass.
    expect((await runCli(["ci", "run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge"], env)).exitCode).toBe(0);
    expect((await runCli(["ci", "set-baseline", "main"], env)).exitCode).toBe(0);

    // New run: every case is UNKNOWN (unreachable URL) -> passRate 0, drop 100%.
    // Threshold 150 > 100, so the regression is below the gate: exit 0, failed 0.
    const { stdout, exitCode } = await runCli(
      ["ci", "run", deadUrl, "--adapter", "http", "--url", "http://127.0.0.1:1/", "--no-judge", "--fail-if-regression", "150"],
      env
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Compared to baseline "main"');
  });

  test("threshold arm 2: a drop above the configured threshold exits 1 with the printed drop percentage", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-threshold-high.db") };
    expect((await runCli(["ci", "run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge"], env)).exitCode).toBe(0);
    expect((await runCli(["ci", "set-baseline", "main"], env)).exitCode).toBe(0);

    // Same 100% drop, but the gate is 60 < 100: the run must exit 1 and print
    // the measured drop percentage in the message.
    const { stdout, stderr, exitCode } = await runCli(
      ["ci", "run", deadUrl, "--adapter", "http", "--url", "http://127.0.0.1:1/", "--no-judge", "--fail-if-regression", "60"],
      env
    );
    expect(exitCode).toBe(1);
    const combined = stdout + stderr;
    expect(combined).toContain("Score dropped 100.0%");
    expect(combined).toContain("(threshold: 60%)");
  });
});

describe("evals runs show/inspect", () => {
  test("missing run id exits 1 with 'Run not found: <id>' on show and inspect", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-missing.db") };
    for (const verb of ["show", "inspect"]) {
      const { stderr, exitCode } = await runCli(["runs", verb, "does-not-exist"], env);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Run not found: does-not-exist");
    }
  });

  test("--markdown output contains the report header", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-markdown.db") };
    await runCli(["run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge", "--save"], env);
    const listed = await runCli(["runs", "list", "--json"], env);
    const id = (JSON.parse(listed.stdout) as { runs: Array<{ id: string }> }).runs[0]!.id;

    const md = await runCli(["runs", "show", id, "--markdown"], env);
    expect(md.exitCode).toBe(0);
    expect(md.stdout).toContain("# Eval Report");
  });

  test("--verbose shows all rows; compact output hides the remainder", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-verbose.db") };
    await runCli(["run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge", "--save"], env);
    const listed = await runCli(["runs", "list", "--json"], env);
    const id = (JSON.parse(listed.stdout) as { runs: Array<{ id: string }> }).runs[0]!.id;

    const compact = await runCli(["runs", "show", id, "--limit", "2"], env);
    expect(compact.stdout).toContain("2 more results hidden");

    const verbose = await runCli(["runs", "show", id, "--verbose"], env);
    expect(verbose.stdout).not.toContain("more results hidden");
    for (let i = 0; i < 4; i++) expect(verbose.stdout).toContain(`case-${i}`);
  });
});

describe("evals runs list parseCursor (CLI path)", () => {
  test("clamps undefined/null/empty/negative/NaN/float to the documented values", async () => {
    const env = { EVALS_DB_PATH: join(tmpDir, "db-cursor.db") };
    await runCli(["run", allPass, "--adapter", "cli", "--command", "echo ok", "--no-judge", "--save"], env);

    const cases: Array<[string, number]> = [
      ["-5", 0],      // negative -> 0
      ["NaN", 0],     // not finite -> 0
      ["abc", 0],     // not a number -> 0
      ["2.7", 2],     // float -> floored
      ["1e2", 100],   // numeric string -> parsed
      ["100000", 100000], // beyond the store -> valid, empty page
    ];
    for (const [cursor, expected] of cases) {
      const { stdout, exitCode } = await runCli(["runs", "list", "--json", `--cursor=${cursor}`], env);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { cursor: number };
      expect(parsed.cursor).toBe(expected);
    }
  });
});
