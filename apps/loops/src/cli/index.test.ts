import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { CLI_SPAWN_TIMEOUT_MS } from "../test-timeout-policy.js";
import { executableExists, normalizeExecutionPath } from "../lib/env.js";
import { Store } from "../lib/store.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { applyControlPlanePush } from "../lib/migration.js";
import { RESTART_INTERRUPTED_RUN_PREFIX } from "../lib/health.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function hasArgSequence(args: string[], sequence: string[]): boolean {
  return args.some((_, index) => sequence.every((entry, offset) => args[index + offset] === entry));
}

function maybeAutoSourceTaskEnv(dataDir: string, args: string[], env: Record<string, string>): Record<string, string> {
  if (env.OPENLOOPS_TEST_DISABLE_AUTO_SOURCE_TASK) return {};
  if (args.includes("--dry-run")) return {};
  const isTodosTaskCreate =
    hasArgSequence(args, ["events", "handle", "todos-task"]) ||
    hasArgSequence(args, ["routes", "create", "todos-task"]);
  if (!isTodosTaskCreate) return {};
  const binDir = join(dataDir, "auto-source-task-bin");
  mkdirSync(binDir, { recursive: true });
  const todosBin = join(binDir, "todos");
  writeFileSync(
    todosBin,
    [
      "#!/usr/bin/env bash",
      "for arg in \"$@\"; do",
      "  if [[ \"$arg\" == \"inspect\" ]]; then",
      "    task_id=\"${@: -1}\"",
      "    printf '{\"id\":\"%s\",\"title\":\"CLI route source task\",\"status\":\"pending\",\"tags\":[\"auto:route\"]}' \"$task_id\"",
      "    exit 0",
      "  fi",
      "done",
      "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(todosBin, 0o755);
  return { PATH: `${binDir}:${env.PATH ?? process.env.PATH ?? ""}` };
}

/**
 * Spawn options for a CLI subprocess, including the hard per-spawn ceiling
 * that replaces the old per-test wall-clock kill. Split out from runCli so the
 * timeout is stated once rather than buried in a call site.
 */
function cliSpawnOptions(
  dataDir: string,
  args: string[],
  input?: string,
  env: Record<string, string> = {},
) {
  const isolatedEnv = {
    HASNA_LOOPS_API_URL: "",
    HASNA_LOOPS_API_KEY: "",
    LOOPS_MACHINE_ID: "cli-test-machine",
  };
  const autoSourceTaskEnv = maybeAutoSourceTaskEnv(dataDir, args, env);
  return {
    env: { ...process.env, ...isolatedEnv, ...env, ...autoSourceTaskEnv, LOOPS_DATA_DIR: dataDir },
    input,
    encoding: "utf8" as const,
    timeout: CLI_SPAWN_TIMEOUT_MS,
  };
}

function runCli(dataDir: string, args: string[], input?: string, env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], cliSpawnOptions(dataDir, args, input, env));
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    // Name the command that hung. "this test timed out after 5000ms" told you
    // nothing about which of a test's spawns was responsible.
    throw new Error(
      `loops CLI invocation exceeded ${CLI_SPAWN_TIMEOUT_MS}ms and was killed: loops ${args.join(" ")}`,
    );
  }
  return result;
}

function storedLoop(dataDir: string, id: string) {
  const store = new Store(join(dataDir, "loops.db"));
  try {
    return store.getLoop(id);
  } finally {
    store.close();
  }
}

function storedWorkflow(dataDir: string, id: string) {
  const store = new Store(join(dataDir, "loops.db"));
  try {
    return store.getWorkflow(id);
  } finally {
    store.close();
  }
}

function storedWorkItem(dataDir: string, id: string) {
  const store = new Store(join(dataDir, "loops.db"));
  try {
    return store.getWorkflowWorkItem(id);
  } finally {
    store.close();
  }
}

function storedInvocation(dataDir: string, id: string) {
  const store = new Store(join(dataDir, "loops.db"));
  try {
    return store.getWorkflowInvocation(id);
  } finally {
    store.close();
  }
}

function privateCommandArgs(dataDir: string, publicLoop: { id: string; target: Record<string, unknown> }): string[] {
  expect(publicLoop.target.args).toBeUndefined();
  expect(publicLoop.target.operationTemplateId).toEqual(expect.stringMatching(/^op-template:sha256:/));
  const loop = storedLoop(dataDir, publicLoop.id);
  if (loop?.target.type !== "command") throw new Error(`expected private command target for ${publicLoop.id}`);
  return loop.target.args ?? [];
}

function isolatedRouteEnv(dataDir: string, env: Record<string, string> = {}): Record<string, string> {
  const eventsDir = join(dataDir, "events");
  const todosDbPath = join(dataDir, "todos", "todos.db");
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(dirname(todosDbPath), { recursive: true });
  return { HASNA_EVENTS_DIR: eventsDir, TODOS_DB_PATH: todosDbPath, LOOPS_LOOP_NAME: "", ...env };
}

function fakeTodosReadyBin(dataDir: string): string {
  const binDir = join(dataDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const todosBin = join(binDir, "todos");
  writeFileSync(
    todosBin,
    [
      "#!/usr/bin/env bash",
      "for arg in \"$@\"; do",
      "  if [[ \"$arg\" == \"--version\" ]]; then printf 'fake-todos\\n'; exit 0; fi",
      "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
      "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
      "done",
      "printf 'fake todos did not handle: %s\\n' \"$*\" >&2",
      "exit 2",
      "",
    ].join("\n"),
  );
  chmodSync(todosBin, 0o755);
  return binDir;
}

let templateDb: string | undefined;

/**
 * mkdtemp a CLI data dir pre-seeded with an already-migrated loops.db so each
 * test skips the fresh-database migration cost inside its first CLI spawn.
 * The template database is built once per suite run by a real CLI invocation,
 * so seeded dirs are byte-identical to what that first spawn would create.
 */
function freshDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  if (!templateDb) {
    const templateDir = mkdtempSync(join(tmpdir(), "loops-cli-template-db-"));
    const init = runCli(templateDir, ["--json", "list"]);
    if (init.status !== 0) throw new Error(`failed to initialize template loops.db: ${init.stderr}`);
    templateDb = join(templateDir, "loops.db");
  }
  const db = join(dir, "loops.db");
  copyFileSync(templateDb, db);
  chmodSync(db, 0o600);
  return dir;
}

function workflowFile(dataDir: string, body: unknown): string {
  const file = join(dataDir, "workflow.json");
  writeFileSync(file, JSON.stringify(body));
  return file;
}

function futureAt(): string {
  return new Date(Date.now() + 60_000).toISOString();
}

/**
 * Whether a provider binary resolves through the CLI subprocess's normalized
 * execution PATH (subprocess env + home dirs + homebrew). The negative
 * create-agent preflight test below pins that preflight fails closed BEFORE
 * storing when the provider binary is missing — a premise only establishable
 * on machines without that binary, because normalizeExecutionPath appends
 * ~/.local/bin, ~/.bun/bin, and /opt/homebrew/bin to every execution PATH, so
 * a machine that has the binary there cannot construct the negative case
 * (preflight legitimately passes). Mirrors standaloneAgentResolvable in
 * executor.test.ts.
 */
function providerBinaryResolvable(binary: string, env: Record<string, string>): boolean {
  const subprocessEnv = { ...process.env, ...env };
  return executableExists(binary, { ...subprocessEnv, PATH: normalizeExecutionPath(subprocessEnv) });
}

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  expect(result.status).toBe(0);
}

function createGitRepoIn(parent: string, prefix: string): string {
  const repo = mkdtempSync(join(parent, prefix));
  git(repo, ["init"]);
  git(repo, ["config", "user.email", "loops-test@example.com"]);
  git(repo, ["config", "user.name", "Loops Test"]);
  writeFileSync(join(repo, "README.md"), "# test\n");
  git(repo, ["add", "README.md"]);
  git(repo, ["commit", "-m", "init"]);
  return repo;
}

function createGitRepo(prefix: string): string {
  return createGitRepoIn(tmpdir(), prefix);
}

function testPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function testPaths(paths: string[]): string[] {
  return paths.map(testPath);
}

type TestWorkflowStep = { id?: string; target: Record<string, any>; [key: string]: any };

function agentStepsOf(workflow: { steps: TestWorkflowStep[] }): TestWorkflowStep[] {
  return workflow.steps.filter((step) => step.target.type === "agent");
}

function authProfilesOf(workflow: { steps: TestWorkflowStep[] }): string[] {
  return agentStepsOf(workflow)
    .map((step) => step.target.authProfile as string | undefined)
    .filter((profile: string | undefined): profile is string => Boolean(profile));
}


describe("loops CLI machine assignment", () => {
  // @hasna/machines was deleted (owner directive, 2026-09-03); the routing
  // consumer is no longer installable, so every --machine pin fails loudly
  // with the unavailable error and stores nothing.
  test("create with --machine fails loudly and stores nothing (machines deleted)", () => {
    const dataDir = freshDataDir("loops-cli-machine-pin-");
    const create = runCli(
      dataDir,
      ["--json", "create", "command", "pinned", "--at", futureAt(), "--cmd", "true", "--machine", "cli-pin-test-machine"],
    );
    expect(create.status).not.toBe(0);
    expect(create.stderr + create.stdout).toContain("@hasna/machines has been deleted");
    const listed = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout) as Array<{ name: string }>;
    expect(listed.map((loop) => loop.name)).not.toContain("pinned");
  });

  test("create with an unresolvable --machine fails loudly and stores nothing", () => {
    const dataDir = freshDataDir("loops-cli-machine-bad-");
    const create = runCli(
      dataDir,
      ["--json", "create", "command", "never-stored", "--at", futureAt(), "--cmd", "true", "--machine", "cli-no-such-machine-zz9"],
    );
    expect(create.status).not.toBe(0);
    expect(create.stderr + create.stdout).toContain("@hasna/machines has been deleted");
    const listed = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout) as Array<{ name: string }>;
    expect(listed.map((loop) => loop.name)).not.toContain("never-stored");
  });
});

