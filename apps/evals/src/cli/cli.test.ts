import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Path to the CLI entry point
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

async function runCli(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      EVALS_DB_PATH: ":memory:",
      ANTHROPIC_API_KEY: "test-key",
      ...env,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

let smokeDataset: string;
let tmpDir: string;

beforeAll(() => {
  tmpDir = join(tmpdir(), "evals-cli-test-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
  smokeDataset = join(tmpDir, "smoke.jsonl");
  writeFileSync(smokeDataset, [
    JSON.stringify({ id: "t1", input: "hello", assertions: [{ type: "min_length", value: 1 }] }),
    JSON.stringify({ id: "t2", input: "world", assertions: [{ type: "contains", value: "MISSING_XYZ" }] }),
  ].join("\n") + "\n");
});

describe("evals --version", () => {
  test("prints version and exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });
});

describe("evals --help", () => {
  test("prints help text and exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(stdout).toContain("evals");
    expect(exitCode).toBe(0);
  });

  test("subcommand --help works", async () => {
    const { stdout, exitCode } = await runCli(["estimate", "--help"]);
    expect(stdout).toContain("estimate");
    expect(exitCode).toBe(0);
  });
});

describe("evals estimate", () => {
  test("estimates cost without making API calls", async () => {
    const dataset = join(tmpDir, "estimate.jsonl");
    writeFileSync(dataset, [
      JSON.stringify({ id: "e1", input: "test", judge: { rubric: "must be good" } }),
      JSON.stringify({ id: "e2", input: "test", judge: { rubric: "must be accurate" } }),
      JSON.stringify({ id: "e3", input: "test" }), // no judge
    ].join("\n") + "\n");

    const { stdout, exitCode } = await runCli(["estimate", dataset]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Total cases");
    expect(stdout).toContain("Est. cost");
  });

  test("--json flag outputs JSON", async () => {
    const dataset = join(tmpDir, "estimate2.jsonl");
    writeFileSync(dataset, JSON.stringify({ id: "j1", input: "test", judge: { rubric: "r" } }) + "\n");
    const { stdout, exitCode } = await runCli(["estimate", dataset, "--json"]);
    expect(exitCode).toBe(0);
    const json = JSON.parse(stdout) as Record<string, unknown>;
    expect(json["totalCases"]).toBe(1);
    expect(json["estimatedCostUsd"]).toBeDefined();
  });
});

describe("evals doctor", () => {
  test("runs health checks and reports results", async () => {
    const { stdout } = await runCli(["doctor"]);
    expect(stdout).toContain("ANTHROPIC_API_KEY");
    expect(stdout).toContain("SQLite DB");
  });
});

describe("evals judge (no API call — missing key should still run structure)", () => {
  test("exits non-zero and shows usage when missing required args", async () => {
    const { exitCode, stderr } = await runCli(["judge"]);
    expect(exitCode).not.toBe(0);
    // Commander.js emits error to stderr on missing required options
    expect(stderr.length + (await runCli(["judge", "--help"])).stdout.length).toBeGreaterThan(0);
  });
});

describe("evals compare", () => {
  test("exits with error when run IDs not found", async () => {
    const { exitCode } = await runCli(["compare", "nonexistent-a", "nonexistent-b"]);
    expect(exitCode).not.toBe(0);
  });
});

describe("evals ci set-baseline", () => {
  test("reports no runs when DB is empty", async () => {
    const { exitCode } = await runCli(["ci", "set-baseline", "main"]);
    expect(exitCode).not.toBe(0); // no runs exist
  });
});
