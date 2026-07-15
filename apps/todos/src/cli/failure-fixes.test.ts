import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const CWD = join(import.meta.dir, "../..");
const T = 30000; // generous per-test timeout: each case shells out to the CLI

let tmpDir: string;
let dbPath: string;
let fakeHome: string;

function run(args: string): string {
  return execSync(
    `bun run src/cli/index.tsx ${args}`,
    {
      encoding: "utf-8",
      cwd: CWD,
      timeout: 25000,
      env: localRoutingTestEnv({ HOME: fakeHome, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" }),
    },
  ).trim();
}

/** Run expecting a non-zero exit; returns combined stdout+stderr. */
function runExpectFail(args: string): { code: number; output: string } {
  try {
    execSync(
      `bun run src/cli/index.tsx ${args} 2>&1`,
      {
        encoding: "utf-8",
        cwd: CWD,
        timeout: 25000,
        env: localRoutingTestEnv({ HOME: fakeHome, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" }),
      },
    );
    return { code: 0, output: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, output: String(e.stdout || "") + String(e.stderr || "") };
  }
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-failure-fixes-"));
  dbPath = join(tmpDir, "test.db");
  fakeHome = join(tmpDir, "home");
  await mkdir(join(fakeHome, ".hasna", "todos"), { recursive: true });
  // Warm the DB/migrations once so per-test cold start doesn't dominate.
  run("count");
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("H1: global --json works on automation commands", () => {
  it("`--json next` emits JSON (global position, previously shadowed by local -j)", () => {
    const t = JSON.parse(run("add 'H1 next task' --json"));
    expect(t.id).toBeTruthy();
    const out = run("--json next");
    const parsed = JSON.parse(out);
    expect(parsed).not.toBeNull();
    expect(parsed.id).toBeTruthy();
  }, T);

  it("`--json status` emits JSON", () => {
    const out = run("--json status");
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("total");
  }, T);

  it("`--json active` emits a JSON array", () => {
    const out = run("--json active");
    expect(Array.isArray(JSON.parse(out))).toBe(true);
  }, T);

  it("`--json stale` emits a JSON array even when empty", () => {
    const out = run("--json stale");
    expect(Array.isArray(JSON.parse(out))).toBe(true);
  }, T);

  it("`--json next` emits JSON null when no task is available", () => {
    const out = execSync(
      `bun run src/cli/index.tsx --json next`,
      {
        encoding: "utf-8",
        cwd: CWD,
        timeout: 25000,
        env: localRoutingTestEnv({
          HOME: fakeHome,
          TODOS_DB_PATH: join(tmpDir, "empty.db"),
          TODOS_AUTO_PROJECT: "false",
        }),
      },
    ).trim();
    expect(JSON.parse(out)).toBeNull();
  }, T);
});

describe("H2: log-progress alias of comment", () => {
  it("`todos log-progress <id> <text> --json` records a comment", () => {
    const t = JSON.parse(run("add 'H2 progress task' --json"));
    const out = run(`--json log-progress ${t.id} "Investigating the issue"`);
    const comment = JSON.parse(out);
    expect(comment.content).toContain("Investigating");
    expect(comment.task_id).toBe(t.id);
  }, T);

  it("`--pct` is recorded in the comment content", () => {
    const t = JSON.parse(run("add 'H2 pct task' --json"));
    const out = run(`--json log-progress ${t.id} "halfway" --pct 50`);
    const comment = JSON.parse(out);
    expect(comment.content).toContain("50%");
  }, T);
});

describe("M5/L1: input validation instead of raw SQLite / NaN", () => {
  it("`add --status bogus` fails cleanly (no raw CHECK constraint error)", () => {
    const { code, output } = runExpectFail("add 'M5 bad status' --status bogus");
    expect(code).not.toBe(0);
    expect(output).toContain("--status must be one of");
    expect(output).not.toContain("CHECK constraint");
  }, T);

  it("`update -p bogus` fails cleanly", () => {
    const t = JSON.parse(run("add 'M5 update prio' --json"));
    const { code, output } = runExpectFail(`update ${t.id} -p bogus`);
    expect(code).not.toBe(0);
    expect(output).toContain("--priority must be one of");
  }, T);

  it("`done --confidence banana` is rejected (NaN not stored)", () => {
    const t = JSON.parse(run("add 'L1 confidence' --json"));
    run(`start ${t.id}`);
    const { code, output } = runExpectFail(`done ${t.id} --confidence banana`);
    expect(code).not.toBe(0);
    expect(output).toContain("--confidence must be a number");
  }, T);
});

describe("L3: update can clear the approval requirement", () => {
  it("--clear-approval removes requires_approval", () => {
    const t = JSON.parse(run("add 'L3 approval' --approval --json"));
    expect(t.requires_approval).toBe(true);
    const updated = JSON.parse(run(`--json update ${t.id} --clear-approval`));
    expect(updated.requires_approval).toBe(false);
  }, T);
});