describe("loops CLI", () => {
  test("create/list/show/runs support labels and labels set/add/remove/clear", () => {
    const dataDir = freshDataDir("loops-cli-labels-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "browser",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--label",
      "BrowserPlan",
      "--label",
      "nightly",
    ]);
    expect(create.status).toBe(0);
    expect(JSON.parse(create.stdout).labels).toEqual(["browserplan", "nightly"]);

    expect(JSON.parse(runCli(dataDir, ["--json", "show", "browser"]).stdout).labels).toEqual([
      "browserplan",
      "nightly",
    ]);
    expect(
      JSON.parse(runCli(dataDir, ["--json", "list", "--label", "browserplan", "--label", "nightly"]).stdout).map(
        (loop: { name: string }) => loop.name,
      ),
    ).toEqual(["browser"]);

    expect(runCli(dataDir, ["--json", "run-now", "browser"]).status).toBe(0);
    expect(
      (JSON.parse(runCli(dataDir, ["--json", "runs", "--label", "browserplan"]).stdout) as {
        runs: Array<{ loopName: string }>;
      }).runs.map((run: { loopName: string }) => run.loopName),
    ).toEqual(["browser"]);

    expect(JSON.parse(runCli(dataDir, ["--json", "labels", "add", "browser", "urgent"]).stdout).labels).toEqual([
      "browserplan",
      "nightly",
      "urgent",
    ]);
    expect(JSON.parse(runCli(dataDir, ["--json", "labels", "remove", "browser", "nightly"]).stdout).labels).toEqual([
      "browserplan",
      "urgent",
    ]);
    expect(JSON.parse(runCli(dataDir, ["--json", "labels", "set", "browser", "BrowserPlan"]).stdout).labels).toEqual([
      "browserplan",
    ]);
    expect(JSON.parse(runCli(dataDir, ["--json", "labels", "clear", "browser"]).stdout).labels).toEqual([]);
  });

  test("runs --json emits a pagination envelope and --offset enumerates past the 1000-row page cap (LOO3-00143)", () => {
    const dataDir = freshDataDir("loops-cli-runs-envelope-");
    const create = runCli(dataDir, ["--json", "create", "command", "bulk", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const loopId = (JSON.parse(create.stdout) as { id: string }).id;

    // Bulk-insert >1000 runs directly in one transaction (the hosted control
    // plane clamps a list page at 1000; the local store passes the limit
    // through, so this simulates a population larger than one clamped page).
    const db = new Database(join(dataDir, "loops.db"));
    const insertRun = db.query(
      `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at, exit_code, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'succeeded', ?, ?, 0, 1, ?, ?)`,
    );
    db.exec("BEGIN");
    const base = Date.UTC(2024, 0, 1);
    for (let i = 0; i < 1010; i += 1) {
      const createdAt = new Date(base + i * 1000).toISOString();
      insertRun.run(`bulk-run-${String(i).padStart(4, "0")}`, loopId, "bulk", createdAt, createdAt, createdAt, createdAt, createdAt);
    }
    db.exec("COMMIT");
    db.close();

    type RunsEnvelope = { runs: Array<{ id: string }>; count: number; has_more: boolean; next_offset: number };

    // First page fills the requested page, so has_more must be true and the
    // response must be an envelope, not the bare array the CLI used to emit.
    const page1 = JSON.parse(runCli(dataDir, ["--json", "runs", "--limit", "500"]).stdout) as RunsEnvelope;
    expect(Array.isArray(page1)).toBe(false);
    expect(page1.runs).toHaveLength(500);
    expect(page1.count).toBe(1010);
    expect(page1.has_more).toBe(true);
    expect(page1.next_offset).toBe(500);

    // Second page via --offset.
    const page2 = JSON.parse(runCli(dataDir, ["--json", "runs", "--limit", "500", "--offset", "500"]).stdout) as RunsEnvelope;
    expect(page2.runs).toHaveLength(500);
    expect(page2.has_more).toBe(true);
    expect(page2.next_offset).toBe(1000);

    // Third page reaches past the 1000-row boundary the hosted API clamps at —
    // the exact population that was previously unreachable with a silent floor.
    const page3 = JSON.parse(runCli(dataDir, ["--json", "runs", "--limit", "500", "--offset", "1000"]).stdout) as RunsEnvelope;
    expect(page3.runs).toHaveLength(10);
    expect(page3.has_more).toBe(false);
    // next_offset only advances while has_more (LOO3-00143 P1): exhausted page
    // stays at the current offset instead of advertising a further page.
    expect(page3.next_offset).toBe(1000);

    // The three pages are disjoint and cover the whole population.
    const ids = [...page1.runs, ...page2.runs, ...page3.runs].map((run) => run.id);
    expect(new Set(ids).size).toBe(1010);

    // Requesting more than exists returns the full set with has_more=false
    // (positive control: has_more is false when the full set fits).
    const full = JSON.parse(runCli(dataDir, ["--json", "runs", "--limit", "1500"]).stdout) as RunsEnvelope;
    expect(full.runs).toHaveLength(1010);
    expect(full.has_more).toBe(false);
    expect(full.next_offset).toBe(0); // no advance while has_more is false
  });

  test("runs --json envelope count reflects the FILTERED loop population, not the global run table (LOO3-00143 P1)", () => {
    const dataDir = freshDataDir("loops-cli-runs-envelope-filtered-");
    const createAlpha = runCli(dataDir, ["--json", "create", "command", "alpha", "--at", futureAt(), "--cmd", "true"]);
    const createBeta = runCli(dataDir, ["--json", "create", "command", "beta", "--at", futureAt(), "--cmd", "true"]);
    expect(createAlpha.status).toBe(0);
    expect(createBeta.status).toBe(0);
    const alphaId = (JSON.parse(createAlpha.stdout) as { id: string }).id;
    const betaId = (JSON.parse(createBeta.stdout) as { id: string }).id;

    // loop B (beta) has 5 runs; the DB holds 1015 total. count must be the
    // FILTERED population (5), never the global 1015 — the exact repro from
    // the cycle-1 NO_GO (count came from the unfiltered global run table, so
    // has_more stayed true forever after the filtered set was exhausted).
    const db = new Database(join(dataDir, "loops.db"));
    const insertRun = db.query(
      `INSERT INTO loop_runs (id, loop_id, loop_name, scheduled_for, attempt, status, started_at, finished_at, exit_code, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'succeeded', ?, ?, 0, 1, ?, ?)`,
    );
    db.exec("BEGIN");
    const base = Date.UTC(2024, 0, 1);
    let i = 0;
    for (; i < 1010; i += 1) {
      const createdAt = new Date(base + i * 1000).toISOString();
      insertRun.run(`alpha-run-${String(i).padStart(4, "0")}`, alphaId, "alpha", createdAt, createdAt, createdAt, createdAt, createdAt);
    }
    for (let j = 0; j < 5; j += 1, i += 1) {
      const createdAt = new Date(base + i * 1000).toISOString();
      insertRun.run(`beta-run-${String(j).padStart(4, "0")}`, betaId, "beta", createdAt, createdAt, createdAt, createdAt, createdAt);
    }
    db.exec("COMMIT");
    db.close();

    type RunsEnvelope = { runs: Array<{ id: string }>; count: number; has_more: boolean; next_offset: number };

    // The unfiltered listing still reports the global population.
    const global = JSON.parse(runCli(dataDir, ["--json", "runs"]).stdout) as RunsEnvelope;
    expect(global.count).toBe(1015);

    // page1 filtered to loop B: all 5 of B's runs fit on the page, so count
    // == 5 (NOT 1015) and has_more is FALSE — the buggy unfiltered count kept
    // has_more true here.
    const page1 = JSON.parse(runCli(dataDir, ["--json", "runs", "beta"]).stdout) as RunsEnvelope;
    expect(page1.runs).toHaveLength(5);
    expect(page1.count).toBe(5);
    expect(page1.has_more).toBe(false);
    expect(page1.next_offset).toBe(0); // no advance while has_more is false

    // page2 past the filtered set: runs empty, count still 5, has_more FALSE —
    // the 'has_more stays true forever' symptom is gone.
    const page2 = JSON.parse(runCli(dataDir, ["--json", "runs", "beta", "--offset", "5"]).stdout) as RunsEnvelope;
    expect(page2.runs).toHaveLength(0);
    expect(page2.count).toBe(5);
    expect(page2.has_more).toBe(false);
    expect(page2.next_offset).toBe(5); // no advance: the filtered set is exhausted

    // A genuinely truncated page DOES set has_more true and next_offset advances.
    const page1t = JSON.parse(runCli(dataDir, ["--json", "runs", "beta", "--limit", "2"]).stdout) as RunsEnvelope;
    expect(page1t.runs).toHaveLength(2);
    expect(page1t.count).toBe(5);
    expect(page1t.has_more).toBe(true);
    expect(page1t.next_offset).toBe(2);
    const page2t = JSON.parse(runCli(dataDir, ["--json", "runs", "beta", "--limit", "2", "--offset", "2"]).stdout) as RunsEnvelope;
    expect(page2t.runs).toHaveLength(2);
    expect(page2t.count).toBe(5);
    expect(page2t.has_more).toBe(true);
    expect(page2t.next_offset).toBe(4);
    const page3t = JSON.parse(runCli(dataDir, ["--json", "runs", "beta", "--limit", "2", "--offset", "4"]).stdout) as RunsEnvelope;
    expect(page3t.runs).toHaveLength(1);
    expect(page3t.count).toBe(5);
    expect(page3t.has_more).toBe(false);
    expect(page3t.next_offset).toBe(4); // exhausted: no advance
  });

  test("runs --json envelope reports the full set fits and accepts --offset 0 (LOO3-00143)", () => {
    const dataDir = freshDataDir("loops-cli-runs-envelope-small-");
    const create = runCli(dataDir, ["--json", "create", "command", "small", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    expect(runCli(dataDir, ["--json", "run-now", "small"]).status).toBe(0);

    type RunsEnvelope = { runs: Array<{ id: string }>; count: number; has_more: boolean; next_offset: number };
    const parsed = JSON.parse(runCli(dataDir, ["--json", "runs"]).stdout) as RunsEnvelope;
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.count).toBe(1);
    expect(parsed.has_more).toBe(false);
    expect(parsed.next_offset).toBe(0); // no advance while has_more is false

    // An explicit offset of 0 is a legal offset and yields the same first page.
    const fromZero = JSON.parse(runCli(dataDir, ["--json", "runs", "--offset", "0"]).stdout) as RunsEnvelope;
    expect(fromZero.runs).toHaveLength(1);
    expect(fromZero.next_offset).toBe(0);

    // A negative offset is rejected.
    const bad = runCli(dataDir, ["--json", "runs", "--offset", "-1"]);
    expect(bad.status).not.toBe(0);
  });

  test("show surfaces unserved execution state for a machine-pinned loop no runner serves (BUG 96c837b0)", () => {
    const dataDir = freshDataDir("loops-cli-unserved-");
    const past = new Date(Date.now() - 20 * 60_000).toISOString();
    const store = new Store(join(dataDir, "loops.db"));
    const created = store.createLoop(
      {
        name: "pinned-cli",
        machine: { id: "station02", route: "local", local: true, confidence: "exact" },
        schedule: { type: "once", at: past },
        target: { type: "command", command: "true" },
      },
      new Date(Date.now() - 20 * 60_000),
    );
    store.close();
    // The store stamps createdAt with wall-clock now regardless of `from`, so
    // backdate the row to put the loop past the overdue grace at show time.
    new Database(join(dataDir, "loops.db")).run(
      "UPDATE loops SET created_at = ? WHERE id = ?",
      [past, created.id],
    );

    const show = runCli(dataDir, ["--json", "show", "pinned-cli"]);
    expect(show.status).toBe(0);
    const parsed = JSON.parse(show.stdout) as { execution?: { state?: string; reason?: string } };
    expect(parsed.execution).toMatchObject({ state: "unserved" });
    expect(parsed.execution?.reason).toContain("station02");
    expect(show.stderr).toContain("UNSERVED");
  });

  test("reports the package version", () => {
    const dataDir = freshDataDir("loops-cli-version-");
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    const version = runCli(dataDir, ["--version"]);

    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);

    const daemonVersion = spawnSync(process.execPath, [join(dirname(cliPath), "../daemon/index.ts"), "--version"], {
      env: { ...process.env, LOOPS_DATA_DIR: dataDir },
      encoding: "utf8",
    });
    expect(daemonVersion.status).toBe(0);
    expect(daemonVersion.stdout.trim()).toBe(pkg.version);
  });

  test("list --json includes latest run summaries for active duplicate-name loops", () => {
    const dataDir = freshDataDir("loops-cli-list-latest-run-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const paused = store.createLoop(
        {
          name: "duplicate-router",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      store.updateLoop(paused.id, { status: "paused" });
      const active = store.createLoop(
        {
          name: "duplicate-router",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:01Z"),
      );
      const claim = store.claimRun(active, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(claim!.run.id, {
        status: "succeeded",
        finishedAt: "2026-01-01T00:00:03.000Z",
        durationMs: 3_000,
        stdout: "",
        stderr: "",
      });
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "list", "--all"]);
    expect(result.status).toBe(0);
    const loops = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    const activeListed = loops.find((loop) => loop.name === "duplicate-router" && loop.status === "active");
    const pausedListed = loops.find((loop) => loop.name === "duplicate-router" && loop.status === "paused");
    expect(activeListed?.latestRunStatus).toBe("succeeded");
    expect(activeListed?.latestRunId).toEqual(expect.any(String));
    expect(activeListed?.lastRunAt).toBe("2026-01-01T00:00:03.000Z");
    expect(pausedListed?.latestRunId).toBeUndefined();
  });

  test("receipts write/read/list expose bounded JSON receipts", () => {
    const dataDir = freshDataDir("loops-cli-receipts-");
    const input = {
      loop_id: "loop-cli",
      run_id: "run-cli",
      machine: "spark01",
      repo: "/workspace/open-loops",
      task_ids: ["task-cli"],
      knowledge_ids: ["knowledge-cli"],
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:00:01Z",
      status: "succeeded",
      exit_code: 0,
      summary: "cli receipt",
      evidence_paths: ["/tmp/receipt.json"],
      stdout: "x".repeat(50_000),
    };

    const write = runCli(dataDir, ["--json", "receipts", "write", "--file", "-"], JSON.stringify(input));
    expect(write.status).toBe(0);
    const written = JSON.parse(write.stdout) as {
      run_id: string;
      digest_id: string;
      result_ref: string;
      summary: { stdout_bytes: number; stderr_bytes: number };
    };
    expect(written.run_id).toBe("run-cli");
    expect(written.digest_id).toMatch(/^sha256:/);
    expect(written.result_ref).toBe(written.digest_id);
    expect(written.summary.stdout_bytes).toBe(50_000);
    expect(written.summary.stderr_bytes).toBe(0);
    expect(written.summary).not.toHaveProperty("stdout_excerpt");
    expect(written).not.toHaveProperty("machine");
    expect(written).not.toHaveProperty("evidence_paths");

    const read = runCli(dataDir, ["--json", "receipts", "read", "run-cli"]);
    expect(read.status).toBe(0);
    const readValue = JSON.parse(read.stdout);
    expect(readValue).toMatchObject({
      run_id: "run-cli",
      result_ref: written.digest_id,
      summary: { stdout_bytes: 50_000, stderr_bytes: 0 },
    });
    expect(readValue.summary).not.toHaveProperty("text");
    expect(readValue).not.toHaveProperty("machine");
    expect(readValue).not.toHaveProperty("evidence_paths");

    const list = runCli(dataDir, ["--json", "receipts", "list", "--task-id", "task-cli"]);
    expect(list.status).toBe(0);
    const receipts = JSON.parse(list.stdout) as Array<{ run_id: string }>;
    expect(receipts.map((receipt) => receipt.run_id)).toEqual(["run-cli"]);
  });

  test("reports the sqlite file connection by default", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-status-file-"));
    const status = runCli(dataDir, ["--json", "status"], undefined, {
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_DATABASE_URL: "",
    });

    expect(status.status).toBe(0);
    const value = JSON.parse(status.stdout);
    expect(value.storage).toBe("sqlite");
    expect(value.connection).toBe("file");
    expect(value.configured).toBe(true);
    expect(value.apiKeyPresent).toBe(false);
    expect(value.databaseUrlPresent).toBe(false);
    expect(value.warnings).toEqual([]);
    expect(status.stdout).not.toContain("dataDir");
    expect(status.stdout).not.toContain("dbPath");

    const human = runCli(dataDir, ["status"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("storage=sqlite connection=file");
  });

  test("reports api connection details without exposing tokens", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-status-api-"));
    const api = runCli(dataDir, ["--json", "status"], undefined, {
      HASNA_LOOPS_API_URL: "http://127.0.0.1:8787",
      HASNA_LOOPS_API_KEY: "do-not-print-this-token",
    });
    expect(api.status).toBe(0);
    expect(api.stdout).not.toContain("do-not-print-this-token");
    expect(JSON.parse(api.stdout)).toMatchObject({
      storage: "sqlite",
      connection: "api",
      apiUrl: "http://127.0.0.1:8787",
      apiKeyPresent: true,
      databaseUrlPresent: false,
      configured: true,
    });

    const example = runCli(dataDir, ["--json", "status"], undefined, {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "do-not-print-this-cloud-token",
    });
    expect(example.status).toBe(0);
    expect(example.stdout).not.toContain("do-not-print-this-cloud-token");
    const exampleValue = JSON.parse(example.stdout);
    expect(exampleValue).toMatchObject({
      storage: "sqlite",
      connection: "api",
      apiUrl: "https://loops.example.test",
      apiKeyPresent: true,
      configured: true,
    });
    expect(exampleValue.warnings).toEqual([]);
    expect(example.stdout).not.toContain("dataDir");
    expect(example.stdout).not.toContain("dbPath");

    const human = runCli(dataDir, ["status"], undefined, {
      HASNA_LOOPS_API_URL: "https://loops.example.test",
      HASNA_LOOPS_API_KEY: "do-not-print-this-cloud-token",
    });
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("storage=sqlite connection=api");
    expect(human.stdout).not.toContain("do-not-print-this-cloud-token");
  });

  test("exports and imports id-preserving migration bundles idempotently", () => {
    const sourceDir = freshDataDir("loops-cli-export-source-");
    const targetDir = freshDataDir("loops-cli-export-target-");
    const bundleFile = join(sourceDir, "loops-export.json");
    let workflowId = "";
    let loopId = "";
    let runId = "";
    const store = new Store(join(sourceDir, "loops.db"));
    try {
      const workflow = store.createWorkflow({
        name: "migration-workflow",
        steps: [{ id: "one", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "migration-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "printf", args: ["migrated"] },
      });
      const claim = store.claimRun(loop, loop.nextRunAt!, "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      const run = store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "migrated",
          stderr: "",
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:01Z") },
      );
      workflowId = workflow.id;
      loopId = loop.id;
      runId = run.id;
    } finally {
      store.close();
    }

    const dryRunFile = join(sourceDir, "dry-run-export.json");
    const exportDryRun = runCli(sourceDir, ["--json", "export", "--file", dryRunFile, "--dry-run"]);
    expect(exportDryRun.status).toBe(0);
    expect(JSON.parse(exportDryRun.stdout)).toMatchObject({ ok: true, dryRun: true, file: dryRunFile });
    expect(existsSync(dryRunFile)).toBe(false);

    const exported = runCli(sourceDir, ["--json", "export", "--file", bundleFile]);
    expect(exported.status).toBe(0);
    const exportedValue = JSON.parse(exported.stdout);
    expect(exportedValue.bundle.importable).toBe(true);
    expect(existsSync(bundleFile)).toBe(true);

    const dryRun = runCli(targetDir, ["--json", "import", bundleFile]);
    expect(dryRun.status).toBe(0);
    const plan = JSON.parse(dryRun.stdout);
    expect(plan.summary).toMatchObject({ insert: 3, conflict: 0, blocked: 0, workflows: 1, loops: 1, runs: 1 });

    const applied = runCli(targetDir, ["--json", "import", bundleFile, "--apply"]);
    expect(applied.status).toBe(0);
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.applied).toEqual({ workflows: 1, loops: 1, runs: 1 });
    expect(appliedValue.backupPath).toBeString();

    const secondDryRun = runCli(targetDir, ["--json", "import", bundleFile]);
    expect(secondDryRun.status).toBe(0);
    expect(JSON.parse(secondDryRun.stdout).summary).toMatchObject({ insert: 0, skip: 3, conflict: 0, blocked: 0 });

    const imported = new Store(join(targetDir, "loops.db"));
    try {
      expect(imported.getWorkflow(workflowId)?.name).toBe("migration-workflow");
      expect(imported.getLoop(loopId)?.name).toBe("migration-loop");
      expect(imported.getRun(runId)?.status).toBe("succeeded");
    } finally {
      imported.close();
    }
  });

  test("export refuses redacted env bundles unless explicitly allowed", () => {
    const dataDir = freshDataDir("loops-cli-export-redacted-");
    const bundleFile = join(dataDir, "redacted-export.json");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      store.createLoop({
        name: "env-loop",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: { type: "command", command: "env", env: { PRIVATE_TOKEN: "very-secret-value" } },
      });
    } finally {
      store.close();
    }

    const refused = runCli(dataDir, ["--json", "export", "--file", bundleFile]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("not no-loss");
    expect(existsSync(bundleFile)).toBe(false);

    const allowed = runCli(dataDir, ["--json", "export", "--file", bundleFile, "--allow-redacted"]);
    expect(allowed.status).toBe(0);
    const bundle = JSON.parse(readFileSync(bundleFile, "utf8"));
    expect(bundle.importable).toBe(false);
    expect(JSON.stringify(bundle)).toContain("[redacted]");
    expect(JSON.stringify(bundle)).not.toContain("very-secret-value");
  });

  test("export --dry-run previews a bundle without --file", () => {
    const dataDir = freshDataDir("loops-cli-export-dry-run-nofile-");
    const create = runCli(dataDir, ["create", "command", "preview-loop", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const preview = runCli(dataDir, ["--json", "export", "--dry-run"]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value).toMatchObject({ ok: true, dryRun: true, file: null });
    expect(value.bundle).toBeDefined();

    // without --dry-run, --file remains required
    const missing = runCli(dataDir, ["--json", "export"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--file");
  });

  test("migrate preview reports blocked unsupported rows without tokens", () => {
    const dataDir = freshDataDir("loops-cli-migrate-");
    const create = runCli(dataDir, ["create", "command", "remote-loop", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const preview = runCli(dataDir, ["--json", "migrate", "--dry-run"], undefined, {
      HASNA_LOOPS_API_KEY: "do-not-print-this-token",
    });
    expect(preview.status).toBe(0);
    expect(preview.stdout).not.toContain("do-not-print-this-token");
    const plan = JSON.parse(preview.stdout);
    expect(plan.operation).toBe("migrate");
    expect(plan.dryRun).toBe(true);
    expect(plan.importable).toBe(false);
    expect(plan.summary.blocked).toBeGreaterThan(0);
    expect(plan.warnings.join(" ")).toContain("HASNA_LOOPS_API_URL");

    for (const command of ["push", "pull"]) {
      const documented = runCli(dataDir, ["--json", command, "--dry-run"]);
      expect(documented.status).toBe(0);
      expect(JSON.parse(documented.stdout).operation).toBe(command);
    }
  });

  test("control-plane push applies id-preserving definitions paused/disabled and writes a manifest", async () => {
    const mod = await import("../api/index.js");
    const sourceDir = freshDataDir("loops-cli-push-source-");
    const remoteStorage = createSqliteLoopStorage(":memory:");
    const principal = {
      tenantId: "tenant-test", principalId: "principal-test", requestId: "request-test",
      kid: "kid-test", agent: "principal-test", scopes: ["loops:import"],
      roles: ["admin" as const], tokenKind: "api_key" as const,
      claims: { v: 1, kid: "kid-test", app: "loops", agent: "principal-test", scopes: ["loops:import"], iat: 1, exp: null },
    };
    const server = mod.createLoopsApiServer({
      host: "127.0.0.1",
      port: 0,
      authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
      withTenantStorage: (_principal, fn) => fn(remoteStorage),
    });
    let workflowId = "";
    let loopId = "";

    const source = new Store(join(sourceDir, "loops.db"));
    try {
      const workflow = source.createWorkflow({
        name: "push-workflow",
        steps: [{ id: "one", target: { type: "command", command: "true" } }],
      });
      const loop = source.createLoop({
        name: "push-loop",
        schedule: { type: "once", at: futureAt() },
        target: { type: "workflow", workflowId: workflow.id },
      });
      workflowId = workflow.id;
      loopId = loop.id;
      expect(loop.status).toBe("active");
    } finally {
      source.close();
    }

    try {
      const source = new Store(join(sourceDir, "loops.db"));
      const output = await applyControlPlanePush(source, {
        apiUrl: `http://${server.hostname}:${server.port}`,
        apiKey: "test-token",
        includeRuns: false,
      });
      source.close();
      expect(output.ok).toBe(true);
      expect(output.manifest.safety).toMatchObject({
        forcedLoopStatus: "paused",
        clearedLoopRunPointers: true,
        forcedWorkflowStatus: "archived",
        resumesLoops: false,
      });

      const manifest = output.manifest;
      expect(manifest.missingIds.workflows).toEqual([workflowId]);
      expect(manifest.missingIds.loops).toEqual([loopId]);
      expect(manifest.counts.applied).toMatchObject({ workflows: 1, loops: 1, runs: 0 });
      expect(manifest.rollback.notes.join(" ")).toContain("manual");

      const remoteWorkflow = await remoteStorage.getWorkflow(workflowId);
      expect(remoteWorkflow?.status).toBe("archived");
      const remoteLoop = await remoteStorage.getLoop(loopId);
      expect(remoteLoop?.status).toBe("paused");
      expect(remoteLoop?.nextRunAt).toBeUndefined();
      expect(remoteLoop?.retryScheduledFor).toBeUndefined();
    } finally {
      server.stop(true);
      await remoteStorage.close();
    }
  });

  test("compiled CLI reports the package version", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-cli-compiled-version-"));
    const outfile = join(root, "loops");
    const build = spawnSync("bun", ["build", cliPath, "--compile", "--outfile", outfile], { encoding: "utf8" });
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

    expect(build.status).toBe(0);
    const version = spawnSync(outfile, ["--version"], { encoding: "utf8" });
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);
  });

  test("run-now exits zero for succeeded runs", () => {
    const dataDir = freshDataDir("loops-cli-ok-");
    const create = runCli(dataDir, ["create", "command", "ok", "--at", futureAt(), "--cmd", "printf ok"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["run-now", "--show-output", "ok"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("succeeded");
    expect(run.stdout).toContain("source=ad_hoc");
    expect(run.stdout).toContain("stdout:");
    expect(run.stdout).toContain("ok");
  });

  test("run-now exits non-zero for failed runs while preserving JSON output", () => {
    const dataDir = freshDataDir("loops-cli-fail-");
    const create = runCli(dataDir, ["create", "command", "fail", "--at", futureAt(), "--cmd", "exit 23"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "run-now", "fail"]);
    expect(run.status).toBe(1);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("failed");
    expect(value.exitCode).toBe(23);
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(false);
  });

  test("run-now exits zero for configured overlap-skip exit 75 without reporting success", () => {
    const dataDir = freshDataDir("loops-cli-skip-");
    const create = runCli(dataDir, ["create", "command", "skip", "--at", futureAt(), "--cmd", "exit 75"]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "run-now", "skip"]);
    expect(run.status).toBe(0);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("skipped");
    expect(value.exitCode).toBe(75);
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(false);
  });

  test("create agent rejects unsupported provider add dirs before storing", () => {
    const dataDir = freshDataDir("loops-cli-create-agent-adddirs-");

    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "bad-cursor-adddirs",
      "--provider",
      "cursor",
      "--prompt",
      "noop",
      "--add-dir",
      "/tmp/hasna-todos",
      "--at",
      futureAt(),
    ]);

    expect(create.status).toBe(1);
    const value = JSON.parse(create.stdout);
    expect(value.created).toBe(false);
    expect(value.validation.error).toContain("addDirs is currently supported only for provider codewith or codex");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(0);
  });

  test("create agent supports prompt files without printing prompt contents", () => {
    const dataDir = freshDataDir("loops-cli-create-agent-prompt-file-");
    const promptFile = join(dataDir, "prompt.md");
    writeFileSync(promptFile, "SECRET_PROMPT_FILE_VALUE\nRun the check.\n");

    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "prompt-file-agent",
      "--provider",
      "codewith",
      "--prompt-file",
      promptFile,
      "--at",
      futureAt(),
    ]);

    expect(create.status).toBe(0);
    expect(create.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const value = JSON.parse(create.stdout);
    expect(value.target.prompt).toBeUndefined();
    expect(value.target.promptSource).toBeUndefined();
    expect(value.target.operationTemplateId).toMatch(/^op-template:sha256:/);

    const show = runCli(dataDir, ["--json", "show", "prompt-file-agent"]);
    expect(show.status).toBe(0);
    expect(show.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    expect(JSON.parse(show.stdout).target.promptSource).toBeUndefined();

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    expect(storedLoop(dataDir, value.id)?.target).toMatchObject({
      type: "agent",
      promptSource: { type: "file", path: promptFile },
    });
    expect(JSON.parse(list.stdout)[0].target.promptSource).toBeUndefined();

    const humanShow = runCli(dataDir, ["show", "prompt-file-agent"]);
    expect(humanShow.status).toBe(0);
    expect(humanShow.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
  });

  test("create agent requires exactly one prompt source", () => {
    const dataDir = freshDataDir("loops-cli-create-agent-prompt-source-");
    const promptFile = join(dataDir, "prompt.md");
    writeFileSync(promptFile, "hello\n");

    const missing = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "missing-prompt",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
    ]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).validation.error).toContain("prompt");

    const both = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "both-prompts",
      "--provider",
      "codewith",
      "--prompt",
      "inline",
      "--prompt-file",
      promptFile,
      "--at",
      futureAt(),
    ]);
    expect(both.status).toBe(1);
    expect(JSON.parse(both.stdout).validation.error).toContain("either prompt or promptFile");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("run-now falls back to an ad hoc slot when the due slot is already terminal", () => {
    const dataDir = freshDataDir("loops-cli-terminal-due-");
    const store = new Store(join(dataDir, "loops.db"));
    let dueSlot = "";
    try {
      const loop = store.createLoop(
        {
          name: "terminal-due",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
        },
        new Date("2026-01-01T00:00:00Z"),
      );
      dueSlot = loop.nextRunAt!;
      const claim = store.claimRun(loop, dueSlot, "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "seed",
          stderr: "",
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:01Z") },
      );
    } finally {
      store.close();
    }

    const run = runCli(dataDir, ["--json", "run-now", "terminal-due"]);
    expect(run.status).toBe(0);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("succeeded");
    expect(value.scheduledFor).not.toBe(dueSlot);
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(false);
  });

  test("run-now records a skipped run instead of erroring when the previous overlap-skip run is still executing at an older slot", () => {
    // Regression for todos 37bd2512: an overdue overlap:"skip" loop whose
    // previous run is still executing (live lease) at an OLDER slot made
    // claimRun return undefined before inspecting the requested due slot, so
    // runLoopNow threw "could not claim manual run". The daemon tick handles
    // this state with createSkippedRun + advanceLoop; run-now must mirror it.
    const dataDir = freshDataDir("loops-cli-overlap-skip-older-");
    const store = new Store(join(dataDir, "loops.db"));
    let loopId = "";
    let dueSlot = "";
    try {
      const t0 = new Date();
      const loop = store.createLoop(
        {
          name: "overlap-skip-inflight-older",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "skip",
        },
        t0,
      );
      loopId = loop.id;
      // Previous run claimed at the OLDER slot t0 and still executing with a
      // live 30-min lease.
      const claim = store.claimRun(loop, t0.toISOString(), "seed:1", new Date());
      expect(claim).toBeDefined();
      // The daemon already skipped the intervening slot; the loop is now overdue
      // at a free due slot (t0 - 1min).
      dueSlot = new Date(t0.getTime() - 60_000).toISOString();
      store.updateLoop(loop.id, { nextRunAt: dueSlot });
    } finally {
      store.close();
    }

    const run = runCli(dataDir, ["--json", "run-now", "overlap-skip-inflight-older"]);
    expect(run.status).toBe(0);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("skipped");
    expect(value.scheduledFor).toBe(dueSlot);
    expect(value.error).toContain("previous run still active");
    expect(value.runNow.source).toBe("due_slot");
    expect(value.runNow.advancesLoop).toBe(true);
    // The skip consumed the due slot: the cursor moved past it.
    expect(storedLoop(dataDir, loopId)?.nextRunAt).not.toBe(dueSlot);
  });

  test("run-now records a skipped run instead of erroring when the previous overlap-skip run occupies the due slot itself", () => {
    // Regression for todos 37bd2512 variant A: the running row sits AT the
    // requested due slot with a live lease, so claimRun returns undefined and
    // the terminal-run fallback refuses (the row is running). run-now must
    // record the skip at an ad hoc slot and exit 0, not throw.
    const dataDir = freshDataDir("loops-cli-overlap-skip-due-");
    const store = new Store(join(dataDir, "loops.db"));
    let dueSlot = "";
    try {
      const t0 = new Date();
      const loop = store.createLoop(
        {
          name: "overlap-skip-inflight-due",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "skip",
        },
        new Date(t0.getTime() - 60_000),
      );
      dueSlot = loop.nextRunAt!; // the requested due slot (t0)
      const claim = store.claimRun(loop, dueSlot, "seed:1", new Date());
      expect(claim).toBeDefined();
    } finally {
      store.close();
    }

    const run = runCli(dataDir, ["--json", "run-now", "overlap-skip-inflight-due"]);
    expect(run.status).toBe(0);
    const value = JSON.parse(run.stdout);
    expect(value.status).toBe("skipped");
    expect(value.scheduledFor).not.toBe(dueSlot);
    expect(value.error).toContain("previous run still active");
    expect(value.runNow.source).toBe("ad_hoc");
    expect(value.runNow.advancesLoop).toBe(true);
  });

  test("run-now still errors on an unclaimable slot when overlap is not skip", () => {
    // Negative control: the graceful skip is scoped strictly to overlap:"skip".
    // A live running row at the due slot of an overlap:"allow" loop is a genuine
    // claim collision and must still throw.
    const dataDir = freshDataDir("loops-cli-overlap-allow-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const t0 = new Date();
      const loop = store.createLoop(
        {
          name: "overlap-allow-inflight-due",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "true" },
          overlap: "allow",
        },
        new Date(t0.getTime() - 60_000),
      );
      const claim = store.claimRun(loop, loop.nextRunAt!, "seed:1", new Date());
      expect(claim).toBeDefined();
    } finally {
      store.close();
    }

    const run = runCli(dataDir, ["--json", "run-now", "overlap-allow-inflight-due"]);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).error.message).toContain("could not claim manual run");
  });

  test("archives loops without deleting them and blocks run-now until unarchived", () => {
    const dataDir = freshDataDir("loops-cli-archive-");
    const create = runCli(dataDir, ["create", "command", "archivable", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const archive = runCli(dataDir, ["--json", "archive", "archivable"]);
    expect(archive.status).toBe(0);
    const archived = JSON.parse(archive.stdout);
    expect(archived.status).toBe("paused");
    expect(archived.archivedAt).toBeDefined();
    expect(archived.archivedFromStatus).toBe("active");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toHaveLength(0);

    const archivedList = runCli(dataDir, ["--json", "list", "--archived"]);
    expect(archivedList.status).toBe(0);
    expect(JSON.parse(archivedList.stdout).map((loop: { name: string }) => loop.name)).toEqual(["archivable"]);

    const show = runCli(dataDir, ["--json", "show", "archivable"]);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).archivedAt).toBeDefined();

    const blockedRun = runCli(dataDir, ["run-now", "archivable"]);
    expect(blockedRun.status).not.toBe(0);
    expect(blockedRun.stderr).toContain("loop is archived");

    const unarchive = runCli(dataDir, ["--json", "unarchive", "archivable"]);
    expect(unarchive.status).toBe(0);
    const restored = JSON.parse(unarchive.stdout);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeUndefined();
  });

  test("resume from stopped recomputes the next slot so the loop becomes due again", () => {
    const dataDir = freshDataDir("loops-cli-resume-stopped-");
    const create = runCli(dataDir, ["create", "command", "resumable", "--every", "60s", "--cmd", "true"]);
    expect(create.status).toBe(0);

    const stopped = runCli(dataDir, ["--json", "stop", "resumable"]);
    expect(stopped.status).toBe(0);
    expect(JSON.parse(stopped.stdout).status).toBe("stopped");
    expect(JSON.parse(stopped.stdout).nextRunAt).toBeUndefined();

    const resumed = runCli(dataDir, ["--json", "resume", "resumable"]);
    expect(resumed.status).toBe(0);
    const value = JSON.parse(resumed.stdout);
    expect(value.status).toBe("active");
    // Regression: resume left nextRunAt null, so dueLoops never picked it up and
    // the "active" loop was permanently dormant.
    expect(value.nextRunAt).toBeString();
  });

  test("resume of a stopped once-loop binds schedule.at so dueLoops picks it up again", () => {
    const dataDir = freshDataDir("loops-cli-resume-once-");
    const at = new Date(Date.now() - 60_000).toISOString();
    const create = runCli(dataDir, ["create", "command", "once-resumable", "--at", at, "--cmd", "true"]);
    expect(create.status).toBe(0);

    const stopped = runCli(dataDir, ["--json", "stop", "once-resumable"]);
    expect(stopped.status).toBe(0);
    expect(JSON.parse(stopped.stdout).status).toBe("stopped");
    expect(JSON.parse(stopped.stdout).nextRunAt).toBeUndefined();

    const resumed = runCli(dataDir, ["--json", "resume", "once-resumable"]);
    expect(resumed.status).toBe(0);
    const value = JSON.parse(resumed.stdout);
    expect(value.status).toBe("active");
    // Regression: the local resume branch recomputed the slot with
    // computeNextAfter, which returns undefined for schedule.type "once", so
    // next_run_at was stored NULL and the active once-loop stayed permanently
    // dormant (dueLoops requires next_run_at IS NOT NULL).
    expect(value.nextRunAt).toBe(at);

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const due = store.dueLoops(new Date());
      expect(due.map((loop) => loop.id)).toContain(value.id);
    } finally {
      store.close();
    }
  });

  test("daemon logs honors --tail and rejects a non-numeric count", () => {
    const dataDir = freshDataDir("loops-cli-daemon-logs-tail-");
    writeFileSync(join(dataDir, "daemon.log"), ["l1", "l2", "l3", "l4", "l5"].join("\n"));

    const tail = runCli(dataDir, ["daemon", "logs", "--tail", "2"]);
    expect(tail.status).toBe(0);
    expect(tail.stdout.trim().split("\n")).toEqual(["l4", "l5"]);

    // -n stays supported and must agree with --tail.
    const lines = runCli(dataDir, ["daemon", "logs", "-n", "3"]);
    expect(lines.status).toBe(0);
    expect(lines.stdout.trim().split("\n")).toEqual(["l3", "l4", "l5"]);

    // Non-numeric count must error, not dump the whole log via slice(NaN).
    const bad = runCli(dataDir, ["daemon", "logs", "-n", "abc"]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("positive integer");
  });

  test("daemon logs honors --json and strips ANSI color pollution", () => {
    const dataDir = freshDataDir("loops-cli-daemon-logs-json-");
    // Older daemon builds logged via Bun's console.error, which wraps every line
    // in red SGR codes — even non-error "succeeded"/"stopped" lines.
    const RED = "\x1b[0m\x1b[31m";
    const RESET = "\x1b[0m";
    writeFileSync(
      join(dataDir, "daemon.log"),
      [`${RED}[loops-daemon] started${RESET}`, `${RED}[loops-daemon] stopped${RESET}`].join("\n"),
    );

    // Human output: no leftover ANSI escapes.
    const human = runCli(dataDir, ["daemon", "logs"]);
    expect(human.status).toBe(0);
    expect(human.stdout).not.toContain("\x1b[");
    expect(human.stdout.trim().split("\n")).toEqual(["[loops-daemon] started", "[loops-daemon] stopped"]);

    // --json: structured payload, ANSI stripped, tail honored.
    const json = runCli(dataDir, ["--json", "daemon", "logs", "-n", "1"]);
    expect(json.status).toBe(0);
    expect(json.stdout).not.toContain("\x1b[");
    const parsed = JSON.parse(json.stdout) as { path: string; lines: string[] };
    expect(parsed.lines).toEqual(["[loops-daemon] stopped"]);
    expect(parsed.path).toContain("daemon.log");
  });

  test("mutation commands reject ambiguous loop names instead of touching the newest match", () => {
    const dataDir = freshDataDir("loops-cli-ambiguous-name-");
    let firstId = "";
    let secondId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const spec = { schedule: { type: "interval" as const, everyMs: 60_000 }, target: { type: "command" as const, command: "true" } };
      firstId = store.createLoop({ name: "dupe-name", ...spec }).id;
      secondId = store.createLoop({ name: "dupe-name", ...spec }).id;
    } finally {
      store.close();
    }
    expect(firstId).not.toBe(secondId);

    for (const command of ["pause", "resume", "stop", "remove", "run-now"]) {
      const result = runCli(dataDir, [command, "dupe-name"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("ambiguous loop name");
    }
    // Both loops are untouched: still active.
    const showFirst = runCli(dataDir, ["--json", "show", firstId]);
    const showSecond = runCli(dataDir, ["--json", "show", secondId]);
    expect(JSON.parse(showFirst.stdout).status).toBe("active");
    expect(JSON.parse(showSecond.stdout).status).toBe("active");
    // The id path still resolves precisely.
    const pausedById = runCli(dataDir, ["--json", "pause", secondId]);
    expect(pausedById.status).toBe(0);
    expect(JSON.parse(pausedById.stdout).status).toBe("paused");
  });

  test("mutation commands expose the full hosted contract, reject names, and support receipt-only dry runs", () => {
    const dataDir = freshDataDir("loops-cli-mutation-contract-");
    let loop: ReturnType<Store["createLoop"]>;
    const store = new Store(join(dataDir, "loops.db"));
    try {
      loop = store.createLoop({
        name: "contract-target",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
    } finally {
      store.close();
    }
    const contractArgs = [
      "--step-id", "pause-step",
      "--expected-revision", loop.updatedAt,
      "--approved-plan-digest", "1".repeat(64),
      "--manifest-digest", "2".repeat(64),
      "--descriptor-ref", "owner-operation-target:pause-step",
      "--descriptor-digest", "3".repeat(64),
    ];

    const nameRejected = runCli(dataDir, [
      "pause",
      loop.name,
      "--operation-id", "name-rejected",
      ...contractArgs,
    ]);
    expect(nameRejected.status).not.toBe(0);
    expect(nameRejected.stderr).toContain("full stable target id");

    const missingPrecondition = runCli(dataDir, [
      "pause",
      loop.id,
      "--operation-id", "missing-revision",
      "--step-id", "pause-step",
    ]);
    expect(missingPrecondition.status).not.toBe(0);
    expect(missingPrecondition.stderr).toContain("--expected-revision");

    const dryRun = runCli(dataDir, [
      "--json",
      "pause",
      loop.id,
      "--operation-id", "dry-run-pause",
      ...contractArgs,
      "--dry-run",
    ]);
    expect(dryRun.status).toBe(0);
    const dryRunBody = JSON.parse(dryRun.stdout) as {
      binding: Record<string, unknown>;
      terminal: { state: string; resultStatus: string };
      loop: { status: string };
    };
    expect(dryRunBody.terminal).toMatchObject({ state: "dry_run", resultStatus: "active" });
    expect(dryRunBody.loop.status).toBe("active");
    expect(JSON.stringify(dryRunBody.binding)).not.toContain("\"command\"");
    expect(JSON.stringify(dryRunBody)).not.toContain("owner-operation-target:pause-step");
    expect(dryRunBody.binding).not.toHaveProperty("descriptorRef");

    const humanDryRun = runCli(dataDir, [
      "pause",
      loop.id,
      "--operation-id", "human-dry-run-pause",
      ...contractArgs,
      "--dry-run",
    ]);
    expect(humanDryRun.status).toBe(0);
    expect(humanDryRun.stdout).not.toContain("owner-operation-target:pause-step");

    const after = runCli(dataDir, ["--json", "show", loop.id]);
    expect(after.status).toBe(0);
    expect(JSON.parse(after.stdout).status).toBe("active");
  });

  test("hygiene names reports canonical machine/repo loop names without applying by default", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-");
    const create = runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]);
    expect(create.status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "names"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.changed).toBe(1);
    expect(value.changes[0]).toMatchObject({
      oldName: "ops:codewith:account001:loop-health-slo",
      newName: "machine-ops-loop-health-slo",
      changed: true,
    });

    const show = runCli(dataDir, ["--json", "show", "ops:codewith:account001:loop-health-slo"]);
    expect(show.status).toBe(0);
  });

  test("hygiene names removes cadence suffixes from canonical loop names", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-cadence-");
    const createInterval = runCli(dataDir, [
      "create",
      "command",
      "machine-loop-health-slo-5m",
      "--every",
      "5m",
      "--cmd",
      "true",
    ]);
    expect(createInterval.status).toBe(0);

    const createDaily = runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:repo-health-daily",
      "--every",
      "1d",
      "--cmd",
      "true",
    ]);
    expect(createDaily.status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "names"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        oldName: "machine-loop-health-slo-5m",
        newName: "machine-loop-health-slo",
      }),
      expect.objectContaining({
        oldName: "ops:codewith:account001:repo-health-daily",
        newName: "machine-ops-repo-health",
      }),
    ]));
  });

  test("hygiene names apply backs up the database before renaming loops", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-apply-");
    const create = runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]);
    expect(create.status).toBe(0);

    const apply = runCli(dataDir, ["--json", "hygiene", "names", "--apply"]);

    expect(apply.status).toBe(0);
    const value = JSON.parse(apply.stdout);
    expect(value.applied).toBe(true);
    expect(value.changed).toBe(1);
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    const oldName = runCli(dataDir, ["--json", "show", "ops:codewith:account001:loop-health-slo"]);
    expect(oldName.status).not.toBe(0);

    const newName = runCli(dataDir, ["--json", "show", "machine-ops-loop-health-slo"]);
    expect(newName.status).toBe(0);
    expect(JSON.parse(newName.stdout).name).toBe("machine-ops-loop-health-slo");
  });

  test("hygiene names apply skips database backup when there are no renames", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-names-apply-noop-");
    const create = runCli(dataDir, [
      "create",
      "command",
      "machine-ops-loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]);
    expect(create.status).toBe(0);

    const apply = runCli(dataDir, ["--json", "hygiene", "names", "--apply"]);

    expect(apply.status).toBe(0);
    const value = JSON.parse(apply.stdout);
    expect(value.applied).toBe(true);
    expect(value.changed).toBe(0);
    expect(value.backupPath).toBeUndefined();
  });

  test("created loops get default descriptions and human list cadence", () => {
    const dataDir = freshDataDir("loops-cli-description-cadence-");
    const created = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "machine-report",
      "--every",
      "5m",
      "--cmd",
      "true",
    ]);
    expect(created.status).toBe(0);
    const value = JSON.parse(created.stdout);
    expect(value.description).toContain("Why:");
    expect(value.description).toContain("How:");
    expect(value.description).toContain("Outcome:");
    expect(value.description).toContain("cadence every:5m");

    const explicit = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "machine-explicit",
      "--every",
      "1h",
      "--cmd",
      "true",
      "--description",
      "Custom operator description.",
    ]);
    expect(explicit.status).toBe(0);
    expect(JSON.parse(explicit.stdout).description).toBe("Custom operator description.");

    const list = runCli(dataDir, ["list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).toContain("cadence=every:5m");
    expect(list.stdout).toContain("cadence=every:1h");
  });

  test("rename changes only the loop name and writes a backup", () => {
    const dataDir = freshDataDir("loops-cli-rename-");
    const create = runCli(dataDir, ["--json", "create", "command", "old-loop-name", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);

    const rename = runCli(dataDir, ["--json", "rename", created.id, "better-loop-name"]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value).toMatchObject({
      changed: true,
      id: created.id,
      oldName: "old-loop-name",
      newName: "better-loop-name",
    });
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    const renamed = runCli(dataDir, ["--json", "show", created.id]);
    expect(renamed.status).toBe(0);
    const loop = JSON.parse(renamed.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.name).toBe("better-loop-name");
    expect(loop.schedule).toEqual(created.schedule);

    const oldName = runCli(dataDir, ["--json", "show", "old-loop-name"]);
    expect(oldName.status).not.toBe(0);
  });

  test("set-max-attempts changes only the retry budget and writes a backup", () => {
    const dataDir = freshDataDir("loops-cli-max-attempts-");
    const create = runCli(dataDir, ["--json", "create", "command", "retry-budget-loop", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.maxAttempts).toBe(1);

    const set = runCli(dataDir, ["--json", "set-max-attempts", created.id, "3"]);

    expect(set.status).toBe(0);
    const value = JSON.parse(set.stdout);
    expect(value).toMatchObject({
      changed: true,
      id: created.id,
      previousMaxAttempts: 1,
      maxAttempts: 3,
    });
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    // Read it back through a separate process: the loop keeps its id, name,
    // and schedule, which delete-and-recreate would not have.
    const after = runCli(dataDir, ["--json", "show", created.id]);
    expect(after.status).toBe(0);
    const loop = JSON.parse(after.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.name).toBe("retry-budget-loop");
    expect(loop.maxAttempts).toBe(3);
    expect(loop.schedule).toEqual(created.schedule);
  });

  test("set-max-attempts reports a no-op and rejects a budget below 1", () => {
    const dataDir = freshDataDir("loops-cli-max-attempts-invalid-");
    const create = runCli(dataDir, ["--json", "create", "command", "budget-guard", "--at", futureAt(), "--cmd", "true", "--attempts", "2"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.maxAttempts).toBe(2);

    const noop = runCli(dataDir, ["--json", "set-max-attempts", "budget-guard", "2"]);
    expect(noop.status).toBe(0);
    const noopValue = JSON.parse(noop.stdout);
    expect(noopValue.changed).toBe(false);
    expect(noopValue.backupPath).toBeUndefined();

    for (const bad of ["0", "-1", "1.5", "abc"]) {
      const rejected = runCli(dataDir, ["--json", "set-max-attempts", "budget-guard", bad]);
      expect(rejected.status).not.toBe(0);
      const still = JSON.parse(runCli(dataDir, ["--json", "show", "budget-guard"]).stdout);
      expect(still.maxAttempts).toBe(2);
    }
  });

  test("set-lease changes only the lease and writes a backup", () => {
    const dataDir = freshDataDir("loops-cli-set-lease-");
    const create = runCli(dataDir, ["--json", "create", "command", "lease-loop", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.leaseMs).toBe(30 * 60_000);

    const set = runCli(dataDir, ["--json", "set-lease", created.id, "2h"]);

    expect(set.status).toBe(0);
    const value = JSON.parse(set.stdout);
    expect(value).toMatchObject({
      changed: true,
      id: created.id,
      previousLeaseMs: 30 * 60_000,
      leaseMs: 2 * 60 * 60_000,
    });
    expect(value.backupPath).toContain(join(dataDir, "backups"));
    expect(existsSync(value.backupPath)).toBe(true);

    // Read it back through a separate process: the loop keeps its id, name,
    // and schedule, which delete-and-recreate would not have.
    const after = runCli(dataDir, ["--json", "show", created.id]);
    expect(after.status).toBe(0);
    const loop = JSON.parse(after.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.name).toBe("lease-loop");
    expect(loop.leaseMs).toBe(2 * 60 * 60_000);
    expect(loop.schedule).toEqual(created.schedule);
  });

  test("set-lease reports a no-op and rejects a duration below 1", () => {
    const dataDir = freshDataDir("loops-cli-set-lease-invalid-");
    const create = runCli(dataDir, ["--json", "create", "command", "lease-guard", "--at", futureAt(), "--cmd", "true", "--lease", "90m"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(created.leaseMs).toBe(90 * 60_000);

    const noop = runCli(dataDir, ["--json", "set-lease", "lease-guard", "90m"]);
    expect(noop.status).toBe(0);
    const noopValue = JSON.parse(noop.stdout);
    expect(noopValue.changed).toBe(false);
    expect(noopValue.backupPath).toBeUndefined();

    // The duration grammar (shared with create --lease) accepts fractional
    // milliseconds ("1.5" -> 2ms), so the rejection set is non-positive and
    // unparseable values only.
    for (const bad of ["0", "-1", "abc", "0s"]) {
      const rejected = runCli(dataDir, ["--json", "set-lease", "lease-guard", bad]);
      expect(rejected.status).not.toBe(0);
      const still = JSON.parse(runCli(dataDir, ["--json", "show", "lease-guard"]).stdout);
      expect(still.leaseMs).toBe(90 * 60_000);
    }
  });

  test("rename reports no-op without writing a backup", () => {
    const dataDir = freshDataDir("loops-cli-rename-noop-");
    const create = runCli(dataDir, ["create", "command", "stable-name", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const rename = runCli(dataDir, ["--json", "rename", "stable-name", " stable-name "]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value.changed).toBe(false);
    expect(value.backupPath).toBeUndefined();
    expect(value.newName).toBe("stable-name");
  });

  test("rename rejects duplicate and empty names", () => {
    const dataDir = freshDataDir("loops-cli-rename-invalid-");
    expect(runCli(dataDir, ["create", "command", "first-loop", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "second-loop", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);

    const duplicate = runCli(dataDir, ["--json", "rename", "first-loop", "second-loop"]);
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("loop name already exists");

    const empty = runCli(dataDir, ["--json", "rename", "first-loop", "   "]);
    expect(empty.status).not.toBe(0);
    expect(empty.stderr).toContain("loop name must not be empty");
  });

  test("rename preserves archived loop state", () => {
    const dataDir = freshDataDir("loops-cli-rename-archived-");
    const create = runCli(dataDir, ["--json", "create", "command", "archived-rename-source", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);
    expect(runCli(dataDir, ["archive", created.id]).status).toBe(0);

    const rename = runCli(dataDir, ["--json", "rename", created.id, "archived-rename-target"]);

    expect(rename.status).toBe(0);
    const value = JSON.parse(rename.stdout);
    expect(value.changed).toBe(true);
    expect(value.loop.archivedAt).toBeDefined();
    expect(value.loop.archivedFromStatus).toBeDefined();

    const show = runCli(dataDir, ["--json", "show", "archived-rename-target"]);
    expect(show.status).toBe(0);
    const loop = JSON.parse(show.stdout);
    expect(loop.id).toBe(created.id);
    expect(loop.archivedAt).toBeDefined();
  });

  test("hygiene duplicates groups overlapping loops by normalized name, cwd, and schedule", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-duplicates-");
    expect(runCli(dataDir, ["create", "command", "machine-foo", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-foo-compact", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "duplicates"]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.groups).toHaveLength(1);
    expect(value.groups[0].loops.map((loop: { name: string }) => loop.name).sort()).toEqual(["machine-foo", "machine-foo-compact"]);
  });

  test("hygiene scripts inventories local script-backed command loops", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-scripts-");
    const scriptsDir = join(dataDir, "scripts");
    expect(runCli(dataDir, ["create", "command", "script-backed", "--at", futureAt(), "--cmd", `${scriptsDir}/check.sh`]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "script-backed-tilde", "--at", futureAt(), "--cmd", "~/.hasna/loops/scripts/check.sh"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "script-backed-env", "--at", futureAt(), "--cmd", "$HOME/.hasna/loops/scripts/check.sh"]).status).toBe(0);

    const report = runCli(dataDir, ["--json", "hygiene", "scripts", "--scripts-dir", scriptsDir]);

    expect(report.status).toBe(1);
    const value = JSON.parse(report.stdout);
    expect(value.ok).toBe(false);
    expect(value.scriptBacked).toBe(3);
    expect(value.loops.map((loop: { name: string }) => loop.name).sort()).toEqual([
      "script-backed",
      "script-backed-env",
      "script-backed-tilde",
    ]);
  });

  test("hygiene route-tasks dry-run produces deduped task upserts without mutating todos", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-route-tasks-");
    const scriptsDir = join(dataDir, "scripts");
    const evidenceDir = join(dataDir, "evidence");
    expect(runCli(dataDir, ["create", "command", "machine-foo", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-foo-compact", "--every", "1h", "--cmd", "true", "--cwd", "/tmp/repo"]).status).toBe(0);
    expect(runCli(dataDir, ["create", "command", "machine-script-backed", "--at", futureAt(), "--cmd", `${scriptsDir}/check.sh`]).status).toBe(0);

    const route = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "10",
      "--auto-route",
      "--route-project-path",
      "/tmp/openloops-fallback",
      "--evidence-dir",
      evidenceDir,
    ]);

    expect(route.status).toBe(0);
    const value = JSON.parse(route.stdout);
    expect(value.ok).toBe(true);
    expect(value.findings).toBe(2);
    expect(value.actions.map((action: { check: string }) => action.check).sort()).toEqual(["duplicates", "scripts"]);
    expect(value.actions.every((action: { action: string }) => action.action === "would-upsert")).toBe(true);
    expect(value.actions.every((action: { metadata: { no_tmux_dispatch?: boolean } }) => action.metadata.no_tmux_dispatch === true)).toBe(true);
    expect(value.actions.every((action: { tags: string[] }) => action.tags.includes("auto:route"))).toBe(true);
    expect(value.actions.every((action: { metadata: { route_enabled?: boolean; automation?: { allowed?: boolean } } }) => action.metadata.route_enabled === true && action.metadata.automation?.allowed === true)).toBe(true);
    expect(value.actions.find((action: { check: string }) => action.check === "scripts").metadata.project_path).toBe("/tmp/openloops-fallback");
    expect(value.evidencePath).toContain(evidenceDir);
    expect(existsSync(value.evidencePath)).toBe(true);
    expect(JSON.parse(readFileSync(value.evidencePath, "utf8")).findings).toBe(2);

    const firstBatch = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "1",
    ]);
    expect(firstBatch.status).toBe(0);
    const first = JSON.parse(firstBatch.stdout);
    writeFileSync(
      join(dataDir, "route-cursors.json"),
      JSON.stringify({ [first.routing.key]: { lastFingerprint: first.actions[0].fingerprint } }),
    );

    const nextBatch = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "duplicates,scripts",
      "--scripts-dir",
      scriptsDir,
      "--dry-run",
      "--max-actions",
      "1",
    ]);
    expect(nextBatch.status).toBe(0);
    const next = JSON.parse(nextBatch.stdout);
    expect(next.actions[0].fingerprint).not.toBe(first.actions[0].fingerprint);
    expect(next.routing.previousFingerprint).toBe(first.actions[0].fingerprint);
  });

  test("hygiene route-tasks skips auto-route metadata for findings without cwd or explicit route project", () => {
    const dataDir = freshDataDir("loops-cli-hygiene-route-no-cwd-");
    expect(runCli(dataDir, [
      "create",
      "command",
      "ops:codewith:account001:loop-health-slo",
      "--at",
      futureAt(),
      "--cmd",
      "true",
    ]).status).toBe(0);

    const result = runCli(dataDir, [
      "--json",
      "hygiene",
      "route-tasks",
      "--checks",
      "names",
      "--dry-run",
      "--max-actions",
      "1",
      "--auto-route",
    ]);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.actions[0].tags).not.toContain("auto:route");
    expect(value.actions[0].autoRoute).toMatchObject({
      requested: true,
      enabled: false,
      skippedReason: "missing cwd or --route-project-path",
    });
    expect(value.actions[0].metadata).toMatchObject({
      auto_route_requested: true,
      auto_route_enabled: false,
      auto_route_skipped_reason: "missing cwd or --route-project-path",
      route_enabled: false,
      project_path: null,
      working_dir: null,
      automation: { allowed: false, source: "openloops.hygiene.route-tasks" },
      no_tmux_dispatch: true,
    });
  });

  test("create command with a machine pin fails loudly (machines deleted)", () => {
    // @hasna/machines was deleted (owner directive, 2026-09-03); machine-pinned
    // creates fail loudly and store nothing instead of persisting an
    // unclaimable NULL pin (same contract as the pinned-name case above).
    const dataDir = freshDataDir("loops-cli-machine-");
    const create = runCli(dataDir, ["--json", "create", "command", "machine-local", "--at", futureAt(), "--cmd", "true", "--machine", "local"]);
    expect(create.status).not.toBe(0);
    expect(create.stderr + create.stdout).toContain("@hasna/machines has been deleted");

    const listed = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout) as Array<{ name: string }>;
    expect(listed.map((loop) => loop.name)).not.toContain("machine-local");
  });

  test("create agent requires and persists auditable advisory restriction metadata", () => {
    const dataDir = freshDataDir("loops-cli-agent-allowlist-");
    const missingReason = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "missing-reason-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--allow-command",
      "git",
    ]);
    expect(missingReason.status).toBe(1);
    expect(JSON.parse(missingReason.stdout).validation.error).toContain("allowlist.safetyReason");

    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "allowlisted-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--allow-tool",
      "functions.exec_command",
      "--allow-command",
      "git,bun",
      "--safety-reason",
      "isolated repository status inspection",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.target.allowlist).toEqual({
      tools: ["functions.exec_command"],
      commands: ["git", "bun"],
      enforcement: "metadata_only",
    });
    expect(value.target.allowlist).not.toHaveProperty("safetyReason");
    expect(storedLoop(dataDir, value.id)?.target).toMatchObject({
      type: "agent",
      allowlist: { safetyReason: "isolated repository status inspection" },
    });

    const relaxed = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "relaxed-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--sandbox",
      "danger-full-access",
      "--safety-reason",
      "operator-approved isolated repository repair",
    ]);
    expect(relaxed.status).toBe(1);
    expect(JSON.parse(relaxed.stdout).validation.error).toContain("manualBreakGlass=true");
  });

  test("create agent persists --env variables and rejects a malformed value", () => {
    const dataDir = freshDataDir("loops-cli-agent-env-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "env-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--env",
      "CONVERSATIONS_AGENT_ID=agent-chief-marketing",
      "--env",
      "HASNA_KNOWLEDGE_BACKEND=cloud",
    ]);
    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    // Every CLI-facing view omits env entirely, so a credential passed via
    // --env never appears verbatim or as a shape-revealing placeholder.
    expect(value.target.env).toBeUndefined();
    expect(create.stdout).not.toContain("agent-chief-marketing");

    const malformed = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "malformed-env-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--env",
      "NOT_A_KEY_VALUE_PAIR",
    ]);
    expect(malformed.status).toBe(1);
    expect(JSON.parse(malformed.stdout).error.message).toContain("invalid --env value");

    const show = runCli(dataDir, ["--json", "show", value.id]);
    expect(show.status).toBe(0);
    expect(JSON.parse(show.stdout).target.env).toBeUndefined();
    expect(show.stdout).not.toContain("agent-chief-marketing");

    // Confirm what actually landed in storage (bypassing CLI-side redaction),
    // proving --env was parsed and persisted correctly rather than dropped.
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const stored = store.getLoop(value.id);
      expect(stored?.target).toMatchObject({
        type: "agent",
        env: { CONVERSATIONS_AGENT_ID: "agent-chief-marketing", HASNA_KNOWLEDGE_BACKEND: "cloud" },
      });
    } finally {
      store.close();
    }
  });

  test("create command, agent, and workflow accept explicit unlimited timeouts", () => {
    const dataDir = freshDataDir("loops-cli-timeout-none-");
    const command = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "no-timeout-command",
      "--at",
      futureAt(),
      "--cmd",
      "sleep 0.1",
      "--timeout",
      "none",
    ]);
    expect(command.status).toBe(0);
    expect(JSON.parse(command.stdout).target.timeoutMs).toBeNull();

    const agent = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "no-timeout-agent",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--timeout",
      "unlimited",
    ]);
    expect(agent.status).toBe(0);
    expect(JSON.parse(agent.stdout).target.timeoutMs).toBeNull();

    const file = workflowFile(dataDir, {
      name: "no-timeout-workflow",
      steps: [{ id: "step", target: { type: "command", command: "true", shell: true } }],
    });
    const workflowCreate = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(workflowCreate.status).toBe(0);
    const workflow = JSON.parse(workflowCreate.stdout);
    const workflowLoop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "no-timeout-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
      "--timeout",
      "null",
    ]);
    expect(workflowLoop.status).toBe(0);
    expect(JSON.parse(workflowLoop.stdout).target.timeoutMs).toBeNull();
  });

  test("workflows migrate-agent-timeouts clones specs and retargets loops append-only", () => {
    const dataDir = freshDataDir("loops-cli-migrate-agent-timeouts-");
    const file = workflowFile(dataDir, {
      name: "finite-agent-workflow",
      steps: [
        {
          id: "worker",
          timeoutMs: 2_700_000,
          target: { type: "agent", provider: "codewith", prompt: "work", timeoutMs: 2_700_000, idleTimeoutMs: 600_000 },
        },
      ],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "finite-agent-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
      "--timeout",
      "45m",
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const dryRun = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopValue.id]);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout).summary.wouldMigrate).toBe(1);

    const applied = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopValue.id, "--apply"]);
    expect(applied.status).toBe(0);
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.summary.migrated).toBe(1);
    const nextWorkflowId = appliedValue.rows[0].workflow.id;
    expect(nextWorkflowId).not.toBe(workflow.id);

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(shownLoop.status).toBe(0);
    const shownLoopValue = JSON.parse(shownLoop.stdout);
    expect(shownLoopValue.target.workflowId).toBe(nextWorkflowId);
    expect(shownLoopValue.target.timeoutMs).toBeNull();

    const shownWorkflow = runCli(dataDir, ["--json", "workflows", "show", nextWorkflowId]);
    expect(shownWorkflow.status).toBe(0);
    const migratedWorkflow = JSON.parse(shownWorkflow.stdout);
    expect(migratedWorkflow.steps[0].timeoutMs).toBeNull();
    expect(migratedWorkflow.steps[0].target.timeoutMs).toBeUndefined();
    expect(migratedWorkflow.steps[0].target.idleTimeoutMs).toBeUndefined();
    expect(migratedWorkflow.steps[0].target.operationTemplateId).toMatch(/^op-template:sha256:/);
    expect(storedWorkflow(dataDir, nextWorkflowId)?.steps[0]?.target).toMatchObject({
      type: "agent",
      timeoutMs: null,
    });

    const oldWorkflow = runCli(dataDir, ["--json", "workflows", "show", workflow.id]);
    expect(oldWorkflow.status).toBe(0);
    expect(JSON.parse(oldWorkflow.stdout).status).toBe("active");
  });

  test("workflows migrate-agent-timeouts updates direct agent loops in place", () => {
    const dataDir = freshDataDir("loops-cli-migrate-direct-agent-timeout-");
    let loopId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "finite-direct-agent-loop",
        schedule: { type: "once", at: futureAt() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "work",
          cwd: "/tmp/direct-agent-repo",
          model: "gpt-test",
          authProfile: "account007",
          addDirs: ["/tmp/direct-agent-extra"],
          timeoutMs: 900_000,
          idleTimeoutMs: 120_000,
          permissionMode: "default",
          sandbox: "workspace-write",
          allowlist: { commands: ["todos"], safetyReason: "direct timeout migration fixture" },
          preflight: { beforeRun: true },
        },
        overlap: "skip",
        maxAttempts: 3,
        leaseMs: 1_800_000,
      });
      loopId = loop.id;
    } finally {
      store.close();
    }

    const broadDryRun = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts"]);
    expect(broadDryRun.status).toBe(0);
    expect(JSON.parse(broadDryRun.stdout).summary.total).toBe(0);

    const dryRun = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopId]);
    expect(dryRun.status).toBe(0);
    const dryRunValue = JSON.parse(dryRun.stdout);
    expect(dryRunValue.summary.wouldUpdate).toBe(1);
    expect(dryRunValue.rows[0].status).toBe("would_update");
    expect(dryRunValue.rows[0].target.timeoutMs).toBeNull();
    expect(dryRunValue.rows[0].target.idleTimeoutMs).toBeUndefined();

    const shownAfterDryRun = runCli(dataDir, ["--json", "show", loopId]);
    expect(shownAfterDryRun.status).toBe(0);
    expect(JSON.parse(shownAfterDryRun.stdout).target.timeoutMs).toBe(900_000);

    const applied = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", loopId, "--apply"]);
    expect(applied.status).toBe(0);
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.summary.updated).toBe(1);
    expect(appliedValue.rows[0].status).toBe("updated");

    const shown = runCli(dataDir, ["--json", "show", loopId]);
    expect(shown.status).toBe(0);
    const shownValue = JSON.parse(shown.stdout);
    expect(shownValue.target).toMatchObject({
      type: "agent",
      provider: "codewith",
      model: "gpt-test",
      timeoutMs: null,
      permissionMode: "default",
      sandbox: "workspace-write",
      allowlist: { commands: ["todos"], enforcement: "metadata_only" },
      preflight: { beforeRun: true },
      operationTemplateId: expect.stringMatching(/^op-template:sha256:/),
    });
    expect(shownValue.target.cwd).toBeUndefined();
    expect(shownValue.target.authProfile).toBeUndefined();
    expect(shownValue.target.addDirs).toBeUndefined();
    expect(shownValue.target.allowlist.safetyReason).toBeUndefined();
    expect(shownValue.target.idleTimeoutMs).toBeUndefined();
    expect(shownValue.overlap).toBe("skip");
    expect(shownValue.maxAttempts).toBe(3);
    expect(shownValue.leaseMs).toBe(1_800_000);
    expect(storedLoop(dataDir, loopId)?.target).toMatchObject({
      type: "agent",
      cwd: "/tmp/direct-agent-repo",
      model: "gpt-test",
      authProfile: "account007",
      addDirs: ["/tmp/direct-agent-extra"],
      timeoutMs: null,
      allowlist: { commands: ["todos"], safetyReason: "direct timeout migration fixture" },
    });
  });

  test("workflows migrate-agent-timeouts skips non-agent loops and blocks running direct agent loops", () => {
    const dataDir = freshDataDir("loops-cli-migrate-direct-agent-guards-");
    let commandLoopId = "";
    let runningLoopId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const commandLoop = store.createLoop({
        name: "command-loop",
        schedule: { type: "once", at: futureAt() },
        target: { type: "command", command: "true" },
      });
      commandLoopId = commandLoop.id;

      const runningLoop = store.createLoop({
        name: "running-direct-agent-loop",
        schedule: { type: "once", at: futureAt() },
        target: { type: "agent", provider: "codewith", prompt: "work", timeoutMs: 900_000 },
      });
      runningLoopId = runningLoop.id;
      const claim = store.claimRun(runningLoop, runningLoop.nextRunAt!, "test-runner");
      expect(claim?.run.status).toBe("running");
    } finally {
      store.close();
    }

    const skipped = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", commandLoopId]);
    expect(skipped.status).toBe(0);
    const skippedValue = JSON.parse(skipped.stdout);
    expect(skippedValue.summary.skipped).toBe(1);
    expect(skippedValue.rows[0].reason).toBe("loop is not an agent or workflow loop");

    const blocked = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", runningLoopId]);
    expect(blocked.status).toBe(0);
    const blockedValue = JSON.parse(blocked.stdout);
    expect(blockedValue.summary.blocked).toBe(1);
    expect(blockedValue.rows[0].reason).toBe("loop has a running run; retry after it finishes");

    const shown = runCli(dataDir, ["--json", "show", runningLoopId]);
    expect(JSON.parse(shown.stdout).target.timeoutMs).toBe(900_000);
  });

  test("workflows migrate-goal-wrappers removes redundant workflow goals append-only", () => {
    const dataDir = freshDataDir("loops-cli-migrate-goal-wrappers-");
    const promptFile = join(dataDir, "worker-prompt.md");
    writeFileSync(promptFile, "SECRET_PROMPT_FILE_VALUE\nDo the work.\n");
    const file = workflowFile(dataDir, {
      name: "double-goal-workflow",
      goal: { objective: "SECRET_WORKFLOW_GOAL that should be removed" },
      steps: [
        { id: "worker", target: { type: "command", command: "printf ok", shell: true } },
        { id: "reviewer", target: { type: "agent", provider: "codewith", promptFile } },
      ],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "double-goal-workflow-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE loops SET goal_json = ? WHERE id = ?").run(
        JSON.stringify({ objective: "Outer loop goal" }),
        loopValue.id,
      );
    } finally {
      db.close();
    }

    const dryRun = runCli(dataDir, ["--json", "workflows", "migrate-goal-wrappers", "--loop", loopValue.id]);
    expect(dryRun.status).toBe(0);
    expect(dryRun.stdout).not.toContain("SECRET_WORKFLOW_GOAL");
    expect(dryRun.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const dryRunValue = JSON.parse(dryRun.stdout);
    expect(dryRunValue.summary.wouldMigrate).toBe(1);
    expect(dryRunValue.rows[0].removedGoal.objective).toContain("[redacted");

    const applied = runCli(dataDir, [
      "--json",
      "workflows",
      "migrate-goal-wrappers",
      "--loop",
      loopValue.id,
      "--apply",
      "--archive-old",
    ]);
    expect(applied.status).toBe(0);
    expect(applied.stdout).not.toContain("SECRET_WORKFLOW_GOAL");
    expect(applied.stdout).not.toContain("SECRET_PROMPT_FILE_VALUE");
    const appliedValue = JSON.parse(applied.stdout);
    expect(appliedValue.summary.migrated).toBe(1);
    expect(appliedValue.rows[0].previousWorkflow.id).toBe(workflow.id);
    expect(appliedValue.rows[0].previousWorkflow.goal.objective).toContain("[redacted");
    expect(appliedValue.rows[0].workflow.hasGoal).toBe(false);
    expect(appliedValue.rows[0].workflow.goal).toBeUndefined();
    expect(appliedValue.rows[0].archivedOld.status).toBe("archived");

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(shownLoop.status).toBe(0);
    const shownLoopValue = JSON.parse(shownLoop.stdout);
    expect(shownLoopValue.goal).toBeUndefined();
    expect(shownLoopValue.target.workflowId).toBe(appliedValue.rows[0].workflow.id);
    const shownGoal = runCli(dataDir, ["--json", "goal", "show", loopValue.id]);
    expect(shownGoal.status).toBe(0);
    expect(JSON.parse(shownGoal.stdout).config.objective).toBe("Outer loop goal");

    const shownWorkflow = runCli(dataDir, ["--json", "workflows", "show", appliedValue.rows[0].workflow.id]);
    expect(shownWorkflow.status).toBe(0);
    const shownWorkflowValue = JSON.parse(shownWorkflow.stdout);
    expect(shownWorkflowValue.goal).toBeUndefined();
    expect(shownWorkflowValue.steps[1].target.promptSource).toBeUndefined();
    expect(storedWorkflow(dataDir, appliedValue.rows[0].workflow.id)?.steps[1]?.target).toMatchObject({
      type: "agent",
      promptSource: { type: "file", path: promptFile },
    });
  });

  test("workflows migrate-goal-wrappers skips workflow-goal-only loops", () => {
    const dataDir = freshDataDir("loops-cli-migrate-workflow-goal-only-");
    const file = workflowFile(dataDir, {
      name: "workflow-goal-only",
      goal: { objective: "SECRET_WORKFLOW_ONLY_GOAL" },
      steps: [{ id: "worker", target: { type: "command", command: "printf ok", shell: true } }],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    const loop = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "workflow-goal-only-loop",
      "--workflow",
      workflow.id,
      "--at",
      futureAt(),
    ]);
    expect(loop.status).toBe(0);
    const loopValue = JSON.parse(loop.stdout);

    const migrated = runCli(dataDir, ["--json", "workflows", "migrate-goal-wrappers", "--loop", loopValue.id, "--apply"]);

    expect(migrated.status).toBe(0);
    expect(migrated.stdout).not.toContain("SECRET_WORKFLOW_ONLY_GOAL");
    const migratedValue = JSON.parse(migrated.stdout);
    expect(migratedValue.summary.migrated).toBe(0);
    expect(migratedValue.summary.skipped).toBe(1);
    expect(migratedValue.rows[0].reason).toBe("loop has no loop-level goal wrapper");
    expect(migratedValue.rows[0].workflow.goal.objective).toContain("[redacted");

    const shownLoop = runCli(dataDir, ["--json", "show", loopValue.id]);
    expect(JSON.parse(shownLoop.stdout).target.workflowId).toBe(workflow.id);
  });

  test("workflows migrate-agent-timeouts rejects ambiguous loop names", () => {
    const dataDir = freshDataDir("loops-cli-migrate-ambiguous-loop-");
    const file = workflowFile(dataDir, {
      name: "ambiguous-agent-workflow",
      steps: [{ id: "worker", target: { type: "agent", provider: "codewith", prompt: "work", timeoutMs: 2_700_000 } }],
    });
    const created = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    for (const at of [futureAt(), new Date(Date.now() + 120_000).toISOString()]) {
      const loop = runCli(dataDir, [
        "--json",
        "create",
        "workflow",
        "duplicate-loop-name",
        "--workflow",
        workflow.id,
        "--at",
        at,
      ]);
      expect(loop.status).toBe(0);
    }

    const migrated = runCli(dataDir, ["--json", "workflows", "migrate-agent-timeouts", "--loop", "duplicate-loop-name"]);
    expect(migrated.status).not.toBe(0);
    expect(migrated.stderr).toContain("ambiguous loop name");
  });

  test("create stores runtime preflight policy on command, agent, and workflow loops", () => {
    const dataDir = freshDataDir("loops-cli-runtime-preflight-");
    const command = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "runtime-command-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--no-shell",
      "--preflight-each-run",
    ]);
    expect(command.status).toBe(0);
    expect(JSON.parse(command.stdout).target.preflight).toEqual({ beforeRun: true });

    const agent = runCli(dataDir, [
      "--json",
      "create",
      "agent",
      "runtime-agent-preflight",
      "--provider",
      "codewith",
      "--at",
      futureAt(),
      "--prompt",
      "inspect status",
      "--preflight-each-run",
    ]);
    expect(agent.status).toBe(0);
    expect(JSON.parse(agent.stdout).target.preflight).toEqual({ beforeRun: true });

    const file = workflowFile(dataDir, {
      name: "runtime-preflight-workflow",
      steps: [{ id: "step", target: { type: "command", command: "true" } }],
    });
    expect(runCli(dataDir, ["workflows", "create", file]).status).toBe(0);
    const workflow = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "runtime-workflow-preflight",
      "--workflow",
      "runtime-preflight-workflow",
      "--at",
      futureAt(),
      "--preflight-each-run",
    ]);
    expect(workflow.status).toBe(0);
    expect(JSON.parse(workflow.stdout).target.preflight).toEqual({ beforeRun: true });
  });

  test("machines commands report OpenMachines topology unavailable (machines deleted)", () => {
    // @hasna/machines was deleted (owner directive, 2026-09-03); the routing
    // consumer is no longer installable, so the topology commands fail loudly
    // instead of silently reporting an empty fleet.
    const dataDir = freshDataDir("loops-cli-machines-");
    const list = runCli(dataDir, ["--json", "machines", "list"]);
    expect(list.status).not.toBe(0);
    expect(list.stderr + list.stdout).toContain("@hasna/machines has been deleted");

    const show = runCli(dataDir, ["--json", "machines", "show", "local"]);
    expect(show.status).not.toBe(0);
    expect(show.stderr + show.stdout).toContain("@hasna/machines has been deleted");
  });

  test("doctor exits non-zero when an active loop cannot preflight", () => {
    const dataDir = freshDataDir("loops-cli-doctor-preflight-");
    const create = runCli(dataDir, [
      "create",
      "command",
      "bad-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
    ]);
    expect(create.status).toBe(0);

    const doctor = runCli(dataDir, ["--json", "doctor"]);
    expect(doctor.status).toBe(1);
    const value = JSON.parse(doctor.stdout);
    expect(value.ok).toBe(false);
    expect(value.checks.find((check: { id: string }) => check.id.includes(":preflight"))?.status).toBe("fail");
  });

  test("create command --preflight fails before storing a broken loop", () => {
    const dataDir = freshDataDir("loops-cli-create-preflight-fail-");
    const create = runCli(dataDir, [
      "create",
      "command",
      "bad-create-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("Executable not found");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create command --preflight includes stable JSON evidence on success", () => {
    const dataDir = freshDataDir("loops-cli-create-preflight-ok-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "ok-create-preflight",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.loop.name).toBe("ok-create-preflight");
    expect(value.preflight).toMatchObject({ command: "true" });
  });

  test("create command --preflight reports bounded JSON without storing on failure", () => {
    const dataDir = freshDataDir("loops-cli-create-preflight-json-fail-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "bad-create-preflight-json",
      "--at",
      futureAt(),
      "--cmd",
      "openloops-definitely-missing-binary",
      "--no-shell",
      "--preflight",
    ]);

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value).toMatchObject({
      ok: false,
      created: false,
      type: "command",
      name: "bad-create-preflight-json",
      preflight: { ok: false },
    });
    expect(value.preflight.error).toContain("Executable not found");
    expect(value.preflight.error.length).toBeLessThan(380);

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create command --preflight fails before storing when OpenAccounts env fails", () => {
    const dataDir = freshDataDir("loops-cli-create-account-preflight-fail-");
    const home = mkdtempSync(join(tmpdir(), "loops-cli-create-account-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const accounts = join(binDir, "accounts");
    writeFileSync(
      accounts,
      "#!/usr/bin/env bash\nprintf 'missing account profile' >&2\nexit 42\n",
    );
    chmodSync(accounts, 0o755);

    const create = runCli(
      dataDir,
      [
        "--json",
        "create",
        "command",
        "bad-account-preflight",
        "--at",
        futureAt(),
        "--cmd",
        "true",
        "--no-shell",
        "--account",
        "missing",
        "--account-tool",
        "codewith",
        "--preflight",
      ],
      undefined,
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value.preflight.error).toContain("accounts env failed for missing/codewith");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  const home = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-home-"));

  test.skipIf(providerBinaryResolvable("codewith", { BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: "/usr/bin:/bin" }))(
    "create agent --preflight fails before storing when provider binary is missing",
    () => {
      const dataDir = freshDataDir("loops-cli-create-agent-preflight-fail-");
      const create = runCli(
        dataDir,
        [
          "--json",
          "create",
          "agent",
          "bad-agent-preflight",
          "--provider",
          "codewith",
          "--prompt",
          "run",
          "--at",
          futureAt(),
          "--preflight",
        ],
        undefined,
        { BUN_INSTALL: join(home, ".bun"), HOME: home, PATH: "/usr/bin:/bin" },
      );

      expect(create.status).toBe(1);
      expect(create.stderr).toBe("");
      const value = JSON.parse(create.stdout);
      expect(value).toMatchObject({
        ok: false,
        created: false,
        type: "agent",
        provider: "codewith",
        name: "bad-agent-preflight",
        preflight: { ok: false },
      });
      expect(value.preflight.error).toContain("Executable not found");

      const list = runCli(dataDir, ["--json", "list"]);
      expect(JSON.parse(list.stdout)).toEqual([]);
    },
  );

  test("create agent --preflight validates provider-native Codewith auth profiles", () => {
    const dataDir = freshDataDir("loops-cli-create-agent-auth-preflight-");
    const home = mkdtempSync(join(tmpdir(), "loops-cli-create-agent-auth-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);

    const create = runCli(
      dataDir,
      [
        "--json",
        "create",
        "agent",
        "bad-codewith-auth-profile",
        "--provider",
        "codewith",
        "--auth-profile",
        "missing",
        "--prompt",
        "run",
        "--at",
        futureAt(),
        "--preflight",
      ],
      undefined,
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value.preflight.error).toContain("codewith auth profile not found: missing");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("create workflow --preflight fails before storing the scheduling loop", () => {
    const dataDir = freshDataDir("loops-cli-create-workflow-preflight-fail-");
    const file = workflowFile(dataDir, {
      name: "workflow-preflight-fails",
      steps: [
        {
          id: "missing-command",
          target: { type: "command", command: "openloops-definitely-missing-binary" },
        },
      ],
    });
    const workflow = runCli(dataDir, ["workflows", "create", file]);
    expect(workflow.status).toBe(0);

    const create = runCli(dataDir, [
      "create",
      "workflow",
      "bad-workflow-loop",
      "--workflow",
      "workflow-preflight-fails",
      "--at",
      futureAt(),
      "--preflight",
    ]);

    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("workflow step missing-command preflight failed");
    expect(create.stderr).toContain("Executable not found");

    const list = runCli(dataDir, ["--json", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("workflows create resolves relative promptFile and redacts output", () => {
    const dataDir = freshDataDir("loops-cli-workflow-prompt-file-");
    writeFileSync(join(dataDir, "agent-prompt.md"), "SECRET_WORKFLOW_PROMPT_FILE\nReview only.\n");
    const file = workflowFile(dataDir, {
      name: "workflow-prompt-file",
      steps: [
        {
          id: "review",
          target: {
            type: "agent",
            provider: "codewith",
            promptFile: "agent-prompt.md",
          },
        },
      ],
    });

    const validate = runCli(dataDir, ["--json", "workflows", "validate", file]);
    expect(validate.status).toBe(0);
    expect(validate.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    const validated = JSON.parse(validate.stdout);
    expect(validated.workflow.steps[0].target.prompt).toBeUndefined();
    expect(validated.workflow.steps[0].target.promptSource).toBeUndefined();
    expect(validated.workflow.steps[0].target.operationTemplateId).toMatch(/^op-template:sha256:/);

    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(0);
    expect(create.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");

    const show = runCli(dataDir, ["--json", "workflows", "show", "workflow-prompt-file"]);
    expect(show.status).toBe(0);
    expect(show.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    const shown = JSON.parse(show.stdout);
    expect(shown.steps[0].target.promptSource).toBeUndefined();
    expect(storedWorkflow(dataDir, shown.id)?.steps[0]?.target).toMatchObject({
      type: "agent",
      promptSource: { type: "file", path: join(dataDir, "agent-prompt.md") },
    });

    const list = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(list.status).toBe(0);
    expect(list.stdout).not.toContain("SECRET_WORKFLOW_PROMPT_FILE");
    expect(JSON.parse(list.stdout)[0].steps[0].target.promptSource).toBeUndefined();
  });

  test("workflows validate and create report promptFile failures as structured redacted JSON", () => {
    const dataDir = freshDataDir("loops-cli-workflow-prompt-file-error-");
    const file = workflowFile(dataDir, {
      name: "workflow-missing-prompt-file",
      steps: [
        {
          id: "review",
          target: {
            type: "agent",
            provider: "codewith",
            promptFile: "missing-secret-prompt.md",
          },
        },
      ],
    });

    const validate = runCli(dataDir, ["--json", "workflows", "validate", file]);
    expect(validate.status).toBe(1);
    expect(validate.stderr).toBe("");
    const validation = JSON.parse(validate.stdout);
    expect(validation.created).toBe(false);
    expect(validation.validation.ok).toBe(false);
    expect(validation.validation.error).toContain("promptFile could not be read");

    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const created = JSON.parse(create.stdout);
    expect(created.created).toBe(false);
    expect(created.validation.ok).toBe(false);
  });

  test("create workflow --preflight includes step-mapped JSON evidence on success", () => {
    const dataDir = freshDataDir("loops-cli-create-workflow-preflight-ok-");
    const file = workflowFile(dataDir, {
      name: "workflow-preflight-ok",
      steps: [
        {
          id: "first",
          target: { type: "command", command: "true" },
        },
        {
          id: "second",
          dependsOn: ["first"],
          target: { type: "command", command: "true" },
        },
      ],
    });
    const workflow = runCli(dataDir, ["workflows", "create", file]);
    expect(workflow.status).toBe(0);

    const create = runCli(dataDir, [
      "--json",
      "create",
      "workflow",
      "ok-workflow-loop",
      "--workflow",
      "workflow-preflight-ok",
      "--at",
      futureAt(),
      "--preflight",
    ]);

    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.loop.name).toBe("ok-workflow-loop");
    expect(value.preflight.map((item: { workflowStepId: string }) => item.workflowStepId)).toEqual(["first", "second"]);
    expect(value.preflight.every((item: { command: string }) => item.command === "true")).toBe(true);
  });

  test("workflows create --preflight fails before storing a broken workflow", () => {
    const dataDir = freshDataDir("loops-cli-workflows-create-preflight-fail-");
    const file = workflowFile(dataDir, {
      name: "stored-workflow-preflight-fails",
      steps: [
        {
          id: "missing-command",
          target: { type: "command", command: "openloops-definitely-missing-binary" },
        },
      ],
    });

    const create = runCli(dataDir, ["--json", "workflows", "create", file, "--preflight"]);

    expect(create.status).toBe(1);
    expect(create.stderr).toBe("");
    const value = JSON.parse(create.stdout);
    expect(value).toMatchObject({
      ok: false,
      created: false,
      type: "workflow",
      name: "stored-workflow-preflight-fails",
      preflight: { ok: false },
    });
    expect(value.preflight.error).toContain("workflow step missing-command preflight failed");

    const list = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([]);
  });

  test("workflows list is complete by default and warns for explicit pages", () => {
    const dataDir = freshDataDir("loops-cli-workflows-list-complete-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      for (let index = 0; index < 205; index += 1) {
        store.createWorkflow({
          name: `workflow-list-${String(index).padStart(3, "0")}`,
          steps: [{ id: "step", target: { type: "command", command: "true" } }],
        });
      }
    } finally {
      store.close();
    }

    const complete = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(complete.status).toBe(0);
    expect(JSON.parse(complete.stdout)).toHaveLength(205);
    expect(complete.stderr).toBe("");

    const limited = runCli(dataDir, ["--json", "workflows", "list", "--limit", "10"]);
    expect(limited.status).toBe(0);
    expect(JSON.parse(limited.stdout)).toHaveLength(10);
    expect(limited.stderr).toContain("showing 10 of 205 active workflows");
    expect(limited.stderr).toContain("--offset 10");

    const archived = runCli(dataDir, ["--json", "workflows", "archive", "workflow-list-000"]);
    expect(archived.status).toBe(0);
    const all = runCli(dataDir, ["--json", "workflows", "list", "--all"]);
    expect(all.status).toBe(0);
    expect(JSON.parse(all.stdout)).toHaveLength(205);
  });

  test("health JSON reports failed expectations with classification and task upsert fields", () => {
    const dataDir = freshDataDir("loops-cli-health-json-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "fake-project-stdout-secret",
          stderr: "Rate limit exceeded by provider fake-project-stderr-secret",
          error: "429 too many requests fake-project-error-secret",
          exitCode: 1,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(1);
    const value = JSON.parse(health.stdout);
    expect(value.ok).toBe(false);
    expect(value.summary.unhealthy).toBe(1);
    expect(value.classifications.rate_limit).toBe(1);
    expect(value.expectations[0].failure.classification).toBe("rate_limit");
    expect(value.expectations[0].failure.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(value)).not.toContain("fake-project-");
    expect(value.expectations[0].latestRun.error).toMatch(/^\[redacted \d+ chars\]$/);
    expect(value.expectations[0].failure.evidence.stderr).toMatch(/^\[redacted \d+ chars\]$/);
    expect(value.expectations[0].recommendedTask).toMatchObject({
      priority: "high",
      futureNativeUpsert: { command: "todos task upsert" },
    });
    expect(value.expectations[0].recommendedTask.description).toContain("Do not dispatch or paste prompts into tmux panes");
    expect(value.expectations[0].recommendedTask.compatibilityFallback.search).toEqual(
      expect.arrayContaining(["todos", "search"]),
    );
  });

  test("health human output surfaces restart-interrupted warnings", () => {
    const dataDir = freshDataDir("loops-cli-health-restart-warning-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "restart-warning-loop",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["10"] },
      });
      store.createSkippedRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart`,
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health"]);
    expect(health.status).toBe(0);
    expect(health.stdout).toContain("warnings=1");
    expect(health.stdout).toContain("warn  restart-warning-loop  restart_interrupted");
  });

  test("health JSON reports functional route blockers even when latest drain run succeeded", () => {
    const dataDir = freshDataDir("loops-cli-health-route-functional-");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, "route-drain.json");
    writeFileSync(evidencePath, JSON.stringify({
      results: [
        {
          kind: "created",
          event: {
            subject: "task-route-blocked",
            data: {
              id: "task-route-blocked",
              status: "pending",
              tags: ["auto:route", "blocked"],
            },
          },
          loop: { id: "child-loop-route-blocked" },
          idempotencyKey: "todos-task:task-route-blocked",
        },
      ],
    }));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "machine-oss-task-lifecycle-router",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "loops", args: ["events", "drain", "todos-task", "--json", "--compact"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 1, skipped: 0, evidencePath }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(1);
    const value = JSON.parse(health.stdout);
    expect(value.ok).toBe(false);
    expect(value.summary.unhealthy).toBe(1);
    expect(value.classifications.route_functional).toBe(1);
    expect(value.expectations[0].check.id).toBe("route-functional-health");
    expect(value.expectations[0].failure.classification).toBe("route_functional");
    expect(value.expectations[0].failure.evidence.error).toContain("disallowed tag blocked");
    expect(value.expectations[0].recommendedTask.tags).toContain("route_functional");
    const firstDedupeKey = value.expectations[0].recommendedTask.dedupeKey;

    const laterStore = new Store(join(dataDir, "loops.db"));
    try {
      const loop = laterStore.requireLoop("machine-oss-task-lifecycle-router");
      const claim = laterStore.claimRun(loop, "2026-01-01T00:01:00.000Z", "seed", new Date("2026-01-01T00:01:00Z"));
      expect(claim).toBeDefined();
      laterStore.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:01:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 1, skipped: 0, evidencePath }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:01:00.500Z") },
      );
    } finally {
      laterStore.close();
    }

    const laterHealth = runCli(dataDir, ["health", "--json"]);
    expect(laterHealth.status).toBe(1);
    const laterValue = JSON.parse(laterHealth.stdout);
    expect(laterValue.expectations[0].latestRun.id).not.toBe(value.expectations[0].latestRun.id);
    expect(laterValue.expectations[0].recommendedTask.dedupeKey).toBe(firstDedupeKey);
  });

  test("health JSON flags skipped route source task update failures", () => {
    const dataDir = freshDataDir("loops-cli-health-route-source-update-");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidencePath = join(evidenceDir, "route-drain.json");
    writeFileSync(evidencePath, JSON.stringify({
      results: [
        {
          kind: "skipped",
          reason: "invalid project path /tmp/missing",
          event: {
            subject: "task-route-invalid-path",
            data: {
              id: "task-route-invalid-path",
              status: "pending",
              tags: ["auto:route"],
            },
          },
          sourceTaskUpdate: {
            ok: false,
            error: "source task updates failed: tagNoAuto failed",
            tagNoAuto: { ok: false },
            untagAutoRoute: { ok: true },
          },
        },
      ],
    }));
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "machine-oss-task-lifecycle-router",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "loops", args: ["events", "drain", "todos-task", "--json", "--compact"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({ created: 0, skipped: 1, evidencePath }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(1);
    const value = JSON.parse(health.stdout);
    expect(value.expectations[0].failure.classification).toBe("route_functional");
    expect(value.expectations[0].failure.evidence.error).toContain("failed to update source task");
  });

  test("health JSON does not treat unrelated successful result arrays as route blockers", () => {
    const dataDir = freshDataDir("loops-cli-health-route-functional-scope-");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "successful-json-report",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "reporter", args: ["--json"] },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "succeeded",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: JSON.stringify({
            results: [
              {
                kind: "created",
                event: {
                  subject: "unrelated-blocked-record",
                  data: { tags: ["blocked"], status: "blocked" },
                },
              },
            ],
          }),
          stderr: "",
          exitCode: 0,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const health = runCli(dataDir, ["health", "--json"]);
    expect(health.status).toBe(0);
    const value = JSON.parse(health.stdout);
    expect(value.ok).toBe(true);
    expect(value.classifications.route_functional).toBe(0);
    expect(value.expectations[0].check.id).toBe("latest-run-succeeded");
  });

  test("health scan writes bounded reports and dry-runs deduped todo upserts", () => {
    const dataDir = freshDataDir("loops-cli-health-scan-");
    const reportRoot = join(dataDir, "scan-reports");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const active = store.createLoop({
        name: "active-scan-failure",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/active-scan" },
      });
      const paused = store.createLoop({
        name: "paused-scan-failure",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "false", cwd: "/tmp/paused-scan" },
      });
      store.updateLoop(paused.id, { status: "paused" });
      for (const loop of [active, paused]) {
        const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
        expect(claim).toBeDefined();
        store.finalizeRun(
          claim!.run.id,
          {
            status: "failed",
            finishedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1_000,
            stdout: "",
            stderr: "runtime preflight failed: executable not found in path",
            error: "runtime preflight failed",
            exitCode: 1,
          },
          { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
        );
      }
    } finally {
      store.close();
    }

    const scan = runCli(dataDir, [
      "--json",
      "health",
      "scan",
      "--include",
      "active,paused",
      "--daemon",
      "--report-dir",
      reportRoot,
      "--upsert-todos",
      "--dry-run",
      "--max-actions",
      "2",
    ]);

    expect(scan.status).toBe(2);
    const value = JSON.parse(scan.stdout);
    expect(value.status).toBe("critical");
    expect(value.counts.loops).toBe(2);
    expect(value.counts.latestRunFindings).toBe(2);
    expect(value.counts.daemonFindings).toBe(1);
    expect(value.findings.map((finding: { kind: string }) => finding.kind).sort()).toEqual(["daemon", "latest-run", "latest-run"]);
    expect(value.reports.dir).toContain(reportRoot);
    expect(existsSync(value.reports.json)).toBe(true);
    expect(existsSync(value.reports.markdown)).toBe(true);
    expect(JSON.parse(readFileSync(value.reports.json, "utf8")).status).toBe("critical");
    expect(value.todos.actions).toHaveLength(2);
    expect(value.todos.actions[0]).toMatchObject({ action: "would-upsert" });
    expect(value.todos.actions[0].metadata.no_tmux_dispatch).toBe(true);
    expect(JSON.stringify(value)).not.toContain("fake-project-");
  });

  test("health route-tasks dry-run reports deduped task upserts without mutating todos", () => {
    const dataDir = freshDataDir("loops-cli-health-route-dry-run-");
    const evidenceDir = join(dataDir, "evidence");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health-route",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "Invalid schema for response_format",
          error: "response_format json schema error",
          exitCode: 1,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const defaultResult = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "2"]);
    expect(defaultResult.status).toBe(0);
    const defaultValue = JSON.parse(defaultResult.stdout);
    expect(defaultValue.actions[0].tags).not.toContain("auto:route");
    expect(defaultValue.actions[0].metadata.route_enabled).toBe(false);
    expect(defaultValue.actions[0].metadata.project_path).toBeNull();
    expect(defaultValue.actions[0].metadata.working_dir).toBeNull();
    expect(defaultValue.actions[0].autoRoute).toMatchObject({ requested: false, enabled: false });

    const result = runCli(dataDir, [
      "--json",
      "health",
      "route-tasks",
      "--dry-run",
      "--max-actions",
      "2",
      "--auto-route",
      "--evidence-dir",
      evidenceDir,
    ]);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.routing.key).not.toBe(defaultValue.routing.key);
    expect(value.failures).toBe(1);
    expect(value.actions[0]).toMatchObject({
      action: "would-upsert",
      priority: "medium",
    });
    expect(value.actions[0].tags).toContain("auto:route");
    expect(value.actions[0].metadata).toMatchObject({
      classification: "schema_response_format",
      route_enabled: true,
      project_path: "/tmp/repo",
      automation: { allowed: true, source: "openloops.health.route-tasks" },
      no_tmux_dispatch: true,
    });
    expect(value.evidencePath).toContain(evidenceDir);
    expect(existsSync(value.evidencePath)).toBe(true);
    expect(JSON.parse(readFileSync(value.evidencePath, "utf8")).failures).toBe(1);

    const repeated = runCli(dataDir, [
      "--json",
      "health",
      "route-tasks",
      "--dry-run",
      "--max-actions",
      "2",
      "--auto-route",
      "--evidence-dir",
      evidenceDir,
    ]);
    expect(repeated.status).toBe(0);
    const repeatedValue = JSON.parse(repeated.stdout);
    expect(repeatedValue.evidencePath).not.toBe(value.evidencePath);
    expect(existsSync(repeatedValue.evidencePath)).toBe(true);
  });

  test("health route-tasks passes working-dir to todos upsert for auto-routed tasks", () => {
    const dataDir = freshDataDir("loops-cli-health-route-working-dir-");
    const binDir = join(dataDir, "bin");
    const argLog = join(dataDir, "todos-args.log");
    mkdirSync(binDir, { recursive: true });
    const todos = join(binDir, "todos");
    writeFileSync(
      todos,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$TODOS_ARG_LOG\"",
        "if [[ \"$*\" == *\"task-lists\"* && \"$*\" == *\"--json\"* ]]; then",
        "  printf '[{\"id\":\"list-1\",\"slug\":\"loop-error-self-heal\"}]\\n'",
        "  exit 0",
        "fi",
        "if [[ \"$*\" == *\"task upsert\"* ]]; then",
        "  prev=''",
        "  for arg in \"$@\"; do",
        "    if [[ \"$prev\" == \"--working-dir\" ]]; then printf 'WORKING_DIR=%s\\n' \"$arg\" >> \"$TODOS_ARG_LOG\"; fi",
        "    if [[ \"$prev\" == \"--tags\" ]]; then printf 'TAGS=%s\\n' \"$arg\" >> \"$TODOS_ARG_LOG\"; fi",
        "    prev=\"$arg\"",
        "  done",
        "  printf '{\"task\":{\"id\":\"task-1\"}}\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(todos, 0o755);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const loop = store.createLoop({
        name: "agent-health-working-dir",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(
        claim!.run.id,
        {
          status: "failed",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          error: "429 too many requests",
          exitCode: 1,
        },
        { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
      );
    } finally {
      store.close();
    }

    const result = runCli(
      dataDir,
      ["--json", "health", "route-tasks", "--max-actions", "1", "--auto-route", "--project", join(dataDir, "todos-project")],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_ARG_LOG: argLog },
    );

    expect(result.status).toBe(0);
    const log = readFileSync(argLog, "utf8");
    expect(log).toContain("WORKING_DIR=/tmp/repo");
    expect(log).toContain("TAGS=bug,openloops,loops,loop-health,rate_limit,auto:route");
  });

  test("runtime preflight failures are finalized and routed as preflight health tasks", () => {
    const dataDir = freshDataDir("loops-cli-runtime-preflight-health-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "runtime-preflight-health",
      "--at",
      futureAt(),
      "--cmd",
      "definitely-missing-openloops-runtime-preflight-binary",
      "--no-shell",
      "--preflight-each-run",
    ]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "run-now", "runtime-preflight-health"]);
    expect(run.status).toBe(1);
    const runValue = JSON.parse(run.stdout);
    expect(runValue.status).toBe("failed");
    expect(runValue.error).toContain("runtime preflight failed");

    const result = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "2"]);
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.failures).toBe(1);
    expect(value.actions[0]).toMatchObject({
      action: "would-upsert",
      priority: "medium",
    });
    expect(value.actions[0].metadata).toMatchObject({
      classification: "preflight",
      no_tmux_dispatch: true,
    });
  });

  test("health route-tasks ignores stopped loops unless include-inactive is set and dedupe survives renames", () => {
    const dataDir = freshDataDir("loops-cli-health-route-active-only-");
    const store = new Store(join(dataDir, "loops.db"));
    let firstFingerprint = "";
    try {
      const active = store.createLoop({
        name: "agent-health-rename-old",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      const stopped = store.createLoop({
        name: "agent-health-stopped",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "agent", provider: "codewith", prompt: "run", cwd: "/tmp/repo" },
      });
      store.updateLoop(stopped.id, { status: "stopped", nextRunAt: undefined });
      for (const loop of [active, stopped]) {
        const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
        expect(claim).toBeDefined();
        store.finalizeRun(
          claim!.run.id,
          {
            status: "failed",
            finishedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1_000,
            stderr: `Rate limit at 2026-01-01T00:00:01.000Z for ${loop.name}`,
            error: "429 too many requests",
            exitCode: 1,
          },
          { claimedBy: "seed", claimToken: claim!.claimToken, now: new Date("2026-01-01T00:00:00.500Z") },
        );
      }
    } finally {
      store.close();
    }

    const activeOnly = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "10"]);
    expect(activeOnly.status).toBe(0);
    const activeValue = JSON.parse(activeOnly.stdout);
    expect(activeValue.failures).toBe(1);
    firstFingerprint = activeValue.actions[0].fingerprint;

    const includeInactive = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--include-inactive", "--max-actions", "10"]);
    expect(includeInactive.status).toBe(0);
    expect(JSON.parse(includeInactive.stdout).failures).toBe(2);

    const renameStore = new Store(join(dataDir, "loops.db"));
    try {
      const loop = renameStore.findLoopByName("agent-health-rename-old")!;
      renameStore.renameLoop(loop.id, "agent-health-rename-new");
    } finally {
      renameStore.close();
    }
    const afterRename = runCli(dataDir, ["--json", "health", "route-tasks", "--dry-run", "--max-actions", "10"]);
    expect(JSON.parse(afterRename.stdout).actions[0].fingerprint).toBe(firstFingerprint);
  });

  test("expectations JSON is read-only and honors temp LOOPS_DATA_DIR", () => {
    // Deliberately unseeded: this test proves the CLI creates loops.db inside
    // LOOPS_DATA_DIR (and never under $HOME/.hasna), so the db must not exist yet.
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-expectations-temp-data-"));
    const home = mkdtempSync(join(tmpdir(), "loops-cli-expectations-home-"));
    const create = runCli(dataDir, ["create", "command", "isolated", "--at", futureAt(), "--cmd", "true"], undefined, { HOME: home });
    expect(create.status).toBe(0);

    const result = runCli(dataDir, ["expectations", "isolated", "--json"], undefined, { HOME: home });
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.loop.name).toBe("isolated");
    expect(value.check.status).toBe("warn");
    expect(existsSync(join(dataDir, "loops.db"))).toBe(true);
    expect(existsSync(join(home, ".hasna"))).toBe(false);
  });

  test("workflow JSON run and inspect redact step output without show-output", () => {
    const dataDir = freshDataDir("loops-cli-workflow-redact-");
    const secret = "SECRET_WORKFLOW_JSON_OUTPUT";
    const file = workflowFile(dataDir, {
      name: "workflow-redact",
      steps: [
        {
          id: "secret-step",
          target: {
            type: "command",
            command: `printf ${JSON.stringify(secret)}`,
            shell: true,
          },
        },
      ],
    });
    const create = runCli(dataDir, ["--json", "workflows", "create", file]);
    expect(create.status).toBe(0);

    const run = runCli(dataDir, ["--json", "workflows", "run", "workflow-redact"]);
    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(secret);
    const value = JSON.parse(run.stdout);
    expect(value.result.stdout).toContain("[redacted");
    expect(value.steps[0].stdout).toContain("[redacted");

    const inspect = runCli(dataDir, ["--json", "workflows", "inspect", value.workflowRun.id]);
    expect(inspect.status).toBe(0);
    expect(inspect.stdout).not.toContain(secret);
    const inspected = JSON.parse(inspect.stdout);
    expect(inspected.steps[0].stdout).toContain("[redacted");
  });

  test("create --goal persists goal config and goal show renders it", () => {
    const dataDir = freshDataDir("loops-cli-goal-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "goal-loop",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--goal",
      "verify the command result",
      "--goal-budget",
      "50",
      "--goal-model",
      "openai/gpt-4o-mini",
      "--goal-max-turns",
      "2",
    ]);
    expect(create.status).toBe(0);
    const value = JSON.parse(create.stdout);
    expect(value.goal).toBeUndefined();

    const show = runCli(dataDir, ["--json", "goal", "show", "goal-loop"]);
    expect(show.status).toBe(0);
    const goal = JSON.parse(show.stdout);
    expect(goal.config.objective).toBe("verify the command result");
    expect(goal.config.model).toBe("openai/gpt-4o-mini");
  });

  test("--goal requires a non-empty objective", () => {
    const dataDir = freshDataDir("loops-cli-empty-goal-");
    const create = runCli(dataDir, ["create", "command", "bad-goal", "--at", futureAt(), "--cmd", "true", "--goal", " "]);
    expect(create.status).not.toBe(0);
    expect(create.stderr).toContain("goal.objective");
  });

  test("templates render task worker/verifier workflow JSON", () => {
    const dataDir = freshDataDir("loops-cli-template-render-");
    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout).map((template: { id: string }) => template.id)).toEqual(expect.arrayContaining(["todos-task-worker-verifier", "event-worker-verifier"]));

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-12345678",
      "--var",
      "taskTitle=Fix parser",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "todosProjectPath=/tmp/todos-store",
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      "sandbox=workspace-write",
      "--var",
      "addDirs=/tmp/todos-store,/tmp/loops-store",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("task-123");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(workflow.steps[0].target).toMatchObject({
      type: "command",
      command: "bash",
      cwd: "/tmp/repo",
    });
    expect(workflow.steps[0].target.args.join("\n")).toContain("todos --project '/tmp/todos-store' --json inspect 'task-12345678'");
    expect(workflow.steps[1].dependsOn).toEqual(["source-task-gate"]);
    expect(workflow.steps[1].target).toMatchObject({
      type: "agent",
      provider: "codewith",
      cwd: "/tmp/repo",
      authProfile: "account005",
      permissionMode: "bypass",
      sandbox: "workspace-write",
      addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
    });
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(workflow.steps[2].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Do not dispatch or paste prompts into tmux panes");
    expect(workflow.steps[2].target.addDirs).toEqual(["/tmp/todos-store", "/tmp/loops-store"]);
    expect(workflow.steps[1].target.timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();
    expect(workflow.steps[2].target.timeoutMs).toBeNull();
    expect(workflow.steps[2].timeoutMs).toBeNull();
    expect(workflow.steps[2].target.idleTimeoutMs).toBe(900_000);
    expect(workflow.steps[2].dependsOn).toEqual(["worker"]);

    const noIdleRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-no-idle-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "verifierIdleTimeoutMs=none",
    ]);
    expect(noIdleRender.status).toBe(0);
    const noIdleWorkflow = JSON.parse(noIdleRender.stdout);
    expect(noIdleWorkflow.steps.find((step: { id: string }) => step.id === "verifier").target.idleTimeoutMs).toBeUndefined();

    const finiteRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-87654321",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(finiteRender.status).toBe(0);
    const finiteWorkflow = JSON.parse(finiteRender.stdout);
    expect(finiteWorkflow.steps[1].timeoutMs).toBe(600_000);
    expect(finiteWorkflow.steps[2].timeoutMs).toBe(600_000);
  });

  test("templates fail closed for danger-full-access unless manual break-glass is explicit", () => {
    const dataDir = freshDataDir("loops-cli-template-danger-sandbox-");
    const rejected = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-danger-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "sandbox=danger-full-access",
    ]);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("manual break-glass");

    const allowed = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-danger-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "sandbox=danger-full-access",
      "--var",
      "manualBreakGlass=true",
      "--var",
      "safetyReason=operator-approved isolated template test",
    ]);
    expect(allowed.status).toBe(0);
    const workflow = JSON.parse(allowed.stdout);
    expect(workflow.steps[1].target.sandbox).toBe("danger-full-access");
    expect(workflow.steps[1].target.allowlist.commands).toContain("manual-break-glass");
    expect(workflow.steps[1].target.allowlist.safetyReason).toBe("operator-approved isolated template test");
  });

  test("templates render lifecycle and deterministic producer workflows", () => {
    const dataDir = freshDataDir("loops-cli-template-lifecycle-");
    const repo = createGitRepo("loops-cli-template-lifecycle-repo-");
    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    const ids = JSON.parse(list.stdout).map((template: { id: string }) => template.id);
    expect(ids).toEqual(expect.arrayContaining([
      "task-lifecycle",
      "pr-review",
      "scheduled-audit",
      "knowledge-refresh",
      "report-only",
      "incident-response",
      "deterministic-check-create-task",
      "routing-remediation",
    ]));

    const prReview = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "pr-review",
      "--var",
      "prUrl=https://github.com/hasna/loops/pull/123",
      "--var",
      `projectPath=${repo}`,
    ]);
    expect(prReview.status).toBe(0);
    const prWorkflow = JSON.parse(prReview.stdout);
    expect(prWorkflow.name).toContain("pr-review");
    expect(prWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(prWorkflow.steps[0].target.worktree.mode).toBe("required");
    expect(prWorkflow.steps[0].timeoutMs).toBeNull();
    expect(prWorkflow.steps[1].timeoutMs).toBeNull();
    expect(prWorkflow.steps[1].target.idleTimeoutMs).toBe(900_000);

    const lifecycle = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "task-lifecycle",
      "--var",
      "taskId=task-lifecycle-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(lifecycle.status).toBe(0);
    const lifecycleWorkflow = JSON.parse(lifecycle.stdout);
    const lifecycleStepsById = Object.fromEntries(lifecycleWorkflow.steps.map((step: { id: string }) => [step.id, step]));
    expect(lifecycleStepsById.triage.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.planner.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.worker.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById.verifier.timeoutMs).toBe(600_000);
    expect(lifecycleStepsById["triage-gate"].timeoutMs).toBe(120_000);
    expect(lifecycleStepsById["planner-gate"].timeoutMs).toBe(120_000);

    const routingRemediation = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "routing-remediation",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "todosProjectPath=/tmp/todos-store",
      "--var",
      "dryRun=false",
      "--var",
      "maxRepairs=2",
      "--var",
      "shard=0/6",
      "--var",
      "idempotencyKey=routing-health:open-loops:shard0",
    ]);
    expect(routingRemediation.status).toBe(0);
    const routingWorkflow = JSON.parse(routingRemediation.stdout);
    expect(routingWorkflow.name).toContain("routing-remediation");
    expect(routingWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["routing-doctor-preflight", "worker", "verifier"]);
    expect(routingWorkflow.steps[0].target.type).toBe("command");
    expect(routingWorkflow.steps[0].target.args.join("\n")).toContain("OPENLOOPS_ROUTING_REMEDIATION_MAX_REPAIRS='2'");
    expect(routingWorkflow.steps[0].target.args.join("\n")).toContain("\"--shard\",\"0/6\"");
    expect(routingWorkflow.steps[0].blockedExitCodes).toEqual([12]);
    expect(routingWorkflow.steps[1].target.prompt).toContain("[redacted");
    expect(routingWorkflow.steps[1].target.worktree.mode).toBe("required");

    const deterministic = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "deterministic-check-create-task",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "checkCommand=echo ok",
    ]);
    expect(deterministic.status).toBe(0);
    const deterministicWorkflow = JSON.parse(deterministic.stdout);
    expect(deterministicWorkflow.steps).toHaveLength(1);
    expect(deterministicWorkflow.steps[0].target.type).toBe("command");
    expect(deterministicWorkflow.steps[0].target.args).toEqual(["-lc", "echo ok"]);
    expect(deterministicWorkflow.steps[0].target.timeoutMs).toBe(300_000);

    const deterministicNoTimeout = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "deterministic-check-create-task",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "checkCommand=echo ok",
      "--var",
      "timeoutMs=none",
    ]);
    expect(deterministicNoTimeout.status).not.toBe(0);
    expect(deterministicNoTimeout.stderr).toContain("timeoutMs");

    const reportOnly = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "report-only",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "objective=Inspect recent work and write a report only",
    ]);
    expect(reportOnly.status).toBe(0);
    const reportWorkflow = JSON.parse(reportOnly.stdout);
    expect(reportWorkflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(reportWorkflow.steps.map((step: { target: { sandbox?: string } }) => step.target.sandbox)).toEqual(["read-only", "read-only"]);
    expect(reportWorkflow.steps.map((step: { target: { worktree?: { mode?: string } } }) => step.target.worktree?.mode)).toEqual(["main", "main"]);
  });

  test("templates show explains task-lifecycle variables and usage", () => {
    const dataDir = freshDataDir("loops-cli-template-show-");

    const show = runCli(dataDir, ["templates", "show", "task-lifecycle"]);

    expect(show.status).toBe(0);
    expect(show.stdout).toContain("task-lifecycle (workflow)");
    expect(show.stdout).toContain("Task Lifecycle");
    expect(show.stdout).toContain("Run the standard task-created lifecycle");
    expect(show.stdout).toContain("taskId");
    expect(show.stdout).toContain("required");
    expect(show.stdout).toContain("worktreeMode");
    expect(show.stdout).toContain("default=required");
    expect(show.stdout).toContain("loops templates render task-lifecycle");
    expect(show.stdout).toContain("loops workflows create --template task-lifecycle");
  });

  test("custom templates import, list, show, render, and create workflow", () => {
    const dataDir = freshDataDir("loops-cli-custom-template-");
    const sourceFile = join(dataDir, "custom-report-template.json");
    writeFileSync(sourceFile, JSON.stringify({
      id: "custom-report",
      name: "Custom Report",
      description: "Run a custom report workflow from the local template registry.",
      kind: "workflow",
      variables: [
        { name: "objective", required: true, description: "Report objective." },
        { name: "projectPath", required: true, description: "Working directory." },
        { name: "provider", default: "codewith", description: "Agent provider." },
        { name: "sandbox", default: "workspace-write", description: "Sandbox mode." },
        { name: "timeoutMs", default: "300000", type: "number", description: "Step timeout." },
      ],
      workflow: {
        name: "custom-report-${objective}",
        description: "Report workflow for ${objective}",
        version: 1,
        steps: [
          {
            id: "worker",
            name: "Worker",
            description: "Produce the custom report.",
            target: {
              type: "agent",
              provider: "${provider}",
              prompt: "/goal ${objective}\nProduce the requested report only.",
              cwd: "${projectPath}",
              configIsolation: "safe",
              permissionMode: "bypass",
              sandbox: "${sandbox}",
              timeoutMs: "${timeoutMs}",
            },
            timeoutMs: "${timeoutMs}",
          },
        ],
      },
    }));

    const imported = runCli(dataDir, ["--json", "templates", "import", sourceFile]);
    expect(imported.status).toBe(0);
    const importResult = JSON.parse(imported.stdout);
    expect(importResult.template).toMatchObject({ id: "custom-report", source: "custom" });
    expect(importResult.path).toContain(join(dataDir, "templates", "custom-report.json"));

    const list = runCli(dataDir, ["--json", "templates", "list"]);
    expect(list.status).toBe(0);
    const listed = JSON.parse(list.stdout) as Array<{ id: string; source: string }>;
    expect(listed).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "todos-task-worker-verifier", source: "builtin" }),
      expect.objectContaining({ id: "custom-report", source: "custom" }),
    ]));

    const customOnly = runCli(dataDir, ["--json", "templates", "list", "--source", "custom"]);
    expect(customOnly.status).toBe(0);
    expect(JSON.parse(customOnly.stdout).map((template: { id: string }) => template.id)).toEqual(["custom-report"]);

    const show = runCli(dataDir, ["--json", "templates", "show", "custom-report"]);
    expect(show.status).toBe(0);
    const shown = JSON.parse(show.stdout);
    expect(shown.source).toBe("custom");
    expect(shown.sourcePath).toContain("custom-report.json");

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "custom-report",
      "--var",
      "objective=Docs drift",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "timeoutMs=120000",
    ]);
    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toBe("custom-report-Docs drift");
    expect(workflow.steps[0].target).toMatchObject({
      type: "agent",
      provider: "codewith",
      cwd: "/tmp/repo",
      sandbox: "workspace-write",
      timeoutMs: 120000,
    });
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("/goal Docs drift");
    expect(workflow.steps[0].timeoutMs).toBe(120000);

    const created = runCli(dataDir, [
      "--json",
      "templates",
      "create-workflow",
      "custom-report",
      "--var",
      "objective=Docs drift",
      "--var",
      "projectPath=/tmp/repo",
    ]);
    expect(created.status).toBe(0);
    const stored = JSON.parse(created.stdout);
    expect(stored.name).toBe("custom-report-Docs drift");
    expect(stored.steps).toHaveLength(1);
  });

  test("custom templates fail closed for invalid and dangerous definitions", () => {
    const dataDir = freshDataDir("loops-cli-custom-template-invalid-");
    const registryDir = join(dataDir, "templates");
    mkdirSync(registryDir, { recursive: true });
    const dangerous = join(registryDir, "danger.json");
    writeFileSync(dangerous, JSON.stringify({
      id: "danger",
      name: "Danger",
      description: "Dangerous custom workflow.",
      kind: "workflow",
      workflow: {
        name: "danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal danger",
              sandbox: "danger-full-access",
            },
          },
        ],
      },
    }));

    const list = runCli(dataDir, ["--json", "templates", "list", "--source", "custom"]);
    expect(list.status).not.toBe(0);
    expect(list.stderr).toContain("danger-full-access");

    const invalidDataDir = freshDataDir("loops-cli-custom-template-invalid-shape-");
    const invalidFile = join(invalidDataDir, "invalid-template.json");
    writeFileSync(invalidFile, JSON.stringify({ id: "invalid", name: "Invalid", kind: "workflow" }));
    const imported = runCli(invalidDataDir, ["--json", "templates", "import", invalidFile]);
    expect(imported.status).not.toBe(0);
    expect(imported.stderr).toContain("description");

    const invalidRequiredFile = join(invalidDataDir, "invalid-required-template.json");
    writeFileSync(invalidRequiredFile, JSON.stringify({
      id: "invalid-required",
      name: "Invalid Required",
      description: "Invalid required flag.",
      kind: "workflow",
      variables: [{ name: "objective", required: "false" }],
      workflow: {
        name: "invalid-required",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    const invalidRequired = runCli(invalidDataDir, ["--json", "templates", "import", invalidRequiredFile]);
    expect(invalidRequired.status).not.toBe(0);
    expect(invalidRequired.stderr).toContain("required");

    const implicitDangerDataDir = freshDataDir("loops-cli-custom-template-implicit-danger-");
    const implicitDangerFile = join(implicitDangerDataDir, "implicit-danger-template.json");
    writeFileSync(implicitDangerFile, JSON.stringify({
      id: "implicit-danger",
      name: "Implicit Danger",
      description: "Codewith bypass without explicit sandbox.",
      kind: "workflow",
      workflow: {
        name: "implicit-danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal implicit danger",
              permissionMode: "bypass",
            },
          },
        ],
      },
    }));
    const implicitDanger = runCli(implicitDangerDataDir, ["--json", "templates", "import", implicitDangerFile]);
    expect(implicitDanger.status).not.toBe(0);
    expect(implicitDanger.stderr).toContain("explicit sandbox");

    const extraArgsDangerDataDir = freshDataDir("loops-cli-custom-template-extra-args-danger-");
    const extraArgsDangerFile = join(extraArgsDangerDataDir, "extra-args-danger-template.json");
    writeFileSync(extraArgsDangerFile, JSON.stringify({
      id: "extra-args-danger",
      name: "Extra Args Danger",
      description: "Dangerous sandbox hidden in extra args.",
      kind: "workflow",
      workflow: {
        name: "extra-args-danger",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal extra args danger",
              sandbox: "workspace-write",
              extraArgs: ["--sandbox", "danger-full-access"],
            },
          },
        ],
      },
    }));
    const extraArgsDanger = runCli(extraArgsDangerDataDir, ["--json", "templates", "import", extraArgsDangerFile]);
    expect(extraArgsDanger.status).not.toBe(0);
    expect(extraArgsDanger.stderr).toContain("dangerous sandbox");

    const promptFileDataDir = freshDataDir("loops-cli-custom-template-prompt-file-");
    const promptFileTemplate = join(promptFileDataDir, "prompt-file-template.json");
    writeFileSync(promptFileTemplate, JSON.stringify({
      id: "prompt-file-template",
      name: "Prompt File Template",
      description: "Custom template must not read local prompt files.",
      kind: "workflow",
      workflow: {
        name: "prompt-file-template",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              promptFile: "/tmp/secret-prompt.md",
              sandbox: "workspace-write",
            },
          },
        ],
      },
    }));
    const promptFileImport = runCli(promptFileDataDir, ["--json", "templates", "import", promptFileTemplate]);
    expect(promptFileImport.status).not.toBe(0);
    expect(promptFileImport.stderr).toContain("promptFile is not allowed in custom templates");

    const safeDataDir = freshDataDir("loops-cli-custom-template-safe-render-");
    const safeFile = join(safeDataDir, "safe-template.json");
    writeFileSync(safeFile, JSON.stringify({
      id: "safe-custom",
      name: "Safe Custom",
      description: "Custom template with sandbox variable.",
      kind: "workflow",
      variables: [
        { name: "sandbox", default: "workspace-write" },
      ],
      workflow: {
        name: "safe-custom",
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "/goal safe",
              sandbox: "${sandbox}",
            },
          },
        ],
      },
    }));
    const safeImport = runCli(safeDataDir, ["--json", "templates", "import", safeFile]);
    expect(safeImport.status).toBe(0);
    const render = runCli(safeDataDir, [
      "--json",
      "templates",
      "render",
      "safe-custom",
      "--var",
      "sandbox=danger-full-access",
    ]);
    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("danger-full-access");
  });

  test("custom templates cannot override built-in template ids", () => {
    const dataDir = freshDataDir("loops-cli-custom-template-collision-");
    const collisionFile = join(dataDir, "collision-template.json");
    writeFileSync(collisionFile, JSON.stringify({
      id: "todos-task-worker-verifier",
      name: "Collision",
      description: "This must not override the built-in template.",
      kind: "workflow",
      workflow: {
        name: "collision",
        steps: [
          {
            id: "worker",
            target: {
              type: "command",
              command: "true",
            },
          },
        ],
      },
    }));

    const imported = runCli(dataDir, ["--json", "templates", "import", collisionFile]);
    expect(imported.status).not.toBe(0);
    expect(imported.stderr).toContain("collides with built-in");

    const firstCustomFile = join(dataDir, "first-custom-template.json");
    writeFileSync(firstCustomFile, JSON.stringify({
      id: "custom-one",
      name: "Custom One",
      description: "First custom template.",
      kind: "workflow",
      workflow: {
        name: "custom-one",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    expect(runCli(dataDir, ["--json", "templates", "import", firstCustomFile]).status).toBe(0);

    const customNameCollisionFile = join(dataDir, "custom-name-collision-template.json");
    writeFileSync(customNameCollisionFile, JSON.stringify({
      id: "custom-two",
      name: "custom-one",
      description: "Second custom template with name colliding with an existing id.",
      kind: "workflow",
      workflow: {
        name: "custom-two",
        steps: [{ id: "check", target: { type: "command", command: "true" } }],
      },
    }));
    const customNameCollision = runCli(dataDir, ["--json", "templates", "import", customNameCollisionFile]);
    expect(customNameCollision.status).not.toBe(0);
    expect(customNameCollision.stderr).toContain("collides with");

    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-collision-12345678",
      "--var",
      "projectPath=/tmp/repo",
    ]);
    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("todos-task-task-col");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
  });

  test("templates select different worker and verifier auth profiles from a pool", () => {
    const dataDir = freshDataDir("loops-cli-template-pool-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-pool-12345678",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=codewith",
      "--var",
      "authProfilePool=account004,account005,account006",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    const profiles = workflow.steps
      .map((step: { target: { authProfile?: string } }) => step.target.authProfile)
      .filter((profile: string | undefined): profile is string => Boolean(profile));
    expect(profiles).toHaveLength(2);
    expect(new Set(profiles).size).toBe(2);
    expect(profiles.every((profile: string) => ["account004", "account005", "account006"].includes(profile))).toBe(true);
  });

  test("templates default git projects to isolated worktrees", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-");
    const repo = createGitRepo("loops-cli-template-worktree-repo-");
    const worktreeRoot = join(dataDir, "worktrees");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-worktree-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      `addDirs=${join(dataDir, "todos-store")}`,
      "--var",
      `worktreeRoot=${worktreeRoot}`,
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(workflow.steps[1].dependsOn).toEqual(["source-task-gate"]);
    expect(workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(workflow.steps[1].target.worktree).toMatchObject({
      mode: "auto",
      enabled: true,
      root: worktreeRoot,
    });
    expect(testPath(workflow.steps[1].target.worktree.originalCwd)).toBe(testPath(repo));
    expect(testPath(workflow.steps[1].target.worktree.repoRoot)).toBe(testPath(repo));
    expect(testPaths(workflow.steps[1].target.addDirs)).toEqual(testPaths([join(dataDir, "todos-store"), join(repo, ".git")]));
    expect(workflow.steps[1].target.worktree.branch).toContain("openloops/");
    expect(workflow.steps[2].target.cwd).toBe(workflow.steps[1].target.cwd);
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("Use the isolated git worktree");
    expect(render.stdout).not.toContain("Do not mutate the original checkout/main branch");
  });

  function stubPwdAgentBin(dataDir: string): string {
    const bin = join(dataDir, "stub-bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/usr/bin/env bash\npwd\ncat >/dev/null\n");
    chmodSync(claude, 0o755);
    return bin;
  }

  function worktreeWorkflowFile(dataDir: string, repo: string, worktree: Record<string, unknown>): string {
    return workflowFile(dataDir, {
      name: "cli-worktree-exec",
      steps: [
        {
          id: "worker",
          target: {
            type: "agent",
            provider: "claude",
            prompt: "print working directory",
            cwd: worktree.cwd,
            timeoutMs: 60_000,
            worktree,
          },
        },
      ],
    });
  }

  test("workflows run prepares and reuses executor-managed worktrees", () => {
    const dataDir = freshDataDir("loops-cli-executor-worktree-");
    const repo = createGitRepo("loops-cli-executor-worktree-repo-");
    const bin = stubPwdAgentBin(dataDir);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    const worktreeRoot = join(dataDir, "worktrees");
    const wtPath = join(worktreeRoot, "repo", "cli-worktree-test");
    const branch = "openloops/cli-worktree-test";
    const file = worktreeWorkflowFile(dataDir, repo, {
      mode: "required",
      enabled: true,
      originalCwd: repo,
      cwd: wtPath,
      repoRoot: repo,
      root: worktreeRoot,
      path: wtPath,
      branch,
    });
    expect(runCli(dataDir, ["workflows", "create", file], undefined, env).status).toBe(0);

    const first = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec", "--show-output"], undefined, env);
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.result.status).toBe("succeeded");
    expect(firstValue.steps[0].stdout.trim().endsWith("cli-worktree-test")).toBe(true);
    const shown = spawnSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" });
    expect(shown.status).toBe(0);
    expect(shown.stdout.trim()).toBe(branch);

    const markerPath = join(wtPath, "untracked-marker.txt");
    writeFileSync(markerPath, "preserve me\n");
    const second = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec"], undefined, env);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).result.status).toBe("succeeded");
    expect(readFileSync(markerPath, "utf8")).toBe("preserve me\n");
  });

  test("workflows run recovers a clean required worktree on an unexpected branch", () => {
    const dataDir = freshDataDir("loops-cli-executor-worktree-branch-");
    const repo = createGitRepo("loops-cli-executor-worktree-branch-repo-");
    const bin = stubPwdAgentBin(dataDir);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    const worktreeRoot = join(dataDir, "worktrees");
    const wtPath = join(worktreeRoot, "repo", "cli-worktree-branch");
    const branch = "openloops/cli-worktree-branch";
    const file = worktreeWorkflowFile(dataDir, repo, {
      mode: "required",
      enabled: true,
      originalCwd: repo,
      cwd: wtPath,
      repoRoot: repo,
      root: worktreeRoot,
      path: wtPath,
      branch,
    });
    expect(runCli(dataDir, ["workflows", "create", file], undefined, env).status).toBe(0);

    const first = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec"], undefined, env);
    expect(first.status).toBe(0);
    git(wtPath, ["checkout", "-b", "unexpected-openloops-branch"]);

    const second = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec", "--show-output"], undefined, env);
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.result.status).toBe("succeeded");
    expect(value.steps[0].status).toBe("succeeded");
    const shown = spawnSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" });
    expect(shown.status).toBe(0);
    expect(shown.stdout.trim()).toBe(branch);
  });

  test("workflows run fails closed when an unexpected required worktree branch has local changes", () => {
    const dataDir = freshDataDir("loops-cli-executor-worktree-dirty-branch-");
    const repo = createGitRepo("loops-cli-executor-worktree-dirty-branch-repo-");
    const bin = stubPwdAgentBin(dataDir);
    const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
    const worktreeRoot = join(dataDir, "worktrees");
    const wtPath = join(worktreeRoot, "repo", "cli-worktree-dirty-branch");
    const branch = "openloops/cli-worktree-dirty-branch";
    const file = worktreeWorkflowFile(dataDir, repo, {
      mode: "required",
      enabled: true,
      originalCwd: repo,
      cwd: wtPath,
      repoRoot: repo,
      root: worktreeRoot,
      path: wtPath,
      branch,
    });
    expect(runCli(dataDir, ["workflows", "create", file], undefined, env).status).toBe(0);

    const first = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec"], undefined, env);
    expect(first.status).toBe(0);
    git(wtPath, ["checkout", "-b", "unexpected-openloops-dirty-branch"]);
    writeFileSync(join(wtPath, "untracked-dirty.txt"), "do not overwrite\n");

    const second = runCli(dataDir, ["--json", "workflows", "run", "cli-worktree-exec", "--show-output"], undefined, env);
    expect(second.status).toBe(1);
    const value = JSON.parse(second.stdout);
    expect(value.result.status).toBe("failed");
    expect(value.steps[0].status).toBe("failed");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const stepError = store.listWorkflowStepRuns(value.workflowRun.id)[0]?.error ?? "";
      expect(stepError).toContain("worktree preparation failed (mode=required)");
      expect(stepError).toContain("unexpected-openloops-dirty-branch");
      expect(stepError).toContain(`expected ${branch}`);
      expect(stepError).toContain("has local changes");
    } finally {
      store.close();
    }
  });

  test("templates allow explicit main checkout mode instead of worktrees", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-main-");
    const repo = createGitRepo("loops-cli-template-worktree-main-repo-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-main-12345678",
      "--var",
      `projectPath=${repo}`,
      "--var",
      "worktreeMode=main",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(workflow.steps[1].target.cwd).toBe(repo);
    expect(workflow.steps[1].target.worktree).toMatchObject({
      mode: "main",
      enabled: false,
      cwd: repo,
      reason: "explicit main/default checkout mode",
    });
  });

  test("templates fail required worktree mode for non-git project paths", () => {
    const dataDir = freshDataDir("loops-cli-template-worktree-required-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-required-worktree",
      "--var",
      "projectPath=/tmp/not-a-real-openloops-repo",
      "--var",
      "worktreeMode=required",
    ]);

    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("worktreeMode=required");
  });

  test("templates render generic event worker/verifier workflow JSON", () => {
    const dataDir = freshDataDir("loops-cli-event-template-render-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-12345678",
      "--var",
      "eventType=knowledge.record.created",
      "--var",
      "eventSource=knowledge",
      "--var",
      "eventJson={\"id\":\"evt-12345678\"}",
      "--var",
      "projectPath=/tmp/knowledge",
      "--var",
      "provider=codewith",
      "--var",
      "authProfile=account005",
      "--var",
      "allowTools=functions.exec_command,functions.view_image",
      "--var",
      "allowCommands=git,bun",
      "--var",
      "safetyReason=bounded event workflow repository access",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("knowledge");
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(workflow.steps[0].target.cwd).toBe("/tmp/knowledge");
    expect(workflow.steps[0].timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();
    for (const step of workflow.steps) {
      expect(step.target.allowlist).toEqual({
        enforcement: "metadata_only",
        tools: ["functions.exec_command", "functions.view_image"],
        commands: ["git", "bun"],
        safetyReason: "bounded event workflow repository access",
      });
    }

    const finiteRender = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-87654321",
      "--var",
      "eventType=knowledge.record.created",
      "--var",
      "eventSource=knowledge",
      "--var",
      "eventJson={\"id\":\"evt-87654321\"}",
      "--var",
      "projectPath=/tmp/knowledge",
      "--var",
      "provider=codewith",
      "--var",
      "timeoutMs=600000",
    ]);
    expect(finiteRender.status).toBe(0);
    const finiteWorkflow = JSON.parse(finiteRender.stdout);
    expect(finiteWorkflow.steps[0].timeoutMs).toBe(600_000);
    expect(finiteWorkflow.steps[1].timeoutMs).toBe(600_000);
  });

  test("templates render bounded agent worker/verifier workflow JSON", () => {
    const dataDir = freshDataDir("loops-cli-bounded-template-render-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "bounded-agent-worker-verifier",
      "--var",
      "objective=Check repo docs drift",
      "--var",
      "prompt=Inspect only recent commits and queue tasks for gaps.",
      "--var",
      "projectPath=/tmp/open-loops",
      "--var",
      "provider=codewith",
      "--var",
      "authProfilePool=account004,account005",
      "--var",
      "sandbox=workspace-write",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    expect(workflow.name).toContain("bounded-agent");
    expect(workflow.name).toMatch(/^bounded-agent-[a-f0-9]{8}-worker-verifier$/);
    expect(workflow.steps.map((step: { id: string }) => step.id)).toEqual(["worker", "verifier"]);
    expect(workflow.steps[0].target.prompt).toContain("[redacted");
    expect(workflow.steps[1].target.prompt).toContain("[redacted");
    expect(render.stdout).not.toContain("/goal Check repo docs drift");
    expect(render.stdout).not.toContain("Inspect only recent commits and queue tasks for gaps.");
    expect(new Set(workflow.steps.map((step: { target: { authProfile?: string } }) => step.target.authProfile)).size).toBe(2);
    expect(workflow.steps[0].timeoutMs).toBeNull();
    expect(workflow.steps[1].timeoutMs).toBeNull();
  });

  test("templates select different OpenAccounts profiles from a pool", () => {
    const dataDir = freshDataDir("loops-cli-event-template-pool-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "event-worker-verifier",
      "--var",
      "eventId=evt-pool-12345678",
      "--var",
      "eventType=task.ready",
      "--var",
      "eventSource=todos",
      "--var",
      "eventJson={\"id\":\"evt-pool-12345678\"}",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=claude",
      "--var",
      "accountPool=account002,account003",
      "--var",
      "accountTool=claude",
    ]);

    expect(render.status).toBe(0);
    const workflow = JSON.parse(render.stdout);
    const accounts = workflow.steps.map((step: { target: { account?: { profile: string; tool?: string } } }) => step.target.account);
    expect(accounts.map((account: { profile: string }) => account.profile).sort()).toEqual(["account002", "account003"]);
    expect(accounts.every((account: { tool?: string }) => account.tool === "claude")).toBe(true);
  });

  test("templates reject provider-native auth profile pools for non-Codewith providers", () => {
    const dataDir = freshDataDir("loops-cli-template-native-auth-provider-");
    const render = runCli(dataDir, [
      "--json",
      "templates",
      "render",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-native-auth",
      "--var",
      "projectPath=/tmp/repo",
      "--var",
      "provider=claude",
      "--var",
      "authProfilePool=account004,account005",
    ]);

    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain("authProfile");
    expect(render.stderr).toContain("provider codewith");
  });

  test("todos task event handler creates a deduped one-shot workflow loop", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-");
    const event = {
      id: "evt-task-created-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-0001",
        title: "Fix event bridge",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const replayedEvent = {
      ...event,
      id: "evt-task-created-0002",
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--provider",
      "codewith",
      "--auth-profile",
      "account005",
      "--auth-profile-pool",
      "account004,account005,account006",
      "--todos-project",
      "/tmp/todos-store",
      "--add-dir",
      "/tmp/todos-store,/tmp/loops-store",
      "--sandbox",
      "workspace-write",
      "--permission-mode",
      "bypass",
      "--timeout",
      "10m",
      "--verifier-idle-timeout",
      "2m",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.idempotencyKey).toBe("todos-task:task-created-0001");
    expect(firstValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(firstValue.loop.name).toContain("event:todos-task:task-cre:");
    expect(firstValue.loop.name).not.toContain("evt-task");
    expect(firstValue.loop.target.workflowId).toBe(firstValue.workflow.id);
    const privateWorkflow = storedWorkflow(dataDir, firstValue.workflow.id)!;
    const routedProfiles = privateWorkflow.steps
      .map((step) => (step.target.type === "agent" ? step.target.authProfile : undefined))
      .filter((profile: string | undefined): profile is string => Boolean(profile));
    expect(new Set(routedProfiles).size).toBe(2);
    const agentSteps = privateWorkflow.steps.filter((step) => step.target.type === "agent");
    for (const step of agentSteps) {
      if (step.target.type !== "agent") {
        throw new Error("expected private agent target");
      }
      expect(step.target).toMatchObject({
        type: "agent",
        provider: "codewith",
        cwd: "/tmp/open-todos",
        permissionMode: "bypass",
        sandbox: "workspace-write",
        addDirs: ["/tmp/todos-store", "/tmp/loops-store"],
      });
      expect(step.timeoutMs).toBe(600_000);
      expect(step.target.timeoutMs).toBe(600_000);
      expect(step.target.authProfile).toBeDefined();
      expect(["account004", "account005", "account006"]).toContain(step.target.authProfile!);
    }
    const verifierStep = firstValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(verifierStep.target.idleTimeoutMs).toBeUndefined();
    const privateVerifierStep = privateWorkflow.steps.find((step) => step.id === "verifier");
    expect(privateVerifierStep?.target).toMatchObject({ idleTimeoutMs: 120_000 });

    const second = runCli(dataDir, args, JSON.stringify(replayedEvent));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.idempotencyKey).toBe(firstValue.idempotencyKey);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });

  test("todos task event handler skips missing source tasks before creating a loop", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-missing-source-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"inspect\" ]]; then",
        "    printf 'task not found\\n' >&2",
        "    exit 1",
        "  fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const event = {
      id: "evt-task-created-missing-source",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-missing-source",
        title: "Missing source task",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--todos-project", join(dataDir, "todos-source")],
      JSON.stringify(event),
      { PATH: `${binDir}:/usr/bin:/bin`, OPENLOOPS_TEST_DISABLE_AUTO_SOURCE_TASK: "1" },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    expect(value.blocked).toBe(true);
    expect(value.reason).toContain("source todos task is not resolvable");
    expect(value.sourceTaskResolution).toMatchObject({
      checked: true,
      resolved: false,
      taskId: "task-created-missing-source",
      todosProjectPath: join(dataDir, "todos-source"),
      // Trimmed: stderr is trimmed before the truthiness test so a whitespace-only
      // stderr cannot short-circuit past the exit status and hide the only
      // diagnostic. Asserting the untrimmed "task not found\n" pinned the behaviour
      // that hid it.
      error: "task not found",
    });
    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("todos task drain smoke admits one task-lifecycle workflow for a disposable repo and dedupes replay", () => {
    const dataDir = freshDataDir("loops-cli-task-lifecycle-smoke-");
    const repo = createGitRepoIn(dataDir, "repo-");
    const binDir = fakeTodosReadyBin(dataDir);
    const evidenceDir = join(dataDir, "evidence");
    const todosProject = join(dataDir, "todos-project");
    const ready = [
      {
        id: "task-lifecycle-smoke-one",
        title: "Route disposable repo task",
        description: [
          "Objective: prove the task lifecycle route is hermetic.",
          `Repository/project: ${repo}`,
          "Routing metadata:",
          "  route_enabled: true",
          "  automation.allowed: true",
          "  automation.mode: auto",
          "  workflow: task-lifecycle",
          "  worktree_mode: required",
        ].join("\n"),
        status: "pending",
        working_dir: repo,
        project_path: repo,
        tags: ["auto:route", "repo:open-loops", "task-lifecycle"],
        metadata: {
          route_enabled: true,
          automation: { allowed: true, mode: "auto" },
          workflow: "task-lifecycle",
          worktree_mode: "required",
          project_group: "oss",
          auth_profile_pool: "account004,account005",
        },
      },
    ];
    const env = isolatedRouteEnv(dataDir, {
      PATH: `${binDir}:/usr/bin:/bin`,
      TODOS_READY_JSON: JSON.stringify(ready),
    });
    const args = [
      "--json",
      "events",
      "drain",
      "todos-task",
      "--todos-project",
      todosProject,
      "--limit",
      "10",
      "--max-dispatch",
      "5",
      "--template",
      "task-lifecycle",
      "--provider",
      "codewith",
      "--auth-profile-pool",
      "account004,account005",
      "--sandbox",
      "workspace-write",
      "--permission-mode",
      "bypass",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
      "--project-group",
      "oss",
      "--pr-handoff",
      "--evidence-dir",
      evidenceDir,
      "--compact",
    ];

    const first = runCli(dataDir, args, undefined, env);
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue).toMatchObject({
      scanned: 1,
      considered: 1,
      created: 1,
      deduped: 0,
      skipped: 0,
      templateId: "task-lifecycle",
      todosProject,
    });
    expect(firstValue.results).toHaveLength(1);
    expect(firstValue.results[0]).toMatchObject({
      kind: "created",
      taskId: "task-lifecycle-smoke-one",
      providerRouting: { provider: "codewith" },
      routeScope: "todos-task",
      machineId: expect.any(String),
      workItemId: expect.any(String),
      workItemStatus: "admitted",
    });
    expect(firstValue.evidencePath).toContain(evidenceDir);
    expect(existsSync(firstValue.evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(firstValue.evidencePath, "utf8"));
    expect(evidence.results[0].workflow.steps.map((step: { id: string }) => step.id)).toEqual([
      "source-task-gate",
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "pr-handoff",
      "verifier",
      "task-evidence-check",
    ]);

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const items = store.listWorkflowWorkItems({ routeKey: "todos-task" });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        status: "admitted",
        idempotencyKey: "todos-task:task-lifecycle-smoke-one",
        projectGroup: "oss",
      });
      expect(items[0]!.projectKey).toBeDefined();
      expect(testPath(items[0]!.projectKey!)).toBe(testPath(repo));
      const loops = store.listLoops({ includeArchived: true });
      const workflows = store.listWorkflows();
      expect(loops).toHaveLength(1);
      expect(workflows).toHaveLength(1);
      const workflow = workflows[0]!;
      const agentSteps = agentStepsOf(workflow as { steps: TestWorkflowStep[] });
      expect(agentSteps.map((step) => step.id)).toEqual(["triage", "planner", "worker", "verifier"]);
      const worker = agentSteps.find((step) => step.id === "worker")!;
      const verifier = agentSteps.find((step) => step.id === "verifier")!;
      expect(worker.target.worktree).toMatchObject({ enabled: true, mode: "required" });
      expect(testPath(worker.target.worktree.originalCwd)).toBe(testPath(repo));
      expect(testPath(worker.target.worktree.repoRoot)).toBe(testPath(repo));
      expect(verifier.target.worktree.path).toBe(worker.target.worktree.path);
      expect(worker.target.cwd).toBe(worker.target.worktree.cwd);
      expect(verifier.target.cwd).toBe(worker.target.worktree.cwd);
      expect(new Set(authProfilesOf(workflow as { steps: TestWorkflowStep[] }))).toEqual(new Set(["account004", "account005"]));
    } finally {
      store.close();
    }

    const second = runCli(dataDir, args, undefined, env);
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue).toMatchObject({ scanned: 1, considered: 1, created: 0, deduped: 1, skipped: 0 });
    expect(secondValue.results[0]).toMatchObject({
      kind: "deduped",
      idempotencyKey: "todos-task:task-lifecycle-smoke-one",
      loopId: firstValue.results[0].loopId,
      workflowId: firstValue.results[0].workflowId,
    });
    const afterReplay = new Store(join(dataDir, "loops.db"));
    try {
      expect(afterReplay.listWorkflowWorkItems({ routeKey: "todos-task" })).toHaveLength(1);
      expect(afterReplay.listLoops({ includeArchived: true })).toHaveLength(1);
      expect(afterReplay.listWorkflows()).toHaveLength(1);
    } finally {
      afterReplay.close();
    }
  }, 15_000);

  test("todos task drain smoke does not admit ineligible or wrong-project tasks", () => {
    const dataDir = freshDataDir("loops-cli-task-lifecycle-negative-");
    const repo = createGitRepoIn(dataDir, "repo-");
    const otherRepo = createGitRepoIn(dataDir, "other-repo-");
    const binDir = fakeTodosReadyBin(dataDir);
    const ready = [
      { id: "task-no-route", title: "Missing route opt-in", status: "pending", working_dir: repo, tags: [] },
      { id: "task-approval", title: "Needs approval", status: "pending", working_dir: repo, tags: ["auto:route"], metadata: { requires_approval: true } },
      { id: "task-manual", title: "Manual automation", status: "pending", working_dir: repo, tags: ["auto:route"], metadata: { automation: { allowed: true, manual_required: true } } },
      { id: "task-no-auto", title: "No auto tag", status: "pending", working_dir: repo, tags: ["auto:route", "no-auto"] },
      { id: "task-blocked", title: "Blocked status", status: "blocked", working_dir: repo, tags: ["auto:route"] },
      { id: "task-completed", title: "Completed status", status: "completed", working_dir: repo, tags: ["auto:route"] },
      { id: "task-wrong-project", title: "Wrong project prefix", status: "pending", working_dir: otherRepo, tags: ["auto:route"] },
    ];
    const env = isolatedRouteEnv(dataDir, {
      PATH: `${binDir}:/usr/bin:/bin`,
      TODOS_READY_JSON: JSON.stringify(ready),
    });
    const result = runCli(dataDir, [
      "--json",
      "events",
      "drain",
      "todos-task",
      "--todos-project",
      join(dataDir, "todos-project"),
      "--project-path-prefix",
      repo,
      "--limit",
      "20",
      "--max-dispatch",
      "10",
      "--template",
      "task-lifecycle",
      "--provider",
      "codewith",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
      "--evidence-dir",
      join(dataDir, "evidence"),
      "--compact",
    ], undefined, env);

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(7);
    expect(value.filteredCandidates).toBe(6);
    // task-no-auto carries a route-disallowed TAG, so it is held out of the
    // candidate window (excludedDisallowedTag) instead of burning a considered
    // slot; status-based ineligibility (blocked/completed) still skips in-window.
    expect(value.excludedDisallowedTag).toBe(1);
    expect(value.considered).toBe(5);
    expect(value.created).toBe(0);
    expect(value.skipped).toBe(5);
    expect(value.results.map((entry: { taskId?: string }) => entry.taskId).sort()).toEqual([
      "task-approval",
      "task-blocked",
      "task-completed",
      "task-manual",
      "task-no-route",
    ]);
    expect(JSON.stringify(value.results)).not.toContain("task-wrong-project");
    expect(JSON.stringify(value.results)).not.toContain("task-no-auto");
    expect(existsSync(value.evidencePath)).toBe(true);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listWorkflowWorkItems({ routeKey: "todos-task" })).toHaveLength(0);
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
      expect(store.listWorkflows()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("todos task provider smoke dry-runs Cursor GLM account-pool routing without storing state", () => {
    const dataDir = freshDataDir("loops-cli-event-cursor-provider-smoke-");
    const repo = createGitRepoIn(dataDir, "repo-");
    const event = {
      id: "evt-cursor-provider-smoke",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "todo-cursor-provider-smoke",
        title: "Route with Cursor GLM account pool",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--template",
      "task-lifecycle",
      "--provider",
      "cursor",
      "--account-tool",
      "cursor",
      "--account-pool",
      "cursor-glm-a,cursor-glm-b",
      "--model",
      "glm-5.2-max",
      "--sandbox",
      "enabled",
      "--permission-mode",
      "plan",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify(event), isolatedRouteEnv(dataDir));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.deduped).toBe(false);
    expect(value.providerRouting).toMatchObject({
      provider: "cursor",
      source: "option",
      accountPool: [{ profile: "cursor-glm-a", tool: "cursor" }, { profile: "cursor-glm-b", tool: "cursor" }],
    });
    expect(value.invocation.scope.accountPolicy).toBe("pool");
    const agentSteps = agentStepsOf(value.workflow);
    expect(agentSteps.map((step) => step.id)).toEqual(["triage", "planner", "worker", "verifier"]);
    for (const step of agentSteps) {
      expect(step.target).toMatchObject({
        provider: "cursor",
        model: "glm-5.2-max",
        sandbox: "enabled",
        permissionMode: "plan",
      });
      expect(["cursor-glm-a", "cursor-glm-b"]).toContain(step.target.account.profile);
      expect(step.target.account.tool).toBe("cursor");
    }
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listWorkflowWorkItems({ routeKey: "todos-task" })).toHaveLength(0);
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
      expect(store.listWorkflows()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("todos task event handler selects provider and account pools from metadata hints", () => {
    const dataDir = freshDataDir("loops-cli-event-provider-metadata-");
    const repo = createGitRepo("loops-cli-event-provider-metadata-repo-");
    const event = {
      id: "evt-task-created-provider-metadata",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-provider-metadata",
        title: "Route frontend task with metadata",
        working_dir: repo,
      },
      metadata: {
        route_enabled: true,
        provider_hint: "claude",
        auth_profile_pool: "claude-ui-a,claude-ui-b",
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.providerRouting).toMatchObject({
      provider: "claude",
      source: "metadata",
      reason: "selected provider from task metadata",
    });
    expect(value.invocation.scope.providerRouting.provider).toBe("claude");
    expect(value.invocation.scope.accountPolicy).toBe("pool");
    const worker = value.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(["claude-ui-a", "claude-ui-b"]).toContain(worker.target.account.profile);
    expect(["claude-ui-a", "claude-ui-b"]).toContain(verifier.target.account.profile);
    expect(worker.target.account.profile).not.toBe(verifier.target.account.profile);
  });

  test("todos task provider rules fall back to fixed Codewith pools and reject invalid hints", () => {
    // Spawns ~40 CLI subprocesses serially; exceeds the 5s default under load.
    const dataDir = freshDataDir("loops-cli-event-provider-fallback-");
    const repo = createGitRepo("loops-cli-event-provider-fallback-repo-");
    const event = {
      id: "evt-task-created-provider-fallback",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-provider-fallback",
        title: "Route backend task with fallback",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      metadata: {
        area: "backend",
      },
      timestamp: new Date().toISOString(),
    };

    const colonAreaTag = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "tags=area:frontend:claude:claude-ui-a,claude-ui-b",
      "--provider-rule",
      "tags=task-lifecycle:codewith:account004,account005",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-colon-area-tag",
      data: {
        ...event.data,
        working_dir: repo,
        tags: ["auto:route", "area:frontend"],
      },
      metadata: {
        area: "backend",
      },
    }));

    expect(colonAreaTag.status).toBe(0);
    const colonAreaTagValue = JSON.parse(colonAreaTag.stdout);
    expect(colonAreaTagValue.providerRouting).toMatchObject({
      provider: "claude",
      source: "rule",
      reason: "matched provider rule tags=area:frontend",
    });
    expect(colonAreaTagValue.providerRouting.accountPool).toEqual([
      { profile: "claude-ui-a", tool: "claude" },
      { profile: "claude-ui-b", tool: "claude" },
    ]);
    expect(agentStepsOf(colonAreaTagValue.workflow)[0].target.provider).toBe("claude");
    expect(agentStepsOf(colonAreaTagValue.workflow)[1].target.provider).toBe("claude");

    const colonProviderTag = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "tags=provider:claude-code:claude:claude-code-a,claude-code-b",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-colon-provider-tag",
      data: {
        ...event.data,
        working_dir: repo,
        tags: ["auto:route", "provider:claude-code"],
      },
      metadata: {},
    }));

    expect(colonProviderTag.status).toBe(0);
    const colonProviderTagValue = JSON.parse(colonProviderTag.stdout);
    expect(colonProviderTagValue.providerRouting.rule.value).toBe("provider:claude-code");
    expect(colonProviderTagValue.providerRouting.provider).toBe("claude");
    expect(new Set(agentStepsOf(colonProviderTagValue.workflow).map((step) => step.target.account.profile))).toEqual(new Set(["claude-code-a", "claude-code-b"]));

    const lifecycleTagsCodewith = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "tags=area:frontend:claude:claude-ui-a,claude-ui-b",
      "--provider-rule",
      "tags=provider:claude-code:claude:claude-code-a,claude-code-b",
      "--provider-rule",
      "tags=task-lifecycle:codewith:account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-lifecycle-codewith",
      data: {
        ...event.data,
        working_dir: repo,
        tags: ["auto:route", "task-lifecycle", "workflow"],
      },
      metadata: {},
    }));

    expect(lifecycleTagsCodewith.status).toBe(0);
    const lifecycleTagsCodewithValue = JSON.parse(lifecycleTagsCodewith.stdout);
    expect(lifecycleTagsCodewithValue.providerRouting).toMatchObject({
      provider: "codewith",
      source: "rule",
      reason: "matched provider rule tags=task-lifecycle",
      authProfilePool: ["account004", "account005"],
    });
    expect(agentStepsOf(lifecycleTagsCodewithValue.workflow)[0].target.provider).toBe("codewith");
    expect(agentStepsOf(lifecycleTagsCodewithValue.workflow)[0].target.account).toBeUndefined();

    const fallback = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=frontend:claude:claude-ui-a,claude-ui-b",
      "--auth-profile-pool",
      "account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify(event));

    expect(fallback.status).toBe(0);
    const fallbackValue = JSON.parse(fallback.stdout);
    expect(fallbackValue.providerRouting.provider).toBe("codewith");
    expect(fallbackValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(fallbackValue.workflow)[0].target.provider).toBe("codewith");
    expect(new Set(authProfilesOf(fallbackValue.workflow)).size).toBe(2);

    const explicitProvider = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--auth-profile-pool",
      "account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit",
      metadata: { ...event.metadata, provider_hint: "claude", account_pool: "claude-ui-a,claude-ui-b" },
    }));

    expect(explicitProvider.status).toBe(0);
    const explicitValue = JSON.parse(explicitProvider.stdout);
    expect(explicitValue.providerRouting.provider).toBe("codewith");
    expect(explicitValue.providerRouting.source).toBe("option");
    expect(agentStepsOf(explicitValue.workflow)[0].target.provider).toBe("codewith");
    expect(agentStepsOf(explicitValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(explicitValue.workflow)[1].target.account).toBeUndefined();

    const explicitMetadataAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-metadata-auth",
      metadata: {
        ...event.metadata,
        provider_hint: "claude",
        auth_profile_pool: "account004,account005",
        account_pool: "claude-ui-a,claude-ui-b",
      },
    }));

    expect(explicitMetadataAuth.status).toBe(0);
    const explicitMetadataAuthValue = JSON.parse(explicitMetadataAuth.stdout);
    expect(explicitMetadataAuthValue.providerRouting.provider).toBe("codewith");
    expect(explicitMetadataAuthValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[0].target.authProfile).toBeDefined();
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(explicitMetadataAuthValue.workflow)[1].target.account).toBeUndefined();

    const explicitSingleAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "codewith",
      "--auth-profile",
      "account009",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-single-auth",
      metadata: {
        ...event.metadata,
        auth_profile_pool: "account004,account005",
      },
    }));

    expect(explicitSingleAuth.status).toBe(0);
    const explicitSingleAuthValue = JSON.parse(explicitSingleAuth.stdout);
    expect(agentStepsOf(explicitSingleAuthValue.workflow)[0].target.authProfile).toBe("account009");
    expect(agentStepsOf(explicitSingleAuthValue.workflow)[1].target.authProfile).toBe("account009");

    const ruleCodewith = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-codewith",
      metadata: { ...event.metadata, account_pool: "claude-ui-a,claude-ui-b", account_tool: "claude" },
    }));

    expect(ruleCodewith.status).toBe(0);
    const ruleCodewithValue = JSON.parse(ruleCodewith.stdout);
    expect(ruleCodewithValue.providerRouting.provider).toBe("codewith");
    expect(ruleCodewithValue.providerRouting.source).toBe("rule");
    expect(ruleCodewithValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(ruleCodewithValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(ruleCodewithValue.workflow)[1].target.account).toBeUndefined();

    const ruleCodewithWithFallbackAuth = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--auth-profile",
      "account009",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-rule-codewith-fallback-auth",
    }));

    expect(ruleCodewithWithFallbackAuth.status).toBe(0);
    const ruleCodewithWithFallbackAuthValue = JSON.parse(ruleCodewithWithFallbackAuth.stdout);
    expect(ruleCodewithWithFallbackAuthValue.providerRouting.authProfile).toBe("account009");
    expect(ruleCodewithWithFallbackAuthValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(new Set(authProfilesOf(ruleCodewithWithFallbackAuthValue.workflow))).toEqual(new Set(["account004", "account005"]));

    const defaultCodewith = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-default-codewith",
      metadata: {
        ...event.metadata,
        auth_profile_pool: "account004,account005",
        account_pool: "claude-ui-a,claude-ui-b",
        account_tool: "claude",
      },
    }));

    expect(defaultCodewith.status).toBe(0);
    const defaultCodewithValue = JSON.parse(defaultCodewith.stdout);
    expect(defaultCodewithValue.providerRouting.provider).toBe("codewith");
    expect(defaultCodewithValue.providerRouting.authProfilePool).toEqual(["account004", "account005"]);
    expect(agentStepsOf(defaultCodewithValue.workflow)[0].target.account).toBeUndefined();
    expect(agentStepsOf(defaultCodewithValue.workflow)[1].target.account).toBeUndefined();

    const genericProviderField = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-field",
      data: { ...event.data, provider: "github" },
    }));

    expect(genericProviderField.status).toBe(0);
    const genericProviderValue = JSON.parse(genericProviderField.stdout);
    expect(genericProviderValue.providerRouting.provider).toBe("codewith");
    expect(agentStepsOf(genericProviderValue.workflow)[0].target.provider).toBe("codewith");

    const claudeRepo = createGitRepo("loops-cli-event-provider-explicit-account-repo-");
    const explicitAccount = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "claude",
      "--account",
      "claude-main",
      "--account-tool",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-explicit-account",
      data: { ...event.data, working_dir: claudeRepo },
      metadata: { ...event.metadata, account_pool: "claude-ui-a,claude-ui-b" },
    }));

    expect(explicitAccount.status).toBe(0);
    const explicitAccountValue = JSON.parse(explicitAccount.stdout);
    const explicitAccountWorker = explicitAccountValue.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const explicitAccountVerifier = explicitAccountValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(explicitAccountWorker.target.account).toEqual({ profile: "claude-main", tool: "claude" });
    expect(explicitAccountVerifier.target.account).toEqual({ profile: "claude-main", tool: "claude" });

    const explicitProviderMetadataTool = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--provider",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-metadata-account-tool",
      data: { ...event.data, working_dir: claudeRepo },
      metadata: {
        ...event.metadata,
        account_pool: "cursor-a,cursor-b",
        account_tool: "cursor",
      },
    }));

    expect(explicitProviderMetadataTool.status).toBe(0);
    const explicitProviderMetadataToolValue = JSON.parse(explicitProviderMetadataTool.stdout);
    const metadataToolWorker = explicitProviderMetadataToolValue.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const metadataToolVerifier = explicitProviderMetadataToolValue.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(metadataToolWorker.target.provider).toBe("claude");
    expect(metadataToolWorker.target.account.tool).toBe("cursor");
    expect(metadataToolVerifier.target.account.tool).toBe("cursor");

    const invalid = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-mode",
      "off",
    ], JSON.stringify({
      ...event,
      id: "evt-task-created-provider-invalid",
      metadata: { ...event.metadata, provider_hint: "unsupported-provider" },
    }));

    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("unsupported provider");
    expect(invalid.stderr).toContain("unsupported-provider");
  }, 60000);

  test("todos task PR approval routes require non-author GitHub reviewer evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-review-routing-");
    const event = {
      id: "evt-task-created-pr-review",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-review-required",
        title: "Approve blocked PR",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
        pr_state: "OPEN",
        description: [
          "GitHub PR #1 author is also andrei-hasna.",
          "reviewDecision=REVIEW_REQUIRED",
          "mergeStateStatus=BLOCKED",
          "PR: https://github.com/hasna/example/pull/1",
        ].join("\n"),
      },
      timestamp: new Date().toISOString(),
    };
    const baseArgs = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--sandbox",
      "workspace-write",
      "--worktree-mode",
      "off",
    ];

    const missingReviewer = runCli(dataDir, baseArgs, JSON.stringify(event));
    expect(missingReviewer.status).toBe(0);
    const missingValue = JSON.parse(missingReviewer.stdout);
    expect(missingValue.skipped).toBe(true);
    expect(missingValue.reason).toContain("--github-reviewer");
    expect(missingValue.workflow).toBeUndefined();
    expect(missingValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: false,
      author: "andrei-hasna",
      reviewers: [],
    });

    const selfReviewer = runCli(dataDir, [...baseArgs, "--github-reviewer", "andrei-hasna"], JSON.stringify(event));
    expect(selfReviewer.status).toBe(0);
    const selfValue = JSON.parse(selfReviewer.stdout);
    expect(selfValue.skipped).toBe(true);
    expect(selfValue.reason).toContain("self-review");
    expect(selfValue.prReviewRouting.reviewers).toEqual(["andrei-hasna"]);

    const nonAuthorReviewer = runCli(dataDir, [...baseArgs, "--github-reviewer", "reviewer-hasna"], JSON.stringify(event));
    expect(nonAuthorReviewer.status).toBe(0);
    const nonAuthorValue = JSON.parse(nonAuthorReviewer.stdout);
    expect(nonAuthorValue.skipped).toBeUndefined();
    expect(nonAuthorValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(nonAuthorValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "reviewer-hasna",
    });
    expect(nonAuthorValue.invocation.scope.prReviewRouting.selectedReviewer).toBe("reviewer-hasna");

    const textReviewerPool = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-text-pool",
      data: {
        ...event.data,
        id: "task-pr-review-text-pool",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna, reviewer-hasna",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/2",
        ].join("\n"),
      },
    }));
    expect(textReviewerPool.status).toBe(0);
    const textReviewerPoolValue = JSON.parse(textReviewerPool.stdout);
    expect(textReviewerPoolValue.skipped).toBeUndefined();
    expect(textReviewerPoolValue.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "reviewer-hasna",
    });
    expect(textReviewerPoolValue.prReviewRouting.reviewers).toEqual(["andrei-hasna", "reviewer-hasna"]);

    const selfPoolWithStatusLine = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-self-pool-status",
      data: {
        ...event.data,
        id: "task-pr-review-self-pool-status",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna",
          "manual",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/3",
        ].join("\n"),
      },
    }));
    expect(selfPoolWithStatusLine.status).toBe(0);
    const selfPoolWithStatusLineValue = JSON.parse(selfPoolWithStatusLine.stdout);
    expect(selfPoolWithStatusLineValue.skipped).toBe(true);
    expect(selfPoolWithStatusLineValue.reason).toContain("self-review");
    expect(selfPoolWithStatusLineValue.prReviewRouting.reviewers).toEqual(["andrei-hasna"]);

    const unprefixedReviewerPool = runCli(dataDir, baseArgs, JSON.stringify({
      ...event,
      id: "evt-task-created-pr-review-unprefixed-pool",
      data: {
        ...event.data,
        id: "task-pr-review-unprefixed-pool",
        description: [
          "GitHub author is andrei-hasna",
          "Reviewer pool: andrei-hasna, reviewer-hasna",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/4",
        ].join("\n"),
      },
    }));
    expect(unprefixedReviewerPool.status).toBe(0);
    const unprefixedReviewerPoolValue = JSON.parse(unprefixedReviewerPool.stdout);
    expect(unprefixedReviewerPoolValue.skipped).toBe(true);
    expect(unprefixedReviewerPoolValue.reason).toContain("--github-reviewer");
    expect(unprefixedReviewerPoolValue.prReviewRouting.reviewers).toEqual([]);
  });

  test("todos task event handler replaces stale generated workflow policy metadata", () => {
    const dataDir = freshDataDir("loops-cli-event-stale-workflow-");
    const event = {
      id: "evt-task-stale-policy-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-stale-policy-0001",
        title: "Refresh generated route policy",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--provider",
      "codewith",
      "--sandbox",
      "danger-full-access",
      "--manual-break-glass",
      "--safety-reason",
      "operator-approved stale policy replacement test",
      "--permission-mode",
      "bypass",
    ];

    const preview = runCli(dataDir, [...args, "--dry-run"], JSON.stringify(event));
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    const staleWorkflow = {
      name: previewValue.workflow.name,
      description: "stale generated route workflow missing breakglass metadata",
      version: 1,
      steps: previewValue.workflow.steps.map((step: { target: Record<string, unknown> }) => ({
        ...step,
        target: {
          ...step.target,
          allowlist: {
            safetyReason: "legacy relaxed workflow fixture",
          },
        },
      })),
    };
    const staleCreated = runCli(dataDir, ["--json", "workflows", "create", workflowFile(dataDir, staleWorkflow)]);
    expect(staleCreated.status).toBe(0);
    const staleValue = JSON.parse(staleCreated.stdout);

    const routed = runCli(dataDir, args, JSON.stringify(event));
    expect(routed.status).toBe(0);
    const routedValue = JSON.parse(routed.stdout);
    expect(routedValue.workflow.id).not.toBe(staleValue.id);
    expect(agentStepsOf(storedWorkflow(dataDir, routedValue.workflow.id)!)[0].target.allowlist.commands)
      .toContain("manual-break-glass");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleValue.id]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("routes commands expose workflow invocation admission state", () => {
    const dataDir = freshDataDir("loops-cli-routes-list-");
    const event = {
      id: "evt-routes-list-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-list-0001",
        title: "Expose route state",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const created = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.workItem.status).toBe("admitted");
    expect(createdValue.workItem.machineId).toEqual(expect.any(String));

    const routes = runCli(dataDir, ["--json", "routes", "list"]);
    expect(routes.status).toBe(0);
    const routeRows = JSON.parse(routes.stdout);
    expect(routeRows).toHaveLength(1);
    expect(routeRows[0].id).toBe(createdValue.workItem.id);
    expect(routeRows[0].routeKey).toBe("todos-task");

    const shown = runCli(dataDir, ["--json", "routes", "show", createdValue.workItem.id]);
    expect(shown.status).toBe(0);
    const shownValue = JSON.parse(shown.stdout);
    expect(shownValue.item.id).toBe(createdValue.workItem.id);
    expect(shownValue.invocation.id).toBe(createdValue.invocation.id);
    expect(shownValue.loop.id).toBe(createdValue.loop.id);

    const activeRequeue = runCli(dataDir, ["--json", "routes", "requeue", createdValue.workItem.id, "--reason", "still active"]);
    expect(activeRequeue.status).not.toBe(0);
    expect(activeRequeue.stderr).toContain("not requeueable");
  });

  test("routes preview, create, and schedule expose first-class route lifecycle commands", () => {
    const dataDir = freshDataDir("loops-cli-routes-lifecycle-");
    const event = {
      id: "evt-routes-lifecycle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-lifecycle-0001",
        title: "Route from routes command",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
      "--timeout",
      "10m",
    ]);
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.loop.workflowId).toBeUndefined();
    expect(previewValue.sandboxPreflight[0].method).toBe("provider-native-sandbox");

    const created = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.workItem.status).toBe("admitted");
    expect(createdValue.loop.target.input).toBeUndefined();
    expect(storedLoop(dataDir, createdValue.loop.id)?.target).toMatchObject({
      type: "workflow",
      input: { workflowWorkItemId: createdValue.workItem.id },
    });

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-test",
      "--every",
      "5m",
      "--task-list",
      "oss",
      "--max-dispatch",
      "2",
      "--sandbox",
      "workspace-write",
      "--timeout",
      "10m",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    expect(loop.name).toBe("route-drain-test");
    expect(loop.target.command).toBe("loops");
    expect(privateCommandArgs(dataDir, loop)).toEqual(expect.arrayContaining([
      "routes",
      "drain",
      "todos-task",
      "--task-list",
      "oss",
      "--max-dispatch",
      "2",
      "--timeout",
      "10m",
    ]));
  });

  test("routes create persists the resolved Todos project separately from the routed repository", () => {
    const dataDir = freshDataDir("loops-cli-routes-todos-project-scope-");
    const repo = createGitRepo("loops-cli-routes-todos-project-scope-repo-");
    const event = (id: string) => ({
      id: `evt-${id}`,
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id,
        title: "Persist Todos project scope",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    });

    const inherited = runCli(
      dataDir,
      ["--json", "routes", "create", "todos-task", "--event-json", JSON.stringify(event("task-env-scope")), "--worktree-mode", "off"],
      undefined,
      { LOOPS_TASK_PROJECT: "/tmp/todos-env-default" },
    );
    expect(inherited.status).toBe(0);
    const inheritedValue = JSON.parse(inherited.stdout);
    expect(inheritedValue.invocation.scope.projectPath).toBeUndefined();
    expect(inheritedValue.invocation.scope.todosProjectPath).toBeUndefined();
    expect(storedInvocation(dataDir, inheritedValue.invocation.id)?.scope).toMatchObject({
      projectPath: testPath(repo),
      todosProjectPath: "/tmp/todos-env-default",
    });

    const explicit = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "create",
        "todos-task",
        "--event-json",
        JSON.stringify(event("task-explicit-scope")),
        "--todos-project",
        "/tmp/todos-explicit",
        "--worktree-mode",
        "off",
      ],
      undefined,
      { LOOPS_TASK_PROJECT: "/tmp/todos-env-default" },
    );
    expect(explicit.status).toBe(0);
    const explicitValue = JSON.parse(explicit.stdout);
    expect(explicitValue.invocation.scope.todosProjectPath).toBeUndefined();
    expect(storedInvocation(dataDir, explicitValue.invocation.id)?.scope).toMatchObject({
      projectPath: testPath(repo),
      todosProjectPath: "/tmp/todos-explicit",
    });

    const omitted = runCli(
      dataDir,
      ["--json", "routes", "create", "todos-task", "--event-json", JSON.stringify(event("task-omitted-scope")), "--worktree-mode", "off"],
      undefined,
      { LOOPS_TASK_PROJECT: "" },
    );
    expect(omitted.status).toBe(0);
    expect(JSON.parse(omitted.stdout).invocation.scope.todosProjectPath).toBeUndefined();
  });

  test("todos task routes can select the full task-lifecycle template", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-");
    const event = {
      id: "evt-routes-task-lifecycle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-0001",
        title: "Route through full lifecycle",
        description: "Exercise triage, planner, worker, and verifier.",
        working_dir: "/tmp/open-codewith",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--triage-auth-profile",
      "account004",
      "--planner-auth-profile",
      "account005",
      "--worker-auth-profile",
      "account006",
      "--verifier-auth-profile",
      "account007",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.invocation.templateId).toBe("task-lifecycle");
    expect(previewValue.invocation.scope.accountPolicy).toBe("role-explicit");
    expect(previewValue.workflow.steps.map((step: { id: string }) => step.id)).toEqual([
      "source-task-gate",
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "verifier",
      "task-evidence-check",
    ]);
    const stepsById = Object.fromEntries(previewValue.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById.triage.dependsOn).toEqual(["source-task-gate"]);
    expect(stepsById.triage.target.authProfile).toBe("account004");
    expect(stepsById.planner.target.authProfile).toBe("account005");
    expect(stepsById.worker.target.authProfile).toBe("account006");
    expect(stepsById.verifier.target.authProfile).toBe("account007");
    expect(stepsById.planner.dependsOn).toEqual(["triage-gate"]);
    expect(stepsById.worker.dependsOn).toEqual(["planner-gate"]);
    expect(stepsById["triage-gate"].target.type).toBe("command");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("--json inspect");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001");
    expect(stepsById["planner-gate"].target.args.join("\n")).toContain("openloops:planner=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001");
    expect(stepsById["triage-gate"].target.args.join("\n")).toContain("task lifecycle ${stage} gate blocked");
    expect(stepsById["planner-gate"].target.args.join("\n")).toContain("task lifecycle ${stage} gate blocked");
    expect(previewValue.workflow.description).toContain("task-lifecycle");

    const fakeBin = join(dataDir, "fake-bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeTodos = join(fakeBin, "todos");
    writeFileSync(fakeTodos, "#!/usr/bin/env bash\nprintf '%s' \"$FAKE_TODOS_JSON\"\n");
    chmodSync(fakeTodos, 0o755);
    const runGate = (stepId: "triage-gate" | "planner-gate", task: Record<string, unknown>) => spawnSync(
      "bash",
      ["-lc", `PATH=${JSON.stringify(fakeBin)}:$PATH\n${stepsById[stepId].target.args[1]}`],
      {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, FAKE_TODOS_JSON: JSON.stringify(task) },
        encoding: "utf8",
      },
    );
    const baseTask = {
      id: "task-routes-task-lifecycle-0001",
      status: "pending",
      tags: ["auto:route"],
      comments: [{ content: "openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\neligible" }],
    };
    expect(runGate("triage-gate", baseTask).status).toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      comments: [{ content: "not adding openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001" }],
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      requires_approval: true,
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      tags: ["auto:route", "no-auto"],
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      tags: ["auto:route", "blocked"],
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      manual_required: true,
    }).status).not.toBe(0);
    expect(runGate("triage-gate", {
      ...baseTask,
      comments: [
        { content: "openloops:triage=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nold", created_at: "2026-01-01T00:00:00.000Z" },
        { content: "openloops:triage=blocked task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nnew", created_at: "2026-01-01T00:01:00.000Z" },
      ],
    }).status).not.toBe(0);
    expect(runGate("planner-gate", {
      ...baseTask,
      comments: [{ content: "openloops:planner=go task=task-routes-task-lifecycle-0001 event=evt-routes-task-lifecycle-0001\nplan" }],
    }).status).toBe(0);

    const invalid = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "pr-review",
    ]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("--template must be todos-task-worker-verifier or task-lifecycle");
  });

  test("todos task lifecycle routes pass PR review routing evidence into follow-up guidance", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-pr-routing-");
    const event = {
      id: "evt-routes-task-lifecycle-pr-routing-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-pr-routing-0001",
        title: "Route PR follow-up lifecycle",
        description: [
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna, kriptoburak",
          "reviewDecision=REVIEW_REQUIRED",
          "PR: https://github.com/hasna/example/pull/7",
        ].join("\n"),
        working_dir: "/tmp/open-codewith",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.prReviewRouting).toMatchObject({
      required: true,
      allowed: true,
      author: "andrei-hasna",
      selectedReviewer: "kriptoburak",
    });
    expect(value.invocation.scope.prReviewRouting).toMatchObject({
      author: "andrei-hasna",
      selectedReviewer: "kriptoburak",
    });
    const stepsById = Object.fromEntries(value.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    for (const id of ["triage", "planner", "worker", "verifier"]) {
      const prompt = stepsById[id].target.prompt;
      expect(prompt).toContain("PR-derived follow-up todos:");
      expect(prompt).toContain("Source PR author evidence: GitHub author is andrei-hasna");
      expect(prompt).toContain("Source PR reviewer evidence: GitHub reviewer pool: andrei-hasna, kriptoburak");
      expect(prompt).toContain('"prReviewRouting":{"required":true');
      expect(prompt).toContain('"selectedReviewer":"kriptoburak"');
    }

    const created = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
    ]);
    expect(created.status).toBe(0);
    const createdValue = JSON.parse(created.stdout);
    expect(createdValue.invocation.templateId).toBe("task-lifecycle");
    expect(createdValue.invocation.scope.prReviewRouting).toBeUndefined();
    expect(storedInvocation(dataDir, createdValue.invocation.id)?.scope?.prReviewRouting).toMatchObject({
      author: "andrei-hasna",
      reviewers: ["andrei-hasna", "kriptoburak"],
      selectedReviewer: "kriptoburak",
    });
  });

  test("task lifecycle routes can queue bounded PR handoff from worker artifacts", () => {
    const dataDir = freshDataDir("loops-cli-routes-pr-handoff-");
    const repo = createGitRepo("loops-cli-routes-pr-handoff-repo-");
    const event = {
      id: "evt-routes-pr-handoff-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-pr-handoff-0001",
        title: "Route with PR handoff",
        description: "Exercise worker-network-failure handoff.",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--worktree-mode",
      "main",
      "--pr-handoff",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.invocation.scope.prHandoff).toBe(true);
    expect(value.workflow.steps.map((step: { id: string }) => step.id)).toEqual([
      "source-task-gate",
      "triage",
      "triage-gate",
      "planner",
      "planner-gate",
      "worker",
      "pr-handoff",
      "verifier",
      "task-evidence-check",
    ]);
    const stepsById = Object.fromEntries(value.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById["pr-handoff"].dependsOn).toEqual(["worker"]);
    expect(stepsById.verifier.dependsOn).toEqual(["pr-handoff"]);
    expect(stepsById.worker.target.prompt).toContain(".openloops/pr-handoff/task-routes-pr-handoff-0001.json");
    const command = stepsById["pr-handoff"].target.args[1];
    expect(command).toContain("openloops:pr-handoff:");
    expect(command).toContain("const result = todos(");
    expect(command).toContain("'task'");

    const noArtifactHandoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      // Bun's test runner can omit SHLVL; bash -l then reports status 1 after the guarded exit.
      env: { ...process.env, SHLVL: "1" },
      encoding: "utf8",
    });
    if (noArtifactHandoff.status !== 0) {
      throw new Error(
        [
          `missing-artifact handoff exited ${noArtifactHandoff.status}`,
          `stdout: ${noArtifactHandoff.stdout}`,
          `stderr: ${noArtifactHandoff.stderr}`,
        ].join("\n"),
      );
    }
    expect(noArtifactHandoff.stdout).toContain("no PR handoff artifact at");
    expect(noArtifactHandoff.stdout).toContain(".openloops/pr-handoff/task-routes-pr-handoff-0001.json");
    expect(noArtifactHandoff.stderr).toBe("");

    const artifactDir = join(repo, ".openloops", "pr-handoff");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "openloops/pr-handoff-test",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      validation: "bun test passed",
      error: "getaddrinfo ENOTFOUND github.com",
    }));
    const fakeBin = join(dataDir, "fake-bin");
    const calls = join(dataDir, "calls.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, "git"),
      [
        "#!/usr/bin/env bash",
        "printf 'git %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"rev-parse\" && \"$4\" == \"--show-toplevel\" ]]; then printf '%s\\n' \"$2\"; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"branch\" && \"$4\" == \"--show-current\" ]]; then printf 'openloops/pr-handoff-test\\n'; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"rev-parse\" && \"$4\" == \"--verify\" ]]; then printf '0123456789abcdef0123456789abcdef01234567\\n'; exit 0; fi",
        "if [[ \"$1\" == \"-C\" && \"$3\" == \"merge-base\" ]]; then exit 0; fi",
        "if [[ \"$3\" == \"push\" ]]; then printf 'network blocked' >&2; exit 128; fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(fakeBin, "todos"),
      [
        "#!/usr/bin/env bash",
        "printf 'todos %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "exit 0",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(fakeBin, "gh"),
      [
        "#!/usr/bin/env bash",
        "printf 'gh %s\\n' \"$*\" >> \"$OPENLOOPS_TEST_CALLS\"",
        "if [[ \"$1\" == \"pr\" && \"$2\" == \"view\" ]]; then printf 'https://github.com/hasna/open-loops/pull/9\\nopenloops/pr-handoff-test\\n'; exit 0; fi",
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(join(fakeBin, "git"), 0o755);
    chmodSync(join(fakeBin, "todos"), 0o755);
    chmodSync(join(fakeBin, "gh"), 0o755);

    const handoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(handoff.status).toBe(0);
    expect(handoff.stdout).toContain("queued PR handoff task");
    const callLog = readFileSync(calls, "utf8");
    expect(callLog).toContain("git -C");
    expect(callLog).toContain("push origin 0123456789abcdef0123456789abcdef01234567:refs/heads/openloops/pr-handoff-test");
    expect(callLog).toContain("todos task upsert");
    expect(callLog).toContain("todos comment task-routes-pr-handoff-0001");
    expect(callLog).not.toContain("todos --project");
    expect(callLog).toContain("task upsert --fingerprint openloops:pr-handoff:task-routes-pr-handoff-0001:openloops/pr-handoff-test:0123456789abcdef0123456789abcdef01234567");
    expect(callLog).toContain("auto:route,pr-handoff,github,network,repo:open-loops");
    expect(callLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=pending");

    writeFileSync(calls, "");
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "untrusted/branch",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      validation: "bun test passed",
    }));
    const invalidHandoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(invalidHandoff.status).toBe(0);
    expect(invalidHandoff.stderr).toContain("invalid PR handoff artifact");
    const invalidCallLog = readFileSync(calls, "utf8");
    expect(invalidCallLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=invalid");
    expect(invalidCallLog).not.toContain("task upsert");
    expect(invalidCallLog).not.toContain("auto:route");

    writeFileSync(calls, "");
    writeFileSync(join(artifactDir, "task-routes-pr-handoff-0001.json"), JSON.stringify({
      taskId: "task-routes-pr-handoff-0001",
      worktreePath: repo,
      githubRepo: "hasna/open-loops",
      branch: "openloops/pr-handoff-test",
      base: "main",
      remote: "origin",
      commit: "0123456789abcdef0123456789abcdef01234567",
      prUrl: "https://github.com/hasna/open-loops/pull/9",
      validation: "bun test passed",
    }));
    const verifiedHandoff = spawnSync("bash", ["-lc", command], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        OPENLOOPS_TEST_CALLS: calls,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: join(fakeBin, "git"),
        OPENLOOPS_PR_HANDOFF_GH_BIN: join(fakeBin, "gh"),
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: join(fakeBin, "todos"),
      },
      encoding: "utf8",
    });
    expect(verifiedHandoff.status).toBe(0);
    expect(verifiedHandoff.stdout).toContain("PR handoff already complete");
    const verifiedCallLog = readFileSync(calls, "utf8");
    expect(verifiedCallLog).toContain("gh pr view https://github.com/hasna/open-loops/pull/9");
    expect(verifiedCallLog).toContain("comment task-routes-pr-handoff-0001 openloops:pr-handoff=done");
    expect(verifiedCallLog).not.toContain("push origin");
  });

  test("routes schedule preserves selected todos task template in the drain loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-template-test",
      "--every",
      "5m",
      "--template",
      "task-lifecycle",
      "--provider-rule",
      "area=backend:codewith:account004,account005",
      "--triage-auth-profile",
      "account004",
      "--planner-auth-profile",
      "account005",
      "--task-list",
      "oss",
      "--max-dispatch",
      "2",
      "--provider-active-cap",
      "6",
      "--provider-admission-check",
      "--sandbox",
      "workspace-write",
      "--allow-tool",
      "functions.exec_command,functions.view_image",
      "--allow-command",
      "git,bun",
      "--safety-reason",
      "bounded route worker repository access",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    const args = privateCommandArgs(dataDir, loop);
    expect(args).toEqual(expect.arrayContaining(["--template", "task-lifecycle"]));
    expect(args).toEqual(expect.arrayContaining(["--provider-rule", "area=backend:codewith:account004,account005"]));
    expect(args).toEqual(expect.arrayContaining(["--triage-auth-profile", "account004", "--planner-auth-profile", "account005"]));
    expect(args).toEqual(expect.arrayContaining(["--max-dispatch", "2"]));
    expect(args).toEqual(expect.arrayContaining(["--provider-active-cap", "6"]));
    expect(args).toEqual(expect.arrayContaining(["--allow-tool", "functions.exec_command"]));
    expect(args).toEqual(expect.arrayContaining(["--allow-tool", "functions.view_image"]));
    expect(args).toEqual(expect.arrayContaining(["--allow-command", "git"]));
    expect(args).toEqual(expect.arrayContaining(["--allow-command", "bun"]));
    expect(args).toEqual(expect.arrayContaining(["--safety-reason", "bounded route worker repository access"]));
    expect(args).toContain("--provider-admission-check");
  });

  test("routes schedule rejects advisory allowlists without a safety reason before storing the drain loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-allowlists-schedule-reason-");
    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-missing-allowlist-reason",
      "--every",
      "5m",
      "--allow-command",
      "git",
    ]);
    expect(scheduled.status).not.toBe(0);
    expect(`${scheduled.stdout}\n${scheduled.stderr}`).toContain("--safety-reason is required");
    expect(JSON.parse(runCli(dataDir, ["--json", "list"]).stdout)).toHaveLength(0);
  });

  test("routes preview propagates advisory allowlists to generated agent targets and fails closed without a reason", () => {
    const dataDir = freshDataDir("loops-cli-routes-allowlists-");
    const event = {
      id: "evt-routes-allowlists-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-allowlists-0001",
        title: "Route with bounded agent access",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
      "--allow-tool",
      "functions.exec_command,functions.view_image",
      "--allow-command",
      "git,bun",
      "--safety-reason",
      "bounded route worker repository access",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    for (const step of agentStepsOf(value.workflow)) {
      expect(step.target.allowlist).toEqual({
        enforcement: "metadata_only",
        tools: ["functions.exec_command", "functions.view_image"],
        commands: ["git", "bun"],
        safetyReason: "bounded route worker repository access",
      });
      expect(step.target.manualBreakGlass).toBeUndefined();
      expect(step.target.sandbox).toBe("workspace-write");
    }

    const missingReason = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify({ ...event, id: "evt-routes-allowlists-0002", data: { ...event.data, id: "task-routes-allowlists-0002" } }),
      "--worktree-mode",
      "off",
      "--sandbox",
      "workspace-write",
      "--allow-command",
      "git",
    ]);
    expect(missingReason.status).not.toBe(0);
    expect(`${missingReason.stdout}\n${missingReason.stderr}`).toContain("allowlist.safetyReason");
  });

  test("routes schedule rejects unsupported todos task templates before storing a drain loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-invalid-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-invalid-template",
      "--every",
      "5m",
      "--template",
      "pr-review",
    ]);
    expect(scheduled.status).not.toBe(0);
    expect(scheduled.stderr).toContain("--template must be todos-task-worker-verifier or task-lifecycle");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("routes schedule preserves registry drain options", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-registry-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-registry-test",
      "--every",
      "5m",
      "--todos-projects-from-registry",
      "--project-path-prefix",
      "/tmp/todos-registry-prefix",
      "--todos-project-include",
      "/tmp/registry/include-one",
      "--todos-project-include",
      "/tmp/registry/include-two,/tmp/registry/include-three",
      "--max-dispatch",
      "3",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    const args = privateCommandArgs(dataDir, loop);
    expect(args).toEqual(expect.arrayContaining(["--todos-projects-from-registry"]));
    expect(args).toEqual(expect.arrayContaining(["--project-path-prefix", "/tmp/todos-registry-prefix"]));
    expect(args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-one"]));
    expect(args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-two"]));
    expect(args).toEqual(expect.arrayContaining(["--todos-project-include", "/tmp/registry/include-three"]));
    expect(args).toEqual(expect.arrayContaining(["--max-dispatch", "3"]));
  });

  test("routes schedule serializes only Todos-owned or explicit project defaults", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-todos-project-");

    const omitted = runCli(
      dataDir,
      ["--json", "routes", "schedule", "todos-task", "route-drain-no-todos-project", "--every", "5m"],
      undefined,
      { LOOPS_TASK_PROJECT: "" },
    );
    expect(omitted.status).toBe(0);
    const omittedLoop = JSON.parse(omitted.stdout);
    const omittedArgs = privateCommandArgs(dataDir, omittedLoop);
    expect(omittedArgs).not.toContain("--todos-project");
    expect(omittedArgs).not.toContain(dataDir);

    const inherited = runCli(
      dataDir,
      ["--json", "routes", "schedule", "todos-task", "route-drain-env-todos-project", "--every", "5m"],
      undefined,
      { LOOPS_TASK_PROJECT: "/tmp/todos-owned-default" },
    );
    expect(inherited.status).toBe(0);
    const inheritedLoop = JSON.parse(inherited.stdout);
    expect(privateCommandArgs(dataDir, inheritedLoop)).toEqual(
      expect.arrayContaining(["--todos-project", "/tmp/todos-owned-default"]),
    );

    const explicit = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "schedule",
        "todos-task",
        "route-drain-explicit-todos-project",
        "--every",
        "5m",
        "--todos-project",
        "/tmp/todos-explicit",
      ],
      undefined,
      { LOOPS_TASK_PROJECT: "/tmp/todos-owned-default" },
    );
    expect(explicit.status).toBe(0);
    const explicitLoop = JSON.parse(explicit.stdout);
    const explicitArgs = privateCommandArgs(dataDir, explicitLoop);
    expect(explicitArgs).toEqual(expect.arrayContaining(["--todos-project", "/tmp/todos-explicit"]));
    expect(explicitArgs).not.toContain("/tmp/todos-owned-default");
  });

  test("routes schedule preserves launch gate blocker options", () => {
    const dataDir = freshDataDir("loops-cli-routes-template-schedule-launch-gate-");

    const scheduled = runCli(dataDir, [
      "--json",
      "routes",
      "schedule",
      "todos-task",
      "route-drain-launch-gate-test",
      "--every",
      "5m",
      "--launch-gate",
      "pa19-controlled-launch",
      "--launch-gate-blocker",
      "/tmp/open-codewith::2d9d931b",
      "--launch-gate-blocker",
      "/tmp/open-loops::816e99db,/tmp/open-loops::f30153fd",
      "--max-dispatch",
      "3",
    ]);
    expect(scheduled.status).toBe(0);
    const loop = JSON.parse(scheduled.stdout);
    const args = privateCommandArgs(dataDir, loop);
    expect(args).toEqual(expect.arrayContaining(["--launch-gate", "pa19-controlled-launch"]));
    expect(args).toEqual(expect.arrayContaining(["--launch-gate-blocker", "/tmp/open-codewith::2d9d931b"]));
    expect(args).toEqual(expect.arrayContaining(["--launch-gate-blocker", "/tmp/open-loops::816e99db"]));
    expect(args).toEqual(expect.arrayContaining(["--launch-gate-blocker", "/tmp/open-loops::f30153fd"]));
    expect(args).toEqual(expect.arrayContaining(["--max-dispatch", "3"]));
  });

  test("routes policies inspect, validate, and render replayable explicit args", () => {
    const dataDir = freshDataDir("loops-cli-route-policies-render-");

    const list = runCli(dataDir, ["--json", "routes", "policies", "list"]);
    expect(list.status).toBe(0);
    const policies = JSON.parse(list.stdout);
    expect(policies.map((policy: { id: string }) => policy.id)).toEqual(expect.arrayContaining(["repoops-pr-queue", "oss", "pilot", "machine-sync"]));

    const validate = runCli(dataDir, ["--json", "routes", "policies", "validate"]);
    expect(validate.status).toBe(0);
    expect(JSON.parse(validate.stdout).policies).toHaveLength(4);

    const render = runCli(dataDir, ["--json", "routes", "policies", "render", "oss"]);
    expect(render.status).toBe(0);
    const rendered = JSON.parse(render.stdout);
    expect(rendered.policy.id).toBe("oss");
    expect(rendered.policy.safety).toBe("unattended");
    expect(rendered.command).not.toContain("--policy");
    expect(rendered.args).toEqual(expect.arrayContaining([
      "--route-policy-evidence",
      "oss",
      "--template",
      "task-lifecycle",
      "--max-active-scope",
      "codewith-impl",
      "--max-per-profile",
      "3",
    ]));
    expect(rendered.drain.prHandoff).toBe(true);
    expect(rendered.schedule.every).toBe("2m");
  });

  test("routes schedule applies named policy defaults into explicit drain argv", () => {
    const dataDir = freshDataDir("loops-cli-route-policy-schedule-");

    const scheduled = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "schedule",
        "todos-task",
        "oss-policy-drain",
        "--policy",
        "oss",
      ],
      undefined,
      { PATH: "/usr/bin:/bin" },
    );
    expect(scheduled.status).toBe(0);
    const scheduledValue = JSON.parse(scheduled.stdout);
    const loop = scheduledValue.loop ?? scheduledValue;
    expect(loop.schedule.everyMs).toBe(120_000);
    expect(loop.maxAttempts).toBe(2);
    expect(loop.leaseMs).toBe(20 * 60_000);
    const args = privateCommandArgs(dataDir, loop);
    expect(args).not.toContain("--policy");
    expect(args).not.toContain("--todos-project");
    expect(args).not.toContain(dataDir);
    expect(args).toEqual(expect.arrayContaining([
      "--route-policy-evidence",
      "oss",
      "--project-path-prefix",
      join(process.env.HOME ?? "", "workspace", "hasna", "opensource"),
      "--max-dispatch",
      "6",
      "--max-active-scope",
      "codewith-impl",
      "--max-per-profile",
      "3",
      "--worktree-mode",
      "required",
      "--pr-handoff",
    ]));
  });

  test("route policies reject conflicting overrides and require explicit pilot break-glass", () => {
    const dataDir = freshDataDir("loops-cli-route-policy-conflicts-");

    const conflict = runCli(dataDir, [
      "routes",
      "schedule",
      "todos-task",
      "oss-policy-conflict",
      "--policy",
      "oss",
      "--scan-limit",
      "200",
    ]);
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toContain("route policy oss has conflicting explicit option");

    const pilot = runCli(dataDir, [
      "routes",
      "schedule",
      "todos-task",
      "pilot-policy-drain",
      "--policy",
      "pilot",
    ]);
    expect(pilot.status).not.toBe(0);
    expect(pilot.stderr).toContain("requires explicit --manual-break-glass");
  });

  test("routes drain policy dry-run records expanded policy evidence", () => {
    const dataDir = freshDataDir("loops-cli-route-policy-drain-evidence-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]'; exit 0; fi",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '[]'; exit 0; fi",
        "printf 'unexpected todos call: %s' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);

    const drain = runCli(
      dataDir,
      ["--json", "routes", "drain", "todos-task", "--policy", "machine-sync", "--dry-run"],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin` },
    );
    expect(drain.status).toBe(0);
    const value = JSON.parse(drain.stdout);
    expect(value.routePolicy.id).toBe("machine-sync");
    expect(value.routePolicy.expandedOptions.taskList).toBe("machine-default-sync");
    expect(value.routePolicy.explicitArgs).toEqual(expect.arrayContaining(["--route-policy-evidence", "machine-sync", "--worktree-mode", "required"]));
    expect(value.routePolicy.guards[0].kind).toBe("codewith-active-cap");

    const evidenceOnly = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "drain",
        "todos-task",
        "--route-policy-evidence",
        "oss",
        "--scan-limit",
        "123",
        "--max-dispatch",
        "9",
        "--dry-run",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin` },
    );
    expect(evidenceOnly.status).toBe(0);
    const replay = JSON.parse(evidenceOnly.stdout);
    expect(replay.routePolicy.id).toBe("oss");
    expect(replay.routePolicy.expandedOptions.scanLimit).toBe("123");
    expect(replay.routePolicy.explicitArgs).toEqual(expect.arrayContaining(["--route-policy-evidence", "oss", "--scan-limit", "123", "--max-dispatch", "9"]));
  });

  test("route dry-run exposes active scope and selected profile throttle evidence", () => {
    const dataDir = freshDataDir("loops-cli-route-throttle-profile-evidence-");
    const event = {
      id: "evt-route-profile-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-route-profile-throttle-0001",
        title: "Route with profile throttle evidence",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--dry-run",
      "--event-json",
      JSON.stringify(event),
      "--auth-profile-pool",
      "account004,account005",
      "--max-active",
      "4",
      "--max-active-scope",
      "codewith-impl",
      "--max-per-profile",
      "2",
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.invocation.scope.routeThrottle).toMatchObject({
      maxActiveScope: "codewith-impl",
      maxPerProfile: 2,
      limits: { maxActive: 4, maxActiveScope: "codewith-impl", maxPerProfile: 2 },
      routeScope: "codewith-impl",
    });
    expect(value.throttle.limits).toMatchObject({ maxActive: 4, maxActiveScope: "codewith-impl", maxPerProfile: 2 });
  });

  test("todos task lifecycle routes preserve explicit OpenAccounts role accounts", () => {
    const dataDir = freshDataDir("loops-cli-routes-task-lifecycle-accounts-");
    const repo = createGitRepo("loops-cli-routes-task-lifecycle-accounts-repo-");
    const event = {
      id: "evt-routes-task-lifecycle-accounts-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-task-lifecycle-accounts-0001",
        title: "Route through full lifecycle with OpenAccounts",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "preview",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--template",
      "task-lifecycle",
      "--provider",
      "claude",
      "--account-tool",
      "claude",
      "--triage-account",
      "triage-profile",
      "--planner-account",
      "planner-profile",
      "--worker-account",
      "worker-profile",
      "--verifier-account",
      "verifier-profile",
      "--worktree-mode",
      "required",
    ]);

    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    expect(previewValue.invocation.scope.accountPolicy).toBe("role-explicit");
    const stepsById = Object.fromEntries(previewValue.workflow.steps.map((step: { id: string }) => [step.id, step])) as Record<string, any>;
    expect(stepsById.triage.target.account).toEqual({ profile: "triage-profile", tool: "claude" });
    expect(stepsById.planner.target.account).toEqual({ profile: "planner-profile", tool: "claude" });
    expect(stepsById.worker.target.account).toEqual({ profile: "worker-profile", tool: "claude" });
    expect(stepsById.verifier.target.account).toEqual({ profile: "verifier-profile", tool: "claude" });
    expect(stepsById["source-task-gate"].dependsOn ?? []).toEqual([]);
    expect(stepsById.triage.dependsOn).toEqual(["source-task-gate"]);
    expect(stepsById.worker.dependsOn).toEqual(["planner-gate"]);
  });

  test("routes schedule rejects drain dry-run instead of storing a surprising loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-schedule-dry-run-");

    const scheduled = runCli(dataDir, [
      "routes",
      "schedule",
      "todos-task",
      "route-drain-dry-run",
      "--every",
      "5m",
      "--dry-run",
    ]);

    expect(scheduled.status).not.toBe(0);
    expect(scheduled.stderr).toContain("unknown option '--dry-run'");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("routes schedule rejects invalid provider active caps before storing a loop", () => {
    const dataDir = freshDataDir("loops-cli-routes-schedule-provider-cap-invalid-");

    const scheduled = runCli(dataDir, [
      "routes",
      "schedule",
      "todos-task",
      "route-drain-invalid-provider-cap",
      "--every",
      "5m",
      "--provider-active-cap",
      "0",
    ]);

    expect(scheduled.status).not.toBe(0);
    expect(scheduled.stderr).toContain("--provider-active-cap must be a positive integer");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("docs include the OSS task route drain safety recipe", () => {
    const usage = readFileSync(new URL("../../docs/USAGE.md", import.meta.url), "utf8");

    expect(usage).toContain("$HOME/workspace/example/opensource");
    expect(usage).toContain("--tags auto:route");
    expect(usage).toContain("--auth-profile-pool account001,account002,account003");
    expect(usage).toContain("--worktree-mode required");
    expect(usage).toContain("--max-active-per-project");
    expect(usage).toContain("--provider-active-cap");
    expect(usage).toContain("--provider-admission-check");
    expect(usage).toContain("--evidence-dir");
    expect(usage).toMatch(/Do not dispatch\s+or paste task prompts into tmux panes/);
  });

  test("routes create replaces a stale persisted unsafe workflow with the same generated name", () => {
    const dataDir = freshDataDir("loops-cli-routes-unsafe-existing-");
    const event = {
      id: "evt-routes-unsafe-existing-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-unsafe-existing-0001",
        title: "Unsafe existing route workflow",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const suffix = createHash("sha256").update("todos-task:task-routes-unsafe-existing-0001").digest("hex").slice(0, 12);
    const workflowName = `event:todos-task:task-rou:${suffix}:workflow`;
    let staleWorkflowId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const staleWorkflow = store.createWorkflow({
        name: workflowName,
        steps: [
          {
            id: "worker",
            target: {
              type: "agent",
              provider: "codewith",
              prompt: "unsafe old workflow",
              sandbox: "danger-full-access",
              manualBreakGlass: true,
              allowlist: { safetyReason: "legacy relaxed workflow fixture" },
            },
          },
        ],
      });
      staleWorkflowId = staleWorkflow.id;
    } finally {
      store.close();
    }

    const result = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.id).not.toBe(staleWorkflowId);
    expect(agentStepsOf(storedWorkflow(dataDir, value.workflow.id)!)[0].target.sandbox).toBe("workspace-write");

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleWorkflowId]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("todos task event handler dry-run exposes default worktree routing for git repos", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-worktree-");
    const repo = createGitRepo("loops-cli-event-handler-worktree-repo-");
    const worktreeRoot = join(dataDir, "worktrees");
    const event = {
      id: "evt-task-worktree-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-event-worktree-0001",
        title: "Fix event bridge in worktree",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--worktree-root",
      worktreeRoot,
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.steps.map((step: { id: string }) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(value.workflow.steps[1].target.cwd).toContain(worktreeRoot);
    expect(value.workflow.steps[1].target.worktree.enabled).toBe(true);
    expect(testPath(value.workflow.steps[1].target.worktree.originalCwd)).toBe(testPath(repo));
    expect(testPaths(value.workflow.steps[1].target.addDirs)).toContain(testPath(join(repo, ".git")));
    expect(testPaths(value.workflow.steps[2].target.addDirs)).toContain(testPath(join(repo, ".git")));
  });

  test("todos task event handler throttles active workflows per project", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-project-throttle-");
    const repo = createGitRepo("loops-cli-event-handler-project-throttle-repo-");
    const baseEvent = {
      type: "task.created",
      source: "@hasna/todos",
      data: {
        title: "Queue project task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-project-throttle-0001",
      data: { ...baseEvent.data, id: "task-project-throttle-0001" },
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-project-throttle-0002",
      data: { ...baseEvent.data, id: "task-project-throttle-0002" },
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("project active workflow limit reached");
    expect(value.throttle.counts.project).toBe(1);
    expect(value.throttle.limits.maxActivePerProject).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler refreshes invocation metadata when admitting a deferred task with a new template", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-reroute-template-");
    const repo = createGitRepo("loops-cli-event-handler-reroute-template-repo-");
    const baseEvent = {
      type: "task.created",
      source: "@hasna/todos",
      data: {
        title: "Queue rerouted project task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const throttledArgs = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, throttledArgs, JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-active",
      data: { ...baseEvent.data, id: "task-reroute-template-active" },
    }));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.workItem.status).toBe("admitted");
    expect(firstValue.invocation.templateId).toBe("todos-task-worker-verifier");

    const activeDedupe = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--template",
      "task-lifecycle",
    ], JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-active-again",
      data: { ...baseEvent.data, id: "task-reroute-template-active" },
    }));
    expect(activeDedupe.status).toBe(0);
    const activeDedupeValue = JSON.parse(activeDedupe.stdout);
    expect(activeDedupeValue.deduped).toBe(true);
    expect(activeDedupeValue.invocation.id).toBe(firstValue.invocation.id);
    expect(activeDedupeValue.invocation.templateId).toBe("todos-task-worker-verifier");
    expect(activeDedupeValue.invocation.sourceRef.id).toBe("evt-reroute-template-active");

    const deferred = runCli(dataDir, throttledArgs, JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-deferred",
      data: { ...baseEvent.data, id: "task-reroute-template-deferred" },
    }));
    expect(deferred.status).toBe(0);
    const deferredValue = JSON.parse(deferred.stdout);
    expect(deferredValue.skipped).toBe(true);
    expect(deferredValue.workItem.status).toBe("deferred");
    expect(deferredValue.invocation.templateId).toBe("todos-task-worker-verifier");

    const admitted = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--template",
      "task-lifecycle",
      "--auth-profile-pool",
      "account004,account005",
      "--worktree-mode",
      "required",
    ], JSON.stringify({
      ...baseEvent,
      id: "evt-reroute-template-deferred-again",
      data: { ...baseEvent.data, id: "task-reroute-template-deferred" },
    }));
    expect(admitted.status).toBe(0);
    const admittedValue = JSON.parse(admitted.stdout);
    expect(admittedValue.workItem.id).toBe(deferredValue.workItem.id);
    expect(admittedValue.workItem.status).toBe("admitted");
    expect(admittedValue.invocation.id).toBe(deferredValue.invocation.id);
    expect(admittedValue.invocation.templateId).toBe("task-lifecycle");
    expect(admittedValue.invocation.sourceRef.id).toBe("evt-reroute-template-deferred-again");
    expect(admittedValue.invocation.scope.accountPolicy).toBeUndefined();
    expect(admittedValue.invocation.scope.worktreePolicy).toBe("required");
    expect(admittedValue.invocation.outputPolicy.createTask).toBe("on_failure");
    expect(admittedValue.workflow.steps.map((step: { id: string }) => step.id)).toContain("triage");
    expect(storedInvocation(dataDir, admittedValue.invocation.id)?.scope?.accountPolicy).toBe("pool");

    const shown = runCli(dataDir, ["--json", "routes", "show", admittedValue.workItem.id]);
    expect(shown.status).toBe(0);
    const shownValue = JSON.parse(shown.stdout);
    expect(shownValue.invocation.templateId).toBe("task-lifecycle");
    expect(shownValue.invocation.sourceRef.id).toBe("evt-reroute-template-deferred-again");
  });

  test("todos task event handler canonicalizes repo subdirectories for per-project throttles", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-canonical-throttle-");
    const repo = createGitRepo("loops-cli-event-handler-canonical-throttle-repo-");
    const subdir = join(repo, "packages", "sdk");
    mkdirSync(subdir, { recursive: true });
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      id: "evt-canonical-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-canonical-throttle-0001",
        title: "Queue repo-root task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      id: "evt-canonical-throttle-0002",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-canonical-throttle-0002",
        title: "Queue subdir task",
        working_dir: subdir,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.throttle.counts.project).toBe(1);
    expect(testPath(value.throttle.projectPath)).toBe(testPath(repo));
  });

  test("todos task event handler throttles active workflows per project group", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-group-throttle-");
    const repoA = createGitRepo("loops-cli-event-handler-group-throttle-a-");
    const repoB = createGitRepo("loops-cli-event-handler-group-throttle-b-");
    const args = [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--project-group",
      "oss",
      "--max-active-per-project-group",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      id: "evt-group-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-group-throttle-0001",
        title: "Queue group task A",
        working_dir: repoA,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).deduped).toBe(false);

    const second = runCli(dataDir, args, JSON.stringify({
      id: "evt-group-throttle-0002",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-group-throttle-0002",
        title: "Queue group task B",
        working_dir: repoB,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    }));
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("project-group active workflow limit reached");
    expect(value.throttle.counts.projectGroup).toBe(1);
    expect(value.throttle.limits.maxActivePerProjectGroup).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dry-run with throttle options does not create a loop database", () => {
    // Deliberately unseeded: this test asserts the dry-run never creates loops.db.
    const dataDir = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-dry-throttle-"));
    const repo = createGitRepo("loops-cli-event-handler-dry-throttle-repo-");
    const event = {
      id: "evt-dry-throttle-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-dry-throttle-0001",
        title: "Preview throttled route",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--max-active",
      "1",
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.throttle.evaluated).toBe(false);
    expect(existsSync(join(dataDir, "loops.db"))).toBe(false);
  });

  test("todos task event handler dedupes before required worktree validation", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-dedupe-before-render-");
    const repo = createGitRepo("loops-cli-event-handler-dedupe-before-render-repo-");
    const event = {
      id: "evt-dedupe-before-render-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-dedupe-before-render",
        title: "Create first routable task",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const replay = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--worktree-mode",
      "required",
      "--project-path",
      "/tmp/not-a-real-openloops-required-repo",
    ], JSON.stringify({
      ...event,
      id: "evt-dedupe-before-render-0002",
      data: {
        ...event.data,
        working_dir: "/tmp/not-a-real-openloops-required-repo",
      },
    }));

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task drain uses todos ready and throttles active workflows per project", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-throttle-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-throttle-repo-");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-throttle-a",
        title: "Route first ready task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
      },
      {
        id: "task-drain-throttle-b",
        title: "Route second ready task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--max-active-per-project",
        "1",
        "--add-dir",
        join(dataDir, "todos-store"),
        "--worktree-mode",
        "off",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, CALLS_FILE: callsFile, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.source).toBe("todos ready");
    expect(value.scanned).toBe(2);
    expect(value.candidates).toBe(2);
    expect(value.considered).toBe(2);
    expect(value.created).toBe(1);
    expect(value.throttled).toBe(1);
    expect(value.results[1].queuedAtSource).toBe(true);
    expect(readFileSync(callsFile, "utf8")).toContain("ready --limit 10");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
    const worker = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "worker");
    expect(worker.target.addDirs).toBeUndefined();
    expect(worker.target.operationTemplateId).toBeDefined();
    const privateWorker = storedWorkflow(dataDir, value.results[0].workflow.id)?.steps.find((step) => step.id === "worker");
    expect(privateWorker?.target).toMatchObject({ addDirs: [join(dataDir, "todos-store")] });
  });

  test("todos task drain omits --project when no todos project is configured", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-no-todos-project-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '[]\n'; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);

    const result = runCli(
      dataDir,
      ["--json", "routes", "drain", "todos-task", "--dry-run"],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        LOOPS_TASK_PROJECT: "",
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.todosProject).toBeUndefined();
    expect(readFileSync(callsFile, "utf8").trim()).toBe("--json ready --limit 50");
  });

  test("todos task drain uses LOOPS_TASK_PROJECT and lets an explicit flag override it", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-todos-project-precedence-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '[]\n'; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);

    const inherited = runCli(
      dataDir,
      ["--json", "routes", "drain", "todos-task", "--dry-run"],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        LOOPS_TASK_PROJECT: "/tmp/todos-owned-default",
      },
    );
    expect(inherited.status).toBe(0);
    expect(JSON.parse(inherited.stdout).todosProject).toBe("/tmp/todos-owned-default");

    const explicit = runCli(
      dataDir,
      ["--json", "routes", "drain", "todos-task", "--todos-project", "/tmp/todos-explicit", "--dry-run"],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        LOOPS_TASK_PROJECT: "/tmp/todos-owned-default",
      },
    );
    expect(explicit.status).toBe(0);
    expect(JSON.parse(explicit.stdout).todosProject).toBe("/tmp/todos-explicit");
    expect(readFileSync(callsFile, "utf8").trim().split("\n")).toEqual([
      "--project /tmp/todos-owned-default --json ready --limit 50",
      "--project /tmp/todos-explicit --json ready --limit 50",
    ]);
  });

  test("todos task drain single-project keeps old idempotency and single ready scan", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-single-idem-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-single-idem-repo-");
    const spoofedSourceProject = createGitRepo("loops-cli-event-drain-single-spoofed-source-");
    const todosProject = join(dataDir, "todos-store");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-single-idempotency",
        title: "Route single project task",
        status: "pending",
        source_project_path: spoofedSourceProject,
        working_dir: repo,
        tags: ["auto:route"],
      },
    ];
    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        todosProject,
        "--limit",
        "10",
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0].idempotencyKey).toBe("todos-task:task-drain-single-idempotency");
    expect(value.results[0].event.data.source_project_path).toBeUndefined();
    expect(value.results[0].workflow.steps[0].target.args).toBeUndefined();
    expect(value.results[0].workflow.steps[0].target.operationTemplateId).toBeDefined();
    const sourceGate = storedWorkflow(dataDir, value.results[0].workflow.id)?.steps[0];
    expect(sourceGate?.target.type).toBe("command");
    if (!sourceGate || sourceGate.target.type !== "command") {
      throw new Error("expected private command source gate");
    }
    const sourceGateArgs = (sourceGate.target.args ?? []).join("\n");
    expect(sourceGateArgs).toContain(todosProject);
    expect(sourceGateArgs).not.toContain(spoofedSourceProject);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(false);
    expect(calls.filter((entry) => entry.includes("ready --limit")).length).toBe(1);
  });

  test("todos task drain from registered projects ignores task-controlled cross-repo route paths", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-registry-source-path-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const sourceA = createGitRepo("loops-cli-event-drain-registry-source-a-");
    const sourceB = createGitRepo("loops-cli-event-drain-registry-source-b-");
    const canonicalSourceA = testPath(sourceA);
    const canonicalSourceB = testPath(sourceB);
    const projectPrefix = testPath(tmpdir());
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "if [[ \"$*\" == *\"projects --json\"* ]]; then printf '%s\\n' \"$TODOS_PROJECTS_JSON\"; exit 0; fi",
        "project=",
        "args=\"$*\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$prev\" == \"--project\" ]]; then project=\"$arg\"; fi",
        "  prev=\"$arg\"",
        "done",
        "if [[ \"$args\" == *\" ready \"* ]]; then",
        "  if [[ \"$project\" == \"$PROJECT_A\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_A\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_B\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_B\"; exit 0; fi",
        "  if [[ \"$project\" == * ]]; then printf '%s\\n' \"[]\"; exit 0; fi",
        "fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const taskId = "task-drain-registry-shared-id";
    const readyA = [
      {
        id: taskId,
        title: "Registry route with malicious project_path",
        status: "pending",
        source_project_path: sourceB,
        route_project_path: sourceB,
        routeProjectPath: sourceB,
        project_path: sourceB,
        working_dir: sourceB,
        metadata: { route_project_path: sourceB, routeProjectPath: sourceB, project_path: sourceB, working_dir: sourceB },
        tags: ["auto:route"],
      },
    ];
    const readyB = [
      {
        id: taskId,
        title: "Registry route from second source",
        status: "pending",
        working_dir: sourceB,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-projects-from-registry",
        "--project-path-prefix",
        projectPrefix,
        "--max-dispatch",
        "2",
        "--max-active",
        "10",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        PROJECT_A: sourceA,
        PROJECT_B: sourceB,
        TODOS_PROJECTS_JSON: JSON.stringify([{ path: sourceA }, { path: sourceB }]),
        TODOS_READY_JSON_A: JSON.stringify(readyA),
        TODOS_READY_JSON_B: JSON.stringify(readyB),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.source).toBe("todos ready");
    expect(value.scanned).toBe(2);
    expect(value.results).toHaveLength(2);
    expect(value.created).toBe(2);
    expect(value.results[0].idempotencyKey).toBe(`todos-task:${canonicalSourceA}:${taskId}`);
    expect(value.results[1].idempotencyKey).toBe(`todos-task:${canonicalSourceB}:${taskId}`);
    expect(value.results[0].idempotencyKey).not.toBe(value.results[1].idempotencyKey);
    expect(value.results[0].event.data.source_project_path).toBe(sourceA);
    expect(value.results[1].event.data.source_project_path).toBe(sourceB);
    expect(value.results[0].event.data.project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.data.route_project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.data.routeProjectPath).toBe(canonicalSourceA);
    expect(value.results[0].event.data.working_dir).toBe(canonicalSourceA);
    expect(value.results[0].event.metadata.route_project_path).toBe(canonicalSourceA);
    expect(value.results[0].event.metadata.routeProjectPath).toBe(canonicalSourceA);
    expect(value.results[0].invocation.subjectRef.path).toBeUndefined();
    expect(value.results[0].invocation.scope.projectPath).toBeUndefined();
    expect(value.results[0].workItem.projectKey).toBeUndefined();
    expect(value.results[0].workflow.steps[0].target.cwd).toBeUndefined();
    expect(value.results[0].workflow.steps[0].target.args).toBeUndefined();
    const privateInvocation = storedInvocation(dataDir, value.results[0].invocation.id);
    const privateWorkItem = storedWorkItem(dataDir, value.results[0].workItem.id);
    const sourceGate = storedWorkflow(dataDir, value.results[0].workflow.id)?.steps[0];
    expect(privateInvocation?.subjectRef.path).toBe(canonicalSourceA);
    expect(privateInvocation?.scope?.projectPath).toBe(canonicalSourceA);
    expect(privateWorkItem?.projectKey).toBe(canonicalSourceA);
    expect(sourceGate?.target.type).toBe("command");
    if (!sourceGate || sourceGate.target.type !== "command") {
      throw new Error("expected private command source gate");
    }
    expect(sourceGate.target.cwd).toBe(canonicalSourceA);
    const sourceGateArgs = (sourceGate.target.args ?? []).join("\n");
    expect(sourceGateArgs).toContain(sourceA);
    expect(sourceGateArgs).not.toContain(sourceB);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(true);
    expect(calls.filter((entry) => entry.includes("ready --limit")).length).toBe(2);
  });

  test("todos task drain filters registered projects by prefix and include before ready scans", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-registry-filter-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const registryRoot = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-registry-root-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "loops-cli-event-drain-registry-outside-root-"));
    const sourceA = createGitRepoIn(registryRoot, "source-a-");
    const sourceB = createGitRepoIn(registryRoot, "source-b-");
    const sourceOutside = createGitRepoIn(outsideRoot, "source-outside-");
    const canonicalSourceA = testPath(sourceA);
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "if [[ \"$*\" == *\"projects --json\"* ]]; then printf '%s\\n' \"$TODOS_PROJECTS_JSON\"; exit 0; fi",
        "project=",
        "args=\"$*\"",
        "prev=",
        "for arg in \"$@\"; do",
        "  if [[ \"$prev\" == \"--project\" ]]; then project=\"$arg\"; fi",
        "  prev=\"$arg\"",
        "done",
        "if [[ \"$args\" == *\" ready \"* ]]; then",
        "  if [[ \"$project\" == \"$PROJECT_A\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_A\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_B\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_B\"; exit 0; fi",
        "  if [[ \"$project\" == \"$PROJECT_OUTSIDE\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON_OUTSIDE\"; exit 0; fi",
        "  printf '[]\\n'; exit 0",
        "fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
      { encoding: "utf8" },
    );
    chmodSync(todosBin, 0o755);
    const readyA = [
      {
        id: "task-drain-registry-filter-a",
        title: "Registry route included by both filters",
        status: "pending",
        working_dir: sourceA,
        tags: ["auto:route"],
      },
    ];
    const readyB = [
      {
        id: "task-drain-registry-filter-b",
        title: "Registry route excluded by include",
        status: "pending",
        working_dir: sourceB,
        tags: ["auto:route"],
      },
    ];
    const readyOutside = [
      {
        id: "task-drain-registry-filter-outside",
        title: "Registry route excluded by prefix",
        status: "pending",
        working_dir: sourceOutside,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-projects-from-registry",
        "--project-path-prefix",
        registryRoot,
        "--todos-project-include",
        `${sourceA},${sourceOutside}`,
        "--max-dispatch",
        "3",
        "--max-active",
        "10",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        PROJECT_A: sourceA,
        PROJECT_B: sourceB,
        PROJECT_OUTSIDE: sourceOutside,
        TODOS_PROJECTS_JSON: JSON.stringify([{ path: sourceA }, { path: sourceB }, { path: sourceOutside }]),
        TODOS_READY_JSON_A: JSON.stringify(readyA),
        TODOS_READY_JSON_B: JSON.stringify(readyB),
        TODOS_READY_JSON_OUTSIDE: JSON.stringify(readyOutside),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(1);
    expect(value.candidates).toBe(1);
    expect(value.created).toBe(1);
    expect(value.results).toHaveLength(1);
    expect(value.results[0].event.subject).toBe("task-drain-registry-filter-a");
    expect(value.results[0].event.data.source_project_path).toBe(sourceA);
    expect(value.results[0].event.data.project_path).toBe(canonicalSourceA);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean);
    expect(calls.some((entry) => entry.includes("projects --json"))).toBe(true);
    const readyCalls = calls.filter((entry) => entry.includes(" ready "));
    expect(readyCalls).toHaveLength(1);
    expect(readyCalls[0]).toContain(sourceA);
    expect(readyCalls[0]).not.toContain(sourceB);
    expect(readyCalls[0]).not.toContain(sourceOutside);
  });

  test("todos task drain counts non-skippable per-task errors as fatal and exits non-zero", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-fatal-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "printf 'unexpected todos command: %s\\n' \"$*\" >&2",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    // Ready tasks missing an id hit a non-skippable route error in taskDrainEvent
    // for every candidate: a systemic failure that used to abort the batch.
    const ready = [
      { title: "no id one", status: "pending", tags: ["auto:route"] },
      { title: "no id two", status: "pending", tags: ["auto:route"] },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "routes",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    // Regression: a fully-fatal drain must NOT exit 0 (a scheduled loop would
    // otherwise mark a route-nothing run "succeeded").
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("non-skippable");
    const value = JSON.parse(result.stdout);
    expect(value.considered).toBe(2);
    expect(value.created).toBe(0);
    expect(value.fatal).toBe(2);
    // Every fatal result is individually flagged so compact/cron output keeps it.
    expect(value.results.filter((entry: { fatal?: boolean }) => entry.fatal === true)).toHaveLength(2);
  });

  test("todos task drain applies metadata provider rules with account separation evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-provider-rule-");
    const binDir = join(dataDir, "bin");
    const repo = createGitRepo("loops-cli-event-drain-provider-rule-repo-");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-provider-rule",
        title: "Route frontend task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
        metadata: {
          area: "frontend",
          account_tool: "cursor",
        },
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "1",
        "--dry-run",
        "--provider-rule",
        "area=frontend:claude:claude-ui-a,claude-ui-b",
        "--worktree-mode",
        "required",
        "--worktree-root",
        join(dataDir, "worktrees"),
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0].providerRouting).toMatchObject({
      provider: "claude",
      source: "rule",
      reason: "matched provider rule area=frontend",
    });
    expect(value.results[0].invocation.scope.providerRouting.rule.raw).toBe("area=frontend:claude:claude-ui-a,claude-ui-b");
    const worker = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.results[0].workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(worker.target.account.profile).not.toBe(verifier.target.account.profile);
    expect([worker.target.account.profile, verifier.target.account.profile].sort()).toEqual(["claude-ui-a", "claude-ui-b"]);
  });

  test("todos task drain skips non-routeable tasks and continues dispatching", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-skip-non-git-");
    const binDir = join(dataDir, "bin");
    const repo = createGitRepo("loops-cli-event-drain-skip-non-git-repo-");
    const nonGit = join(dataDir, "not-a-repo");
    mkdirSync(nonGit, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"comment\" || \"$arg\" == \"tag\" || \"$arg\" == \"untag\" ]]; then printf 'ok\\n'; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-non-git",
        title: "Bad route task",
        status: "pending",
        working_dir: nonGit,
        tags: ["auto:route"],
      },
      {
        id: "task-drain-good-repo",
        title: "Good route task",
        status: "pending",
        working_dir: repo,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--worktree-mode",
        "required",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.considered).toBe(2);
    expect(value.skipped).toBe(1);
    expect(value.created).toBe(1);
    expect(value.results[0]).toMatchObject({
      kind: "skipped",
      taskId: "task-drain-non-git",
      routeError: true,
    });
    expect(value.results[0].reason).toContain("worktreeMode=required");
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: true,
      attempted: true,
      taskId: "task-drain-non-git",
    });
    expect(value.results[0].sourceTaskUpdate.tagNoAuto.ok).toBe(true);
    expect(value.results[0].sourceTaskUpdate.untagAutoRoute.ok).toBe(true);
    expect(value.results[1].kind).toBe("created");
    expect(value.results[1].event.subject).toBe("task-drain-good-repo");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task drain reports failed source task cleanup for invalid project paths", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-cleanup-fail-");
    const binDir = join(dataDir, "bin");
    const nonGit = join(dataDir, "not-a-repo");
    mkdirSync(nonGit, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "args=\" $* \"",
        "if [[ \"$args\" == *\" task-lists \"* ]]; then printf '[]\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" ready \"* ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$args\" == *\" comment \"* ]]; then printf 'commented\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" untag \"* ]]; then printf 'untagged\\n'; exit 0; fi",
        "if [[ \"$args\" == *\" tag \"* ]]; then printf 'lock unavailable\\n' >&2; exit 9; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-cleanup-fail",
        title: "Bad route task cleanup failure",
        status: "pending",
        working_dir: nonGit,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--worktree-mode",
        "required",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(1);
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: false,
      attempted: true,
      taskId: "task-drain-cleanup-fail",
    });
    expect(value.results[0].sourceTaskUpdate.error).toContain("source task updates failed");
    expect(value.results[0].sourceTaskUpdate.comment.ok).toBe(true);
    expect(value.results[0].sourceTaskUpdate.tagNoAuto.ok).toBe(false);
    expect(value.results[0].sourceTaskUpdate.untagAutoRoute.ok).toBe(true);
  });

  test("todos task drain quarantines invalid PR project paths before reviewer gating", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-invalid-pr-path-");
    const binDir = join(dataDir, "bin");
    const nonGit = join(dataDir, "not-a-repo");
    mkdirSync(nonGit, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"comment\" || \"$arg\" == \"tag\" || \"$arg\" == \"untag\" ]]; then printf 'ok\\n'; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-invalid-pr-path",
        title: "Review and safely merge hasna/secrets#5",
        description: [
          "Fingerprint: github-pr:hasna/secrets#5",
          `Repository: ${nonGit}`,
          "PR: https://github.com/hasna/secrets/pull/5",
          "",
          "Merge only when validation and policy allow it.",
        ].join("\n"),
        status: "pending",
        working_dir: dataDir,
        tags: ["auto:route", "github-pr", "pr-merge-queue"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--worktree-mode",
        "required",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(1);
    expect(value.created).toBe(0);
    expect(value.results[0]).toMatchObject({
      kind: "skipped",
      taskId: "task-drain-invalid-pr-path",
      routeError: true,
    });
    expect(value.results[0].reason).toContain("worktreeMode=required");
    expect(value.results[0].reason).not.toContain("PR approval/merge");
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: true,
      attempted: true,
      taskId: "task-drain-invalid-pr-path",
    });
  });

  test("todos task drain skips no-auto and blocked tags before workflow creation", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-disallowed-tags-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '[]\\n'; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-no-auto",
        title: "No auto task",
        status: "pending",
        working_dir: "/tmp/not-a-real-openloops-required-repo",
        tags: ["auto:route", "no-auto"],
      },
      {
        id: "task-drain-blocked-tag",
        title: "Blocked tag task",
        status: "pending",
        working_dir: "/tmp/not-a-real-openloops-required-repo",
        tags: ["auto:route", "blocked"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--limit",
        "10",
        "--max-dispatch",
        "5",
        "--worktree-mode",
        "required",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_JSON: JSON.stringify(ready) },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    // Route-disallowed tags are held out of the candidate window entirely
    // (counted as excludedDisallowedTag) instead of burning a considered slot
    // per tick just to be rejected by eligibility.
    expect(value.excludedDisallowedTag).toBe(2);
    expect(value.candidates).toBe(0);
    expect(value.considered).toBe(0);
    expect(value.created).toBe(0);
    expect(value.skipped).toBe(0);
    expect(value.results).toEqual([]);
    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("todos task drain filters by task list and limits new dispatches", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-filter-");
    const binDir = join(dataDir, "bin");
    const callsFile = join(dataDir, "todos-calls.txt");
    const repo = createGitRepo("loops-cli-event-drain-filter-repo-");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' \"$*\" >> \"$CALLS_FILE\"",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"task-lists\" ]]; then printf '%s\\n' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"project-route\" ]]; then printf 'project id leaked into todos ready args\\n' >&2; exit 7; fi",
        "done",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then printf '%s\\n' \"$TODOS_READY_JSON\"; exit 0; fi",
        "done",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-filter-a",
        project_id: "project-route",
        title: "Route matching list task",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
      {
        id: "task-drain-filter-b",
        project_id: "project-route",
        title: "Route second matching list task later",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
      {
        id: "task-drain-filter-c",
        project_id: "project-other",
        title: "Ignore other list task",
        status: "pending",
        task_list_id: "list-route",
        working_dir: repo,
        tags: ["auto:route", "repoops"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--todos-project-id",
        "project-route",
        "--project-path-prefix",
        repo,
        "--tags",
        "repoops",
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALLS_FILE: callsFile,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(3);
    expect(value.candidates).toBe(2);
    expect(value.filteredCandidates).toBe(2);
    expect(value.scanLimit).toBe(500);
    expect(value.considered).toBe(1);
    expect(value.created).toBe(1);
    expect(value.taskListId).toBe("list-route");
    expect(value.projectPathPrefix).toBe(repo);
    expect(readFileSync(callsFile, "utf8")).toContain("ready --limit 500");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
    expect(loops[0].name).toContain("task-dra");
  });

  test("todos task drain compact output omits bulky task and workflow details", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-compact-");
    const binDir = join(dataDir, "bin");
    const evidenceDir = join(dataDir, "evidence");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const codewithBin = join(binDir, "codewith");
    writeFileSync(
      codewithBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == \"agent diagnostics --json\" ]]; then",
        "  printf '%s' '{\"activeRunCount\":2,\"maxActiveRunsPerUser\":8,\"availableActiveRunSlots\":6}'",
        "  exit 0",
        "fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(codewithBin, 0o755);
    const bulkyDetail = "very long private task details ".repeat(200);
    const ready = [
      {
        id: "task-drain-compact",
        project_id: "project-route",
        title: "Compact route task",
        description: bulkyDetail,
        status: "pending",
        task_list_id: "list-route",
        working_dir: dataDir,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--compact",
        "--evidence-dir",
        evidenceDir,
        "--max-dispatch",
        "1",
        "--provider-active-cap",
        "6",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("very long private task details");
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(1);
    expect(value.results[0]).toMatchObject({
      kind: "created",
      taskId: "task-drain-compact",
    });
    expect(value.results[0].providerAdmission).toMatchObject({
      allowed: true,
      provider: "codewith",
      checked: true,
      activeCap: 6,
      diagnostics: { activeRunCount: 2, availableActiveRunSlots: 6 },
    });
    expect(value.results[0].event).toBeUndefined();
    expect(value.results[0].workflow).toBeUndefined();
    expect(existsSync(value.evidencePath)).toBe(true);
    const evidence = readFileSync(value.evidencePath, "utf8");
    expect(evidence).toContain("very long private task details");
  });

  test("todos task drain exits nonzero when provider admission diagnostics fail", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-provider-admission-fail-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const codewithBin = join(binDir, "codewith");
    writeFileSync(
      codewithBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == \"agent diagnostics --json\" ]]; then",
        "  printf 'diagnostics unavailable\\n' >&2",
        "  exit 17",
        "fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(codewithBin, 0o755);
    const ready = [
      {
        id: "task-drain-provider-admission-fail",
        title: "Route task while diagnostics are broken",
        description: "provider admission should fail closed",
        status: "pending",
        working_dir: dataDir,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--compact",
        "--max-dispatch",
        "1",
        "--provider-admission-check",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("route drain hit 1 non-skippable task error");
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(0);
    expect(value.throttled).toBe(1);
    expect(value.fatal).toBe(1);
    expect(value.results[0].providerAdmission).toMatchObject({
      allowed: false,
      provider: "codewith",
      checked: true,
      fatal: true,
    });
  });

  test("todos task drain derives project path from repository line in task descriptions", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-repo-line-");
    const repo = createGitRepo("loops-cli-event-drain-repo-line-repo-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-repo-line",
        project_id: "project-route",
        title: "Route PR task with unstructured repo path",
        description: `Fingerprint: github-pr:hasna/example#1\nRepository: ${repo}\nPR: https://github.com/hasna/example/pull/1`,
        status: "pending",
        task_list_id: "list-route",
        working_dir: "/home/hasna",
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--project-path-prefix",
        repo,
        "--tags",
        "auto:route",
        "--dry-run",
        "--worktree-mode",
        "off",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.filteredCandidates).toBe(1);
    expect(value.created).toBe(1);
    // The description-derived repo is now canonicalized (macOS: /var/... ->
    // /private/var/...) because it rides the usable-repo route path.
    expect(value.results[0].event.data.cwd).toBe(testPath(repo));
    expect(value.results[0].event.data.project_path).toBe(testPath(repo));
    expect(value.results[0].workflow.steps[0].target.cwd).toBe(testPath(repo));
  });

  test("todos task drain uses explicit project path instead of stale task working_dir for required worktrees", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-explicit-project-");
    const routeRepo = createGitRepo("loops-cli-event-drain-explicit-project-repo-");
    const staleWorkingDir = join(dataDir, "platform-alumia");
    const binDir = join(dataDir, "bin");
    const worktreeRoot = join(dataDir, "worktrees");
    mkdirSync(staleWorkingDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-explicit-project",
        project_id: "project-route",
        title: "Route task with stale working_dir",
        description: "Working dir was copied from the wrong project before route creation.",
        status: "pending",
        task_list_id: "list-route",
        working_dir: staleWorkingDir,
        metadata: { working_dir: staleWorkingDir },
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--project-path",
        routeRepo,
        "--template",
        "task-lifecycle",
        "--dry-run",
        "--worktree-mode",
        "required",
        "--worktree-root",
        worktreeRoot,
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    const canonicalRouteRepo = testPath(routeRepo);
    const routed = value.results[0];
    expect(value.created).toBe(1);
    expect(routed.event.data.routeProjectPath).toBe(canonicalRouteRepo);
    expect(routed.event.data.project_path).toBe(canonicalRouteRepo);
    expect(routed.event.data.source_task_working_dir).toBe(staleWorkingDir);
    expect(routed.invocation.subjectRef.path).toBe(canonicalRouteRepo);
    expect(routed.invocation.scope.projectPath).toBe(canonicalRouteRepo);
    expect(routed.workItem.projectKey).toBe(canonicalRouteRepo);

    const sourceGate = routed.workflow.steps.find((step: { id: string }) => step.id === "source-task-gate");
    expect(testPath(sourceGate.target.cwd)).toBe(canonicalRouteRepo);
    expect(sourceGate.target.args.join("\n")).toContain(join(dataDir, "todos-store"));
    const worker = routed.workflow.steps.find((step: { id: string }) => step.id === "worker");
    expect(testPath(worker.target.worktree.originalCwd)).toBe(canonicalRouteRepo);
    expect(testPath(worker.target.worktree.repoRoot)).toBe(canonicalRouteRepo);
    expect(testPath(worker.target.worktree.path)).toContain(testPath(worktreeRoot));
    expect(worker.target.cwd).toBe(worker.target.worktree.cwd);
  });

  test("todos task drain reports an invalid route path when no task path is a usable repository", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-invalid-explicit-project-");
    const staleWorkingDir = join(dataDir, "stale-working-dir");
    const invalidRoutePath = join(dataDir, "not-a-git-repo");
    const binDir = join(dataDir, "bin");
    mkdirSync(staleWorkingDir, { recursive: true });
    mkdirSync(invalidRoutePath, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\" comment \"* || \"$*\" == *\" tag \"* || \"$*\" == *\" untag \"* ]]; then printf 'ok\\n'; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    // Neither the task's working_dir nor the router's --project-path is a git
    // repository: nothing usable anywhere -> skip + mark non-routeable (the
    // pre-existing rescue-failure behavior stays intact).
    const ready = [
      {
        id: "task-drain-invalid-explicit-project",
        project_id: "project-route",
        title: "Route task with no usable repository path anywhere",
        status: "pending",
        task_list_id: "list-route",
        working_dir: staleWorkingDir,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--project-path",
        invalidRoutePath,
        "--max-dispatch",
        "1",
        "--worktree-mode",
        "required",
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(0);
    expect(value.skipped).toBe(1);
    expect(value.results[0]).toMatchObject({
      kind: "skipped",
      taskId: "task-drain-invalid-explicit-project",
      routeError: true,
      routeProjectPath: testPath(invalidRoutePath),
      sourceTaskWorkingDir: staleWorkingDir,
    });
    expect(value.results[0].reason).toContain("worktreeMode=required");
    expect(value.results[0].reason).toContain("not-a-git-repo");
    expect(value.results[0].sourceTaskUpdate).toMatchObject({
      ok: true,
      attempted: true,
      taskId: "task-drain-invalid-explicit-project",
    });
    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(0);
  });

  test("todos task drain routes to the task's own repository over an invalid explicit route path", () => {
    // Regression flip of 8ab2664's "explicit invalid path always skips": a task
    // whose own working_dir IS a usable git repository must route there instead
    // of dying on the router-level path — the merge-lane wedge in miniature.
    const dataDir = freshDataDir("loops-cli-event-drain-task-repo-wins-");
    const sourceRepo = createGitRepo("loops-cli-event-drain-task-repo-wins-source-");
    const invalidRoutePath = join(dataDir, "not-a-git-repo");
    const worktreeRoot = join(dataDir, "worktrees");
    const binDir = join(dataDir, "bin");
    mkdirSync(invalidRoutePath, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-task-repo-wins",
        project_id: "project-route",
        title: "Route task whose own working_dir is the real repository",
        status: "pending",
        task_list_id: "list-route",
        working_dir: sourceRepo,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--project-path",
        invalidRoutePath,
        "--template",
        "task-lifecycle",
        "--dry-run",
        "--worktree-mode",
        "required",
        "--worktree-root",
        worktreeRoot,
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    const canonicalRepo = testPath(sourceRepo);
    expect(value.created).toBe(1);
    expect(value.skipped).toBe(0);
    const routed = value.results[0];
    expect(routed.event.data.project_path).toBe(canonicalRepo);
    expect(routed.event.data.routeProjectPath).toBe(canonicalRepo);
    expect(routed.invocation.scope.projectPath).toBe(canonicalRepo);
    const worker = routed.workflow.steps.find((step: { id: string }) => step.id === "worker");
    expect(worker.target.worktree.repoRoot).toBe(canonicalRepo);
  });

  test("todos task drain routes a merge-lane task to its description repository over the group-root project path", () => {
    // The exact 8ab2664 regression scenario: a multi-repo drain passes
    // --project-path as a GROUP ROOT (not a git repo, e.g. /home/hasna) while
    // each task names its real repository only in the description
    // ("Repository: /path/to/repo") and carries a mis-set working_dir. The task
    // must route to ITS repository; before the fix every such task skipped with
    // "worktreeMode=required but projectPath is not an existing git repository"
    // and merge dispatch was zero fleet-wide.
    const dataDir = freshDataDir("loops-cli-event-drain-group-root-");
    const repo = createGitRepo("loops-cli-event-drain-group-root-repo-");
    const groupRoot = join(dataDir, "group-root");
    const staleWorkingDir = join(dataDir, "loops-data-dir");
    const worktreeRoot = join(dataDir, "worktrees");
    const binDir = join(dataDir, "bin");
    mkdirSync(groupRoot, { recursive: true });
    mkdirSync(staleWorkingDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "if [[ \"$*\" == *\"ready\"* ]]; then printf '%s' \"$TODOS_READY_JSON\"; exit 0; fi",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '%s' \"$TODOS_TASK_LISTS_JSON\"; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    const ready = [
      {
        id: "task-drain-group-root-merge",
        project_id: "project-route",
        title: "Fix the flaky connector test",
        description: `Stabilize the retry test.\n\nRepository: ${repo}\nAcceptance: suite green.`,
        status: "pending",
        task_list_id: "list-route",
        working_dir: staleWorkingDir,
        tags: ["auto:route"],
      },
    ];

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--task-list",
        "route",
        "--project-path",
        groupRoot,
        "--project-group",
        "repoops",
        "--template",
        "task-lifecycle",
        "--dry-run",
        "--worktree-mode",
        "required",
        "--worktree-root",
        worktreeRoot,
      ],
      undefined,
      {
        PATH: `${binDir}:/usr/bin:/bin`,
        TODOS_TASK_LISTS_JSON: JSON.stringify([{ id: "list-route", slug: "route", name: "Route" }]),
        TODOS_READY_JSON: JSON.stringify(ready),
      },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    const canonicalRepo = testPath(repo);
    expect(value.created).toBe(1);
    expect(value.skipped).toBe(0);
    const routed = value.results[0];
    // Neutralization: without the per-task-repo preference this is a skip on
    // "not an existing git repository: <groupRoot>" and created stays 0.
    expect(routed.event.data.project_path).toBe(canonicalRepo);
    expect(routed.event.data.routeProjectPath).toBe(canonicalRepo);
    expect(routed.event.data.source_task_working_dir).toBe(staleWorkingDir);
    expect(routed.invocation.scope.projectPath).toBe(canonicalRepo);
    const worker = routed.workflow.steps.find((step: { id: string }) => step.id === "worker");
    expect(worker.target.worktree.repoRoot).toBe(canonicalRepo);
    expect(worker.target.worktree.path).toContain(worktreeRoot);
  });

  test("todos task drain parses large ready payloads without truncating JSON", () => {
    const dataDir = freshDataDir("loops-cli-event-drain-large-ready-");
    const binDir = join(dataDir, "bin");
    const readyFile = join(dataDir, "ready.json");
    mkdirSync(binDir, { recursive: true });
    const todosBin = join(binDir, "todos");
    writeFileSync(
      todosBin,
      [
        "#!/usr/bin/env bash",
        "for arg in \"$@\"; do",
        "  if [[ \"$arg\" == \"ready\" ]]; then cat \"$TODOS_READY_FILE\"; exit 0; fi",
        "done",
        "if [[ \"$*\" == *\"task-lists\"* ]]; then printf '[]\\n'; exit 0; fi",
        "exit 2",
        "",
      ].join("\n"),
    );
    chmodSync(todosBin, 0o755);
    writeFileSync(
      readyFile,
      JSON.stringify([
        {
          id: "task-drain-large-ready",
          title: "Large ready task",
          status: "pending",
          description: "x".repeat(9 * 1024 * 1024),
          tags: ["manual"],
        },
      ]),
    );

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "drain",
        "todos-task",
        "--todos-project",
        join(dataDir, "todos-store"),
        "--tags",
        "auto:route",
        "--dry-run",
      ],
      undefined,
      { PATH: `${binDir}:/usr/bin:/bin`, TODOS_READY_FILE: readyFile },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.scanned).toBe(1);
    expect(value.filteredCandidates).toBe(0);
    expect(value.considered).toBe(0);
  });

  test("todos task event handler --preflight fails before storing generated workflow loops", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-fail-");
    const home = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const event = {
      id: "evt-task-created-preflight-fail",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-preflight-fail",
        title: "Route with bad profile",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "todos-task",
        "--provider",
        "codewith",
        "--auth-profile",
        "missing",
        "--preflight",
      ],
      JSON.stringify(event),
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(false);
    expect(value.preflight.error).toContain("workflow step worker preflight failed");
    expect(value.preflight.error).toContain("codewith auth profile not found: missing");

    const loops = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(loops.stdout)).toEqual([]);
    const workflows = runCli(dataDir, ["--json", "workflows", "list"]);
    expect(JSON.parse(workflows.stdout)).toEqual([]);
  });

  test("todos task event handler --preflight dedupes existing loops before provider checks", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-dedupe-");
    const home = mkdtempSync(join(tmpdir(), "loops-cli-event-handler-preflight-dedupe-home-"));
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
        "  printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const event = {
      id: "evt-task-created-dedupe-preflight-1",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-dedupe-preflight",
        title: "Dedupe before bad profile",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const create = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(create.status).toBe(0);
    const created = JSON.parse(create.stdout);

    const replay = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "todos-task",
        "--provider",
        "codewith",
        "--auth-profile",
        "missing",
        "--preflight",
      ],
      JSON.stringify({ ...event, id: "evt-task-created-dedupe-preflight-2" }),
      { HOME: home, PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task event handler --preflight replaces stale generated workflows before storing loop", () => {
    const dataDir = freshDataDir("loops-cli-event-handler-preflight-existing-workflow-");
    const binDir = join(dataDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const codewith = join(binDir, "codewith");
    writeFileSync(codewith, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(codewith, 0o755);
    const event = {
      id: "evt-existing-workflow-preflight",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-existing-workflow-preflight",
        title: "Reuse existing workflow",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const preview = runCli(dataDir, ["--json", "events", "handle", "todos-task", "--dry-run"], JSON.stringify(event));
    expect(preview.status).toBe(0);
    const previewValue = JSON.parse(preview.stdout);
    let staleWorkflowId = "";
    const store = new Store(join(dataDir, "loops.db"));
    try {
      const staleWorkflow = store.createWorkflow({
        name: previewValue.workflow.name,
        steps: [{ id: "stale", target: { type: "command", command: "openloops-definitely-missing-binary" } }],
      });
      staleWorkflowId = staleWorkflow.id;
    } finally {
      store.close();
    }

    const result = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--preflight"],
      JSON.stringify(event),
      { PATH: `${binDir}:/usr/bin:/bin` },
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.workflow.id).not.toBe(staleWorkflowId);
    expect(value.loop.target.workflowId).toBe(value.workflow.id);
    const loops = runCli(dataDir, ["--json", "list"]);
    expect(JSON.parse(loops.stdout)).toHaveLength(1);

    const staleAfter = runCli(dataDir, ["--json", "workflows", "show", staleWorkflowId]);
    expect(staleAfter.status).toBe(0);
    expect(JSON.parse(staleAfter.stdout).status).toBe("archived");
  });

  test("todos task event handler ignores legacy event-id loop names and dedupes through work items", () => {
    const dataDir = freshDataDir("loops-cli-event-no-legacy-dedupe-");
    const event = {
      id: "evt-task-created-legacy",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-legacy",
        title: "Legacy route replay",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };
    const store = new Store(join(dataDir, "loops.db"));
    let legacyLoopId = "";
    try {
      const workflow = store.createWorkflow({
        name: "event:todos-task:task-cre:evt-task:workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const loop = store.createLoop({
        name: "event:todos-task:task-cre:evt-task:run",
        schedule: { type: "once", at: futureAt() },
        target: { type: "workflow", workflowId: workflow.id },
      });
      legacyLoopId = loop.id;
    } finally {
      store.close();
    }

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.deduped).toBe(false);
    expect(value.loop.id).not.toBe(legacyLoopId);
    expect(value.workItem.status).toBe("admitted");

    const replay = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify({ ...event, id: "evt-task-created-legacy-replay" }));
    expect(replay.status).toBe(0);
    const replayValue = JSON.parse(replay.stdout);
    expect(replayValue.deduped).toBe(true);
    expect(replayValue.dedupedBy).toBe("work-item");
    expect(replayValue.workItem.id).toBe(value.workItem.id);
  });

  test("todos task event handler dedupes by task idempotency across route prefixes", () => {
    const dataDir = freshDataDir("loops-cli-event-idempotency-dedupe-");
    const event = {
      id: "evt-task-created-cross-prefix-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-cross-prefix",
        title: "Do not duplicate across route drains",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--name-prefix", "event:first-route"],
      JSON.stringify(event),
    );
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--name-prefix", "event:second-route"],
      JSON.stringify({ ...event, id: "evt-task-created-cross-prefix-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:task-created-cross-prefix");
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dedupes PR backlog tasks by GitHub fingerprint", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-fingerprint-dedupe-");
    const repo = createGitRepo("loops-cli-event-pr-fingerprint-dedupe-repo-");
    const event = {
      id: "evt-task-created-pr-fingerprint-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-fingerprint-a",
        title: "Review and safely merge hasna/loops#39",
        description: [
          "Fingerprint: github-pr:hasna/loops#39",
          `Repository: ${repo}`,
          "GitHub author is andrei-hasna",
          "GitHub reviewer pool: andrei-hasna, kriptoburak",
        ].join("\n"),
        pr_state: "OPEN",
        working_dir: repo,
        tags: ["auto:route", "github-pr", "pr-merge-queue"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--github-reviewer-pool", "andrei-hasna,kriptoburak"],
      JSON.stringify(event),
    );
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    expect(created.idempotencyKey).toBe("todos-task:pr:hasna/loops#39");

    const duplicate = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--github-reviewer-pool", "andrei-hasna,kriptoburak"],
      JSON.stringify({
        ...event,
        id: "evt-task-created-pr-fingerprint-b",
        data: {
          ...event.data,
          id: "task-pr-fingerprint-b",
        },
      }),
    );

    expect(duplicate.status).toBe(0);
    const value = JSON.parse(duplicate.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:pr:hasna/loops#39");
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler keeps ordinary PR-link tasks on task idempotency", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-link-non-backlog-");
    const repo = createGitRepo("loops-cli-event-pr-link-non-backlog-repo-");
    const event = {
      id: "evt-task-created-pr-link-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-link-a",
        title: "Track upstream change https://github.com/hasna/loops/pull/39",
        description: "Capture notes about an upstream change without routing PR operations.",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout).idempotencyKey).toBe("todos-task:task-pr-link-a");

    const second = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({
        ...event,
        id: "evt-task-created-pr-link-b",
        data: {
          ...event.data,
          id: "task-pr-link-b",
        },
      }),
    );
    expect(second.status).toBe(0);
    const value = JSON.parse(second.stdout);
    expect(value.deduped).toBe(false);
    expect(value.idempotencyKey).toBe("todos-task:task-pr-link-b");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(2);
  });

  test("todos task event handler dedupes PR fingerprint routes against legacy task keys", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-fingerprint-legacy-dedupe-");
    const repo = createGitRepo("loops-cli-event-pr-fingerprint-legacy-dedupe-repo-");
    const legacy = {
      id: "evt-task-created-pr-legacy-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-legacy",
        title: "Route before PR fingerprint backfill",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(legacy));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    expect(created.idempotencyKey).toBe("todos-task:task-pr-legacy");

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--github-reviewer-pool", "andrei-hasna,kriptoburak"],
      JSON.stringify({
        ...legacy,
        id: "evt-task-created-pr-legacy-b",
        data: {
          ...legacy.data,
          title: "Review and safely merge hasna/loops#39",
          description: [
            "Fingerprint: github-pr:hasna/loops#39",
            `Repository: ${repo}`,
            "GitHub author is andrei-hasna",
            "GitHub reviewer pool: andrei-hasna, kriptoburak",
          ].join("\n"),
          tags: ["auto:route", "github-pr", "pr-merge-queue"],
        },
      }),
    );
    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:pr:hasna/loops#39");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dedupes queued legacy PR work items", () => {
    const dataDir = freshDataDir("loops-cli-event-pr-fingerprint-queued-legacy-dedupe-");
    const repo = createGitRepo("loops-cli-event-pr-fingerprint-queued-legacy-dedupe-repo-");
    const legacy = {
      id: "evt-task-created-pr-queued-legacy-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-queued-legacy",
        title: "Route before PR fingerprint backfill",
        working_dir: repo,
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(legacy));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='failed', loop_id=NULL, last_reason='dispatcher parse failed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }
    const requeue = runCli(dataDir, ["--json", "routes", "requeue", created.workItem.id, "--reason", "retry after dispatcher repair"]);
    expect(requeue.status).toBe(0);
    expect(JSON.parse(requeue.stdout).status).toBe("queued");

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--github-reviewer-pool", "andrei-hasna,kriptoburak"],
      JSON.stringify({
        ...legacy,
        id: "evt-task-created-pr-queued-legacy-b",
        data: {
          ...legacy.data,
          title: "Review and safely merge hasna/loops#39",
          description: [
            "Fingerprint: github-pr:hasna/loops#39",
            `Repository: ${repo}`,
            "GitHub author is andrei-hasna",
            "GitHub reviewer pool: andrei-hasna, kriptoburak",
          ].join("\n"),
          tags: ["auto:route", "github-pr", "pr-merge-queue"],
        },
      }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:pr:hasna/loops#39");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.status).toBe("queued");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dedupes task updates against the same task route", () => {
    const dataDir = freshDataDir("loops-cli-event-task-update-dedupe-");
    const event = {
      id: "evt-task-created-update-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-update-dedupe",
        title: "Only one worker per task",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const update = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-update-dedupe-b", type: "task.updated" }),
    );
    expect(update.status).toBe(0);
    const value = JSON.parse(update.stdout);
    expect(value.deduped).toBe(true);
    expect(value.idempotencyKey).toBe("todos-task:task-created-update-dedupe");
    expect(value.loop.id).toBe(created.loop.id);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
  });

  test("todos task event handler dedupes failed routed work items until explicit requeue", () => {
    const dataDir = freshDataDir("loops-cli-event-failed-dedupe-");
    const event = {
      id: "evt-task-created-failed-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-failed-dedupe",
        title: "Do not retry failed task without requeue",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='failed', loop_id=NULL, last_reason='triage gate failed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-failed-dedupe-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.dedupedBy).toBe("work-item");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.status).toBe("failed");
    expect(value.loop).toBeUndefined();
    const loopsBeforeRequeue = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loopsBeforeRequeue).toHaveLength(1);

    const requeue = runCli(dataDir, ["--json", "routes", "requeue", created.workItem.id, "--reason", "fixed project path"]);
    expect(requeue.status).toBe(0);
    const requeued = JSON.parse(requeue.stdout);
    expect(requeued.id).toBe(created.workItem.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.loopId).toBeUndefined();
    expect(requeued.lastReason).toBeUndefined();
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toBe("fixed project path");

    const afterRequeueReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-failed-dedupe-c" }),
    );
    expect(afterRequeueReplay.status).toBe(0);
    const recreated = JSON.parse(afterRequeueReplay.stdout);
    expect(recreated.deduped).toBe(false);
    expect(recreated.workItem.id).toBe(created.workItem.id);
    expect(recreated.workItem.status).toBe("admitted");
    expect(recreated.loop.id).not.toBe(created.loop.id);
    const loopsAfterRequeue = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loopsAfterRequeue).toHaveLength(2);
  });

  test("routes requeue resets attempts by default and preserves them with --keep-attempts", () => {
    const dataDir = freshDataDir("loops-cli-requeue-reset-");
    function admitFailedItem(idSuffix: string, attempts: number): string {
      const event = {
        id: `evt-requeue-${idSuffix}`,
        type: "task.created",
        source: "@hasna/todos",
        data: { id: `task-requeue-${idSuffix}`, title: "requeue attempts", working_dir: "/tmp/open-todos", tags: ["auto:route"] },
        timestamp: new Date().toISOString(),
      };
      const res = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
      expect(res.status).toBe(0);
      const created = JSON.parse(res.stdout);
      const db = new Database(join(dataDir, "loops.db"));
      try {
        db.query("UPDATE workflow_work_items SET status='failed', loop_id=NULL, attempts=? WHERE id=?").run(attempts, created.workItem.id);
      } finally {
        db.close();
      }
      return created.workItem.id as string;
    }

    // Default: reset — an operator unwedge is durable, not one-shot.
    const resetId = admitFailedItem("reset", 6);
    const reset = runCli(dataDir, ["--json", "routes", "requeue", resetId, "--reason", "durable operator unwedge"]);
    expect(reset.status).toBe(0);
    const resetItem = JSON.parse(reset.stdout);
    expect(resetItem.status).toBe("queued");
    expect(resetItem.attempts).toBe(0);

    // --keep-attempts: the cautious path preserves the count.
    const keepId = admitFailedItem("keep", 6);
    const keep = runCli(dataDir, ["--json", "routes", "requeue", keepId, "--reason", "cautious", "--keep-attempts"]);
    expect(keep.status).toBe(0);
    const keepItem = JSON.parse(keep.stdout);
    expect(keepItem.status).toBe("queued");
    expect(keepItem.attempts).toBe(6);
  });

  test("todos task event handler requeues succeeded work items with operator evidence", () => {
    const dataDir = freshDataDir("loops-cli-event-succeeded-requeue-");
    const event = {
      id: "evt-task-created-succeeded-requeue-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-succeeded-requeue",
        title: "Requeue after dependency is resolved",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='succeeded', last_reason='first route completed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-b" }),
    );
    expect(replay.status).toBe(0);
    const deduped = JSON.parse(replay.stdout);
    expect(deduped.deduped).toBe(true);
    expect(deduped.workItem.status).toBe("succeeded");
    expect(deduped.loop.id).toBe(created.loop.id);

    const refusedActive = runCli(dataDir, ["--json", "routes", "requeue", created.workItem.id]);
    expect(refusedActive.status).not.toBe(0);
    expect(refusedActive.stderr).toContain("--reason");

    // --keep-attempts preserves the attempt count so the requeue-evidence
    // reporting (previousAttempts/attempt) below is exercised; the default now
    // resets attempts (covered by the dedicated reset test).
    const requeue = runCli(dataDir, [
      "--json",
      "routes",
      "requeue",
      created.workItem.id,
      "--reason",
      "dependency resolved",
      "--keep-attempts",
    ]);
    expect(requeue.status).toBe(0);
    const requeued = JSON.parse(requeue.stdout);
    expect(requeued.id).toBe(created.workItem.id);
    expect(requeued.status).toBe("queued");
    expect(requeued.lastReason).toBeUndefined();
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toBe("dependency resolved");

    const store = new Store(join(dataDir, "loops.db"));
    try {
      const activeInvocation = store.createWorkflowInvocation({
        sourceRef: { kind: "event", id: "evt-active-route", dedupeKey: "todos-task:active-route" },
        subjectRef: { kind: "task", id: "active-route", path: "/tmp/open-todos" },
        intent: "route",
        scope: { projectPath: "/tmp/open-todos" },
      });
      const activeItem = store.upsertWorkflowWorkItem({
        routeKey: "todos-task",
        idempotencyKey: "todos-task:active-route",
        invocationId: activeInvocation.id,
        sourceType: "task.created",
        sourceRef: "evt-active-route",
        subjectRef: "active-route",
        projectKey: "/tmp/open-todos",
      });
      const activeWorkflow = store.createWorkflow({
        name: "active-route-workflow",
        steps: [{ id: "worker", target: { type: "command", command: "true" } }],
      });
      const activeLoop = store.createLoop({
        name: "active-route-loop",
        schedule: { type: "once", at: futureAt() },
        target: { type: "workflow", workflowId: activeWorkflow.id },
      });
      store.admitWorkflowWorkItem(activeItem.id, {
        workflowId: activeWorkflow.id,
        loopId: activeLoop.id,
        reason: "active capacity seed",
      });
    } finally {
      store.close();
    }

    const throttledReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task", "--max-active-per-project", "1"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-throttled" }),
    );
    expect(throttledReplay.status).toBe(0);
    const throttled = JSON.parse(throttledReplay.stdout);
    expect(throttled.queuedAtSource).toBe(true);
    expect(throttled.workItem.id).toBe(created.workItem.id);
    expect(throttled.workItem.status).toBe("deferred");
    expect(throttled.workItem.lastReason).toBeUndefined();
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toContain("dependency resolved");

    const throttleDb = new Database(join(dataDir, "loops.db"));
    try {
      throttleDb.query("UPDATE workflow_work_items SET status='succeeded' WHERE id <> ?").run(created.workItem.id);
    } finally {
      throttleDb.close();
    }

    const afterRequeueReplay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-succeeded-requeue-c" }),
    );
    expect(afterRequeueReplay.status).toBe(0);
    const recreated = JSON.parse(afterRequeueReplay.stdout);
    expect(recreated.deduped).toBe(false);
    expect(recreated.workItem.id).toBe(created.workItem.id);
    expect(recreated.workItem.attempts).toBe(created.workItem.attempts + 1);
    expect(recreated.workItem.lastReason).toBeUndefined();
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toContain("dependency resolved");
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toContain("admitted by todos-task route");
    expect(recreated.loop.id).not.toBe(created.loop.id);
    expect(recreated.workflow.id).not.toBe(created.workflow.id);
    expect(recreated.requeue).toMatchObject({
      previousWorkItemId: created.workItem.id,
      previousAttempts: created.workItem.attempts,
      attempt: created.workItem.attempts + 1,
      newWorkflowId: recreated.workflow.id,
      newLoopId: recreated.loop.id,
    });
    expect(recreated.requeue.reason).toContain("dependency resolved");
  });

  test("todos task event handler dedupes cancelled routed work items instead of crashing", () => {
    const dataDir = freshDataDir("loops-cli-event-cancelled-dedupe-");
    const event = {
      id: "evt-task-created-cancelled-dedupe-a",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-cancelled-dedupe",
        title: "Do not crash on cancelled task route history",
        working_dir: "/tmp/open-todos",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const first = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);

    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='cancelled', last_reason='loop deleted' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    const replay = runCli(
      dataDir,
      ["--json", "events", "handle", "todos-task"],
      JSON.stringify({ ...event, id: "evt-task-created-cancelled-dedupe-b" }),
    );

    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(true);
    expect(value.dedupedBy).toBe("work-item");
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.status).toBe("cancelled");
    expect(value.loop.id).toBe(created.loop.id);
  });

  test("todos task event handler uses metadata project path when task data has no cwd", () => {
    const dataDir = freshDataDir("loops-cli-event-metadata-cwd-");
    const event = {
      id: "evt-task-created-metadata",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-metadata",
        title: "Route from metadata",
      },
      metadata: {
        project_path: "/tmp/from-metadata",
        project_kind: "open-source",
        route_enabled: true,
      },
      timestamp: new Date().toISOString(),
    };
    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "todos-task",
        "--provider",
        "codewith",
        "--auth-profile",
        "account005",
        "--worker-auth-profile",
        "account004",
        "--verifier-auth-profile",
        "account006",
        "--sandbox",
        "workspace-write",
        "--permission-mode",
        "bypass",
      ],
      JSON.stringify(event),
    );

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.deduped).toBe(false);
    for (const step of value.workflow.steps) {
      expect(step.target.cwd).toBeUndefined();
      expect(step.target.authProfile).toBeUndefined();
      expect(step.target.operationTemplateId).toBeDefined();
    }
    const privateWorkflow = storedWorkflow(dataDir, value.workflow.id);
    expect(privateWorkflow?.steps[0]?.target).toMatchObject({ cwd: "/tmp/from-metadata" });
    expect(privateWorkflow?.steps[1]?.target).toMatchObject({ cwd: "/tmp/from-metadata", authProfile: "account004" });
    expect(privateWorkflow?.steps[2]?.target).toMatchObject({ cwd: "/tmp/from-metadata", authProfile: "account006" });
  });

  test("todos task event handler does not let metadata override task cwd", () => {
    const dataDir = freshDataDir("loops-cli-event-data-cwd-");
    const event = {
      id: "evt-task-created-data-cwd",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-data-cwd",
        title: "Route from data cwd",
        working_dir: "/tmp/from-data",
        tags: ["auto:route"],
      },
      metadata: {
        project_path: "/tmp/from-metadata",
      },
      timestamp: new Date().toISOString(),
    };
    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    for (const step of value.workflow.steps) {
      expect(step.target.cwd).toBeUndefined();
      expect(step.target.operationTemplateId).toBeDefined();
    }
    const privateWorkflow = storedWorkflow(dataDir, value.workflow.id);
    expect(privateWorkflow?.steps[0]?.target).toMatchObject({ cwd: "/tmp/from-data" });
    expect(privateWorkflow?.steps[1]?.target).toMatchObject({ cwd: "/tmp/from-data" });
    expect(privateWorkflow?.steps[2]?.target).toMatchObject({ cwd: "/tmp/from-data" });
  });

  test("todos task event handler skips tasks without explicit route opt-in", () => {
    const dataDir = freshDataDir("loops-cli-event-no-route-");
    const event = {
      id: "evt-task-created-no-route",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-no-route",
        title: "Do not route implicitly",
        working_dir: "/tmp/open-todos",
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("missing explicit route opt-in");
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("todos task event handler ignores bare allowed=true without documented route opt-in", () => {
    const dataDir = freshDataDir("loops-cli-event-bare-allowed-");
    const event = {
      id: "evt-task-created-bare-allowed",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-bare-allowed",
        title: "Bare allowed should not route",
        working_dir: "/tmp/open-todos",
        allowed: true,
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    expect(value.reason).toContain("missing explicit route opt-in");
  });

  test.each([
    ["approval-required", { data: { requires_approval: true, tags: ["auto:route"] } }],
    ["manual-required", { metadata: { automation: { allowed: true, manual_required: true } } }],
    ["nested-data-automation-manual-required", { data: { automation: { allowed: true, manual_required: true } } }],
    ["nested-data-task-metadata-automation-manual-required", { data: { task: { metadata: { automation: { allowed: true, manual_required: true } } } } }],
    ["nested-payload-task-metadata-automation-manual-required", { data: { payload: { task: { metadata: { automation: { allowed: true, manual_required: true } } } } } }],
    ["no-auto", { data: { tags: ["auto:route", "no-auto"] } }],
    ["blocked-tag", { data: { tags: ["auto:route", "blocked"] } }],
    ["completed", { data: { status: "completed", tags: ["auto:route"] } }],
    ["blocked", { data: { status: "blocked", tags: ["auto:route"] } }],
  ])("todos task event handler skips %s tasks", (_, overrides) => {
    const dataDir = freshDataDir("loops-cli-event-ineligible-");
    const event = {
      id: "evt-task-created-ineligible",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-created-ineligible",
        title: "Do not route ineligible task",
        working_dir: "/tmp/open-todos",
        ...(overrides as { data?: Record<string, unknown> }).data,
      },
      metadata: {
        ...(overrides as { metadata?: Record<string, unknown> }).metadata,
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, ["--json", "events", "handle", "todos-task"], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.skipped).toBe(true);
    const store = new Store(join(dataDir, "loops.db"));
    try {
      expect(store.listLoops({ includeArchived: true })).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("generic event handler creates a deduped one-shot workflow loop", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-handler-");
    const event = {
      id: "evt-knowledge-created-0001",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-1",
      message: "Knowledge record created",
      severity: "info",
      data: {
        id: "record-1",
        title: "Loop automation note",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };
    const args = [
      "--json",
      "events",
      "handle",
      "generic",
      "--provider",
      "codewith",
      "--auth-profile",
      "account005",
      "--auth-profile-pool",
      "account004,account005,account006",
      "--add-dir",
      "/tmp/knowledge-store,/tmp/loops-store",
      "--sandbox",
      "workspace-write",
      "--permission-mode",
      "bypass",
      "--allow-tool",
      "functions.exec_command,functions.view_image",
      "--allow-command",
      "git,bun",
      "--safety-reason",
      "bounded generic event repository access",
    ];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.workItem.status).toBe("admitted");
    expect(firstValue.workItem.routeKey).toBe("generic-event");
    expect(firstValue.invocation.sourceRef.kind).toBe("event");
    expect(firstValue.workflow.name).toContain("event:generic:knowledge:knowledge.record.created");
    for (const step of firstValue.workflow.steps) {
      expect(step.target.cwd).toBeUndefined();
      expect(step.target.addDirs).toBeUndefined();
      expect(step.target.allowlist).toBeUndefined();
      expect(step.target.authProfile).toBeUndefined();
      expect(step.target.operationTemplateId).toBeDefined();
    }
    const privateWorkflow = storedWorkflow(dataDir, firstValue.workflow.id);
    expect(privateWorkflow?.steps[0]?.target).toMatchObject({
      cwd: "/tmp/open-knowledge",
      addDirs: ["/tmp/knowledge-store", "/tmp/loops-store"],
    });
    expect(privateWorkflow?.steps[1]?.target).toMatchObject({
      addDirs: ["/tmp/knowledge-store", "/tmp/loops-store"],
    });
    for (const step of privateWorkflow?.steps ?? []) {
      expect(step.target).toMatchObject({
        allowlist: {
          enforcement: "metadata_only",
          tools: ["functions.exec_command", "functions.view_image"],
          commands: ["git", "bun"],
          safetyReason: "bounded generic event repository access",
        },
      });
    }
    expect(firstValue.loop.target.input).toBeUndefined();
    expect(storedLoop(dataDir, firstValue.loop.id)?.target).toMatchObject({
      input: {
        workflowInvocationId: firstValue.invocation.id,
        workflowWorkItemId: firstValue.workItem.id,
      },
    });
    const profiles = (privateWorkflow?.steps ?? []).map((step) =>
      step.target.type === "agent" ? step.target.authProfile : undefined,
    );
    expect(new Set(profiles).size).toBe(2);

    const second = runCli(dataDir, args, JSON.stringify(event));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.deduped).toBe(true);
    expect(secondValue.dedupedBy).toBe("work-item");
    expect(secondValue.workItem.id).toBe(firstValue.workItem.id);
    expect(secondValue.loop.id).toBe(firstValue.loop.id);
  });

  test("generic event handler applies provider routing rules", () => {
    const dataDir = freshDataDir("loops-cli-generic-provider-rule-");
    const repo = createGitRepo("loops-cli-generic-provider-rule-repo-");
    const event = {
      id: "evt-generic-provider-rule",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-provider-rule",
      data: {
        id: "record-provider-rule",
        area: "backend",
        project_path: repo,
      },
      metadata: {},
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "generic",
      "--dry-run",
      "--provider-rule",
      "area=backend:claude:claude-net-a,claude-net-b",
      "--account-tool",
      "claude",
      "--worktree-mode",
      "required",
      "--worktree-root",
      join(dataDir, "worktrees"),
    ], JSON.stringify(event));

    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.providerRouting).toMatchObject({
      provider: "claude",
      source: "rule",
    });
    expect(value.invocation.scope.providerRouting.provider).toBe("claude");
    expect(value.invocation.scope.accountPolicy).toBe("pool");
    const worker = value.workflow.steps.find((step: { id: string }) => step.id === "worker");
    const verifier = value.workflow.steps.find((step: { id: string }) => step.id === "verifier");
    expect(worker.target.provider).toBe("claude");
    expect(verifier.target.provider).toBe("claude");
    expect(worker.target.account.tool).toBe("claude");
    expect(verifier.target.account.tool).toBe("claude");
    expect(new Set([worker.target.account.profile, verifier.target.account.profile])).toEqual(new Set(["claude-net-a", "claude-net-b"]));
  });

  test("generic event handler returns requeue evidence after explicit route requeue", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-requeue-");
    const event = {
      id: "evt-generic-requeue-a",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-requeue",
      data: {
        id: "record-requeue",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };
    const args = ["--json", "events", "handle", "generic"];

    const first = runCli(dataDir, args, JSON.stringify(event));
    expect(first.status).toBe(0);
    const created = JSON.parse(first.stdout);
    const db = new Database(join(dataDir, "loops.db"));
    try {
      db.query("UPDATE workflow_work_items SET status='succeeded', last_reason='first generic route completed' WHERE id=?").run(created.workItem.id);
    } finally {
      db.close();
    }

    // --keep-attempts preserves the attempt count so the requeue-evidence
    // (previousAttempts/attempt) is reported; the default resets attempts.
    const requeue = runCli(dataDir, [
      "--json",
      "routes",
      "requeue",
      created.workItem.id,
      "--reason",
      "generic dependency resolved",
      "--keep-attempts",
    ]);
    expect(requeue.status).toBe(0);

    const replay = runCli(dataDir, args, JSON.stringify(event));
    expect(replay.status).toBe(0);
    const value = JSON.parse(replay.stdout);
    expect(value.deduped).toBe(false);
    expect(value.workItem.id).toBe(created.workItem.id);
    expect(value.workItem.lastReason).toBeUndefined();
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toContain("generic dependency resolved");
    expect(storedWorkItem(dataDir, created.workItem.id)?.lastReason).toContain("admitted by generic-event route");
    expect(value.loop.id).not.toBe(created.loop.id);
    expect(value.workflow.id).toBeDefined();
    expect(value.requeue).toMatchObject({
      previousWorkItemId: created.workItem.id,
      previousAttempts: created.workItem.attempts,
      attempt: created.workItem.attempts + 1,
      reason: "generic dependency resolved",
      newWorkflowId: value.workflow.id,
      newLoopId: value.loop.id,
    });
  });

  test("generic event dry-run rejects unsupported provider add dirs", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-invalid-adddirs-");
    const event = {
      id: "evt-generic-invalid-adddirs",
      type: "knowledge.record.created",
      source: "knowledge",
      subject: "record-invalid-adddirs",
      data: {
        id: "record-invalid-adddirs",
        project_path: "/tmp/open-knowledge",
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };

    const result = runCli(
      dataDir,
      [
        "--json",
        "events",
        "handle",
        "generic",
        "--provider",
        "cursor",
        "--add-dir",
        "/tmp/knowledge-store",
        "--dry-run",
      ],
      JSON.stringify(event),
    );

    expect(result.status).toBe(1);
    const value = JSON.parse(result.stdout);
    expect(value.created).toBe(false);
    expect(value.validation.error).toContain("addDirs is currently supported only for provider codewith or codex");
  });

  test("generic event handler throttles through admission work items", () => {
    const dataDir = freshDataDir("loops-cli-generic-event-throttle-");
    const repo = createGitRepo("loops-cli-generic-event-throttle-repo-");
    const baseEvent = {
      type: "knowledge.record.created",
      source: "knowledge",
      severity: "info",
      data: {
        project_path: repo,
      },
      time: new Date().toISOString(),
      schemaVersion: "1.0",
      metadata: {},
    };
    const args = [
      "--json",
      "events",
      "handle",
      "generic",
      "--provider",
      "codewith",
      "--auth-profile",
      "account005",
      "--max-active-per-project",
      "1",
    ];

    const first = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-generic-throttle-0001",
      subject: "record-1",
      message: "First record",
      data: { ...baseEvent.data, id: "record-1" },
    }));
    expect(first.status).toBe(0);
    const firstValue = JSON.parse(first.stdout);
    expect(firstValue.deduped).toBe(false);
    expect(firstValue.workItem.status).toBe("admitted");

    const second = runCli(dataDir, args, JSON.stringify({
      ...baseEvent,
      id: "evt-generic-throttle-0002",
      subject: "record-2",
      message: "Second record",
      data: { ...baseEvent.data, id: "record-2" },
    }));
    expect(second.status).toBe(0);
    const secondValue = JSON.parse(second.stdout);
    expect(secondValue.skipped).toBe(true);
    expect(secondValue.workItem.status).toBe("deferred");
    expect(secondValue.reason).toContain("project active workflow limit reached");
    expect(secondValue.throttle.counts.project).toBe(1);

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toHaveLength(1);
    const routes = JSON.parse(runCli(dataDir, ["--json", "routes", "list", "--route-key", "generic-event"]).stdout);
    expect(routes.map((item: { status: string }) => item.status).sort()).toEqual(["admitted", "deferred"]);
  });

  test("errors print structured JSON envelopes with stable codes", () => {
    const dataDir = freshDataDir("loops-cli-error-envelope-");

    const missing = runCli(dataDir, ["--json", "show", "no-such-loop"]);
    expect(missing.status).toBe(1);
    const value = JSON.parse(missing.stdout);
    expect(value.ok).toBe(false);
    expect(value.error.code).toBe("LOOP_NOT_FOUND");
    expect(value.error.message).toContain("loop not found: no-such-loop");
    expect(missing.stdout).not.toContain("    at ");
    expect(missing.stderr).toContain("loop not found: no-such-loop");

    const human = runCli(dataDir, ["show", "no-such-loop"]);
    expect(human.status).toBe(1);
    expect(human.stderr).toContain("loop not found: no-such-loop");
    expect(human.stderr).not.toContain("    at ");
  });

  test("runs rejects a run id with concise actionable stderr", () => {
    const dataDir = freshDataDir("loops-cli-runs-run-id-");
    const create = runCli(dataDir, ["create", "command", "run-id-target", "--at", futureAt(), "--cmd", "true"]);
    expect(create.status).toBe(0);

    const execute = runCli(dataDir, ["--json", "run-now", "run-id-target"]);
    expect(execute.status).toBe(0);
    const runId = JSON.parse(execute.stdout).id as string;

    const result = runCli(dataDir, ["runs", runId, "--limit", "1", "--show-output"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`error: loop not found: ${runId}`);
    expect(result.stderr).toContain("looks like a run id");
    expect(result.stderr).toContain("loops goal show");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).not.toMatch(/^\s*at /m);
    expect(result.stderr).not.toMatch(/(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)/);

    const suggested = runCli(dataDir, ["--json", "goal", "show", runId]);
    expect(suggested.status).toBe(0);
    const inspected = JSON.parse(suggested.stdout);
    expect(inspected.run.id).toBe(runId);
    expect(inspected.run.stdout).toBeUndefined();
  });

  test("goal status is merged into goal show", () => {
    const dataDir = freshDataDir("loops-cli-goal-status-merged-");
    const create = runCli(dataDir, [
      "--json",
      "create",
      "command",
      "goal-status-merged",
      "--at",
      futureAt(),
      "--cmd",
      "true",
      "--goal",
      "Keep the check green",
    ]);
    expect(create.status).toBe(0);

    const shown = runCli(dataDir, ["--json", "goal", "show", "goal-status-merged"]);
    expect(shown.status).toBe(0);
    expect(JSON.parse(shown.stdout).config.objective).toBe("Keep the check green");

    const status = runCli(dataDir, ["--json", "goal", "status", "goal-status-merged"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).config.objective).toBe("Keep the check green");

    const missing = runCli(dataDir, ["--json", "goal", "status", "missing-goal-run"]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).error.message).toContain("goal not found");
  });

  test("routes create --dry-run previews without storing anything", () => {
    const dataDir = freshDataDir("loops-cli-routes-create-dry-run-");
    const event = {
      id: "evt-routes-create-dry-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-routes-create-dry-0001",
        title: "Preview via routes create --dry-run",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const preview = runCli(dataDir, [
      "--json",
      "routes",
      "create",
      "todos-task",
      "--dry-run",
      "--event-json",
      JSON.stringify(event),
      "--sandbox",
      "workspace-write",
    ]);
    expect(preview.status).toBe(0);
    const value = JSON.parse(preview.stdout);
    expect(value.deduped).toBe(false);
    expect(value.loop.target.workflowId).toBe("<created-workflow-id>");
    expect(value.sandboxPreflight[0].method).toBe("provider-native-sandbox");

    const loops = JSON.parse(runCli(dataDir, ["--json", "list"]).stdout);
    expect(loops).toEqual([]);
    const items = JSON.parse(runCli(dataDir, ["--json", "routes", "list"]).stdout);
    expect(items).toEqual([]);
  });

  test("events handle todos-task accepts --pr-handoff for task-lifecycle routes", () => {
    const dataDir = freshDataDir("loops-cli-events-pr-handoff-");
    const event = {
      id: "evt-pr-handoff-flag-0001",
      type: "task.created",
      source: "@hasna/todos",
      data: {
        id: "task-pr-handoff-flag-0001",
        title: "Route with PR handoff",
        working_dir: "/tmp/open-loops",
        tags: ["auto:route"],
      },
      timestamp: new Date().toISOString(),
    };

    const result = runCli(dataDir, [
      "--json",
      "events",
      "handle",
      "todos-task",
      "--dry-run",
      "--template",
      "task-lifecycle",
      "--pr-handoff",
      "--sandbox",
      "workspace-write",
    ], JSON.stringify(event));
    expect(result.status).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.invocation.scope.prHandoff).toBe(true);
    expect(value.workflow.steps.some((step: { id: string }) => step.id === "pr-handoff")).toBe(true);
  });

  test("workflows create --template renders and stores a workflow template", () => {
    const dataDir = freshDataDir("loops-cli-workflows-create-template-");

    const created = runCli(dataDir, [
      "--json",
      "workflows",
      "create",
      "--template",
      "todos-task-worker-verifier",
      "--var",
      "taskId=task-create-template-1",
      "--var",
      "projectPath=/tmp/open-loops",
      "--var",
      "sandbox=workspace-write",
    ]);
    expect(created.status).toBe(0);
    const workflow = JSON.parse(created.stdout);
    expect(workflow.name).toContain("worker-verifier");
    expect(workflow.steps.length).toBeGreaterThan(0);

    const shown = runCli(dataDir, ["--json", "workflows", "show", workflow.id]);
    expect(shown.status).toBe(0);

    const conflicting = runCli(dataDir, ["--json", "workflows", "create", "somefile.json", "--template", "todos-task-worker-verifier"]);
    expect(conflicting.status).toBe(1);
    expect(conflicting.stderr).toContain("not both");

    const neither = runCli(dataDir, ["--json", "workflows", "create"]);
    expect(neither.status).toBe(1);
    expect(neither.stderr).toContain("requires a workflow JSON file or --template");
  });

  test("gc prunes run history, backups, and stray temp files with dry-run default", () => {
    const dataDir = freshDataDir("loops-cli-gc-");
    expect(runCli(dataDir, ["create", "command", "gc-target", "--at", futureAt(), "--cmd", "true"]).status).toBe(0);
    expect(runCli(dataDir, ["run-now", "gc-target"]).status).toBe(0);

    const backupsDir = join(dataDir, "backups");
    mkdirSync(backupsDir, { recursive: true });
    const backupNames = [1, 2, 3, 4, 5].map((n) => `loops-rename-2020-01-0${n}T00-00-00-000Z.db`);
    backupNames.forEach((name, index) => {
      const path = join(backupsDir, name);
      writeFileSync(path, "backup");
      const mtime = new Date(Date.UTC(2020, 0, index + 1));
      utimesSync(path, mtime, mtime);
    });
    writeFileSync(join(dataDir, "leftover.tmp"), "stray");

    const dry = runCli(dataDir, ["--json", "gc", "--max-age-days", "0", "--keep-per-loop", "0"]);
    expect(dry.status).toBe(0);
    const dryValue = JSON.parse(dry.stdout);
    expect(dryValue.dryRun).toBe(true);
    expect(dryValue.history.dryRun).toBe(true);
    expect(dryValue.history.loopRuns).toBe(1);
    expect(dryValue.backups.pruned).toHaveLength(2);
    expect(dryValue.strayFiles).toEqual([join(dataDir, "leftover.tmp")]);
    expect(existsSync(join(dataDir, "leftover.tmp"))).toBe(true);
    expect(
      (JSON.parse(runCli(dataDir, ["--json", "runs", "gc-target"]).stdout) as { runs: unknown[] }).runs,
    ).toHaveLength(1);

    const both = runCli(dataDir, ["--json", "gc", "--dry-run", "--apply"]);
    expect(both.status).toBe(1);

    const apply = runCli(dataDir, ["--json", "gc", "--max-age-days", "0", "--keep-per-loop", "0", "--apply"]);
    expect(apply.status).toBe(0);
    const applyValue = JSON.parse(apply.stdout);
    expect(applyValue.dryRun).toBe(false);
    expect(applyValue.history.loopRuns).toBe(1);
    expect(applyValue.walCheckpoint.ran).toBe(true);
    expect(existsSync(join(dataDir, "leftover.tmp"))).toBe(false);
    const remaining = backupNames.filter((name) => existsSync(join(backupsDir, name)));
    expect(remaining).toEqual(backupNames.slice(2));
    expect((JSON.parse(runCli(dataDir, ["--json", "runs", "gc-target"]).stdout) as { runs: unknown[] }).runs).toEqual([]);
    expect(JSON.parse(runCli(dataDir, ["--json", "list"]).stdout)).toHaveLength(1);
  });
});

describe("local-only guards under a cloud-flipped client", () => {
  // With both API vars set the client resolves to the hosted /v1 transport, so
  // any command that can only act on this machine's local sqlite runtime must
  // fail loudly instead of silently reading/writing the on-box island (the
  // split-brain we forbid). No HTTP is issued: the guard fires before any call.
  const CLOUD_ENV = {
    HASNA_LOOPS_API_URL: "https://loops.example.test",
    HASNA_LOOPS_API_KEY: "do-not-print-this-key",
  } as const;
  const FLIP_MESSAGE = "not available while flipped to the hosted Loops API";

  test("route admission, drain, live UI, and tick fail loudly when flipped", () => {
    const dataDir = freshDataDir("loops-cli-cloud-guard-");
    for (const args of [
      ["routes", "create", "todos-task"],
      ["routes", "drain", "todos-task"],
      ["events", "handle", "todos-task"],
      ["events", "drain", "todos-task"],
      ["ui"],
      ["tick"],
    ]) {
      const result = runCli(dataDir, args, undefined, CLOUD_ENV);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(FLIP_MESSAGE);
      // The bearer key must never leak into output while the guard rejects.
      expect(result.stdout).not.toContain("do-not-print-this-key");
      expect(result.stderr).not.toContain("do-not-print-this-key");
    }
  });

  test("run-now routes to the hosted API when flipped instead of refusing as local-only (1fb09589)", () => {
    // run-now is connection-aware: flipped to the hosted API it schedules the
    // loop through the control plane, never the local sqlite island. Against an
    // unreachable control plane it fails closed with a hosted-route error — NOT
    // the local-only refusal — and never leaks the bearer key.
    const dataDir = freshDataDir("loops-cli-cloud-run-now-");
    const result = runCli(dataDir, ["--json", "run-now", "anything"], undefined, CLOUD_ENV);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain(FLIP_MESSAGE);
    expect(result.stdout).not.toContain("do-not-print-this-key");
    expect(result.stderr).not.toContain("do-not-print-this-key");
  });

  test("route preview (dry-run) is store-free, so it is NOT blocked when flipped", () => {
    const dataDir = freshDataDir("loops-cli-cloud-guard-preview-");
    // Preview never opens the Store, so the local-only guard must not fire; it may
    // still fail for missing event input, but not with the flip message.
    const result = runCli(dataDir, ["routes", "preview", "todos-task"], undefined, CLOUD_ENV);
    expect(result.stderr).not.toContain(FLIP_MESSAGE);
  });
});

describe("command-target integrity surface (loops bbe50c53)", () => {
  test("create+show of a shell command loop never reveals credential values and exposes a verifiable digest", () => {
    const dataDir = freshDataDir("loops-cli-command-target-integrity-");
    // Synthetic fixture value, split so the joined shape never appears as a
    // literal in the staged diff (same convention as format.test.ts).
    const secret = ["sk", "-ant-fake000000000000000000"].join("");
    const cmd = `bash /private/worktree/deploy.sh --token ${secret} --env prod`;
    const created = runCli(dataDir, ["--json", "create", "command", "integrity-shell", "--cmd", cmd, "--every", "1h"]);
    expect(created.status).toBe(0);
    const loop = JSON.parse(created.stdout);
    const shown = runCli(dataDir, ["--json", "show", loop.id]);
    expect(shown.status).toBe(0);
    const stdout = shown.stdout;
    // The secret-bearing fixture must not reveal credential values on ANY
    // part of the operator surface (target, description, or elsewhere).
    expect(stdout).not.toContain(secret);
    expect(stdout).not.toContain("sk" + "-ant-");
    const value = JSON.parse(stdout);
    // The literal 'shell' must not pass as integrity evidence.
    expect(value.target.command).not.toBe("shell");
    expect(value.target.command).toContain("[SCRUBBED]");
    // The digest binds the exact stored command line the executor will run.
    expect(value.target.commandDigest).toMatch(/^cmd:sha256:[a-f0-9]{64}$/);
    const expected = `cmd:sha256:${createHash("sha256").update(cmd).digest("hex")}`;
    expect(value.target.commandDigest).toBe(expected);
    expect(value.target.commandResolvedFrom).toBe("stored-target");
    expect(value.description).not.toContain(secret);
    expect(value.description).toContain("[SCRUBBED]");
  });

  test("one-byte mutation of the stored command changes the digest on the CLI surface", () => {
    const dataDir = freshDataDir("loops-cli-command-target-mutation-");
    const created = runCli(dataDir, ["--json", "create", "command", "mutate-shell", "--cmd", "bash deploy.sh", "--every", "1h"]);
    expect(created.status).toBe(0);
    const loop = JSON.parse(created.stdout);
    const shown = runCli(dataDir, ["--json", "show", loop.id]);
    expect(shown.status).toBe(0);
    const value = JSON.parse(shown.stdout);
    expect(value.target.commandDigest).toMatch(/^cmd:sha256:[a-f0-9]{64}$/);
    expect(value.target.commandDigest).not.toBe(
      `cmd:sha256:${createHash("sha256").update("bash deploy.sH").digest("hex")}`,
    );
  });
});
