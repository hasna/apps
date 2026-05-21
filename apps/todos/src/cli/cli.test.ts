import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";

async function runCli(args: string[], dbPath: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: { ...process.env, ...extraEnv, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("CLI integration", () => {
  it("should print versions for standalone companion binaries without starting services", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const expectedVersion = JSON.parse(readFileSync(join(import.meta.dir, "../..", "package.json"), "utf-8")).version;

    for (const entrypoint of ["src/mcp/index.ts", "src/server/index.ts"]) {
      for (const flag of ["--version", "-V"]) {
        const proc = Bun.spawn(["bun", "run", entrypoint, flag], {
          cwd: import.meta.dir + "/../..",
          env: { ...process.env, TODOS_DB_PATH: ":memory:", TODOS_AUTO_PROJECT: "false", TODOS_NO_OPEN: "true" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        expect(exitCode).toBe(0);
        expect(stdout.trim()).toBe(expectedVersion);
        expect(stderr).not.toContain("Todos Dashboard running");
        expect(stderr).not.toContain("MCP server error");
      }
    }
  });

  it("should run add command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "add", "CLI test task", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-todos.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const task = JSON.parse(stdout);
    expect(task.title).toBe("CLI test task");
    expect(task.status).toBe("pending");

    // Cleanup
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-todos.db"); } catch {}
  });

  it("should run list command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "list", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-list.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Should output valid JSON (empty array or tasks)
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-list.db"); } catch {}
  });

  it("should run search command", async () => {
    // First add a task, then search for it
    const addProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "add", "searchable item", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-search.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await addProc.exited;

    const searchProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "search", "searchable", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-search.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(searchProc.stdout).text();
    await searchProc.exited;

    const results = JSON.parse(stdout);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe("searchable item");

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-search.db"); } catch {}
  });

  it("should save and run local search views from the CLI", async () => {
    const dbPath = "/tmp/test-cli-views.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    try {
      const task = JSON.parse((await runCli(["add", "saved view cli task", "--tag", "views", "--json"], dbPath)).stdout);
      const saved = await runCli([
        "views",
        "save",
        "cli-views",
        "--query",
        "saved",
        "--tag",
        "views",
        "--all-projects",
        "--json",
      ], dbPath);
      expect(saved.exitCode).toBe(0);
      expect(JSON.parse(saved.stdout).name).toBe("cli-views");

      const listed = JSON.parse((await runCli(["views", "list", "--json"], dbPath)).stdout);
      expect(listed.map((view: { name: string }) => view.name)).toContain("cli-views");

      const run = JSON.parse((await runCli(["views", "run", "cli-views", "--json"], dbPath)).stdout);
      expect(run.count).toBe(1);
      expect(run.results[0].entity_type).toBe("tasks");
      expect(run.results[0].entity.id).toBe(task.id);

      const removed = JSON.parse((await runCli(["views", "delete", "cli-views", "--json"], dbPath)).stdout);
      expect(removed.deleted).toBe(true);
    } finally {
      try { unlinkSync(dbPath); } catch {}
    }
  });

  it("should manage local task fields from the CLI", async () => {
    const dbPath = "/tmp/test-cli-fields.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    try {
      const createdResult = await runCli(["add", "fielded task", "--json"], dbPath);
      expect(createdResult.exitCode).toBe(0);
      const created = JSON.parse(createdResult.stdout);

      const setResult = await runCli([
        "fields",
        "set",
        created.id,
        "--labels",
        "bug,cli",
        "--priority",
        "high",
        "--severity",
        "s1",
        "--owner",
        "codex",
        "--area",
        "parser",
        "--field",
        "component=parser",
        "--json",
      ], dbPath);
      expect(setResult.stderr).toBe("");
      expect(setResult.exitCode).toBe(0);
      const updated = JSON.parse(setResult.stdout);
      expect(updated.task.priority).toBe("high");
      expect(updated.fields.labels).toEqual(["bug", "cli"]);
      expect(updated.fields.custom.component).toBe("parser");

      const queryResult = await runCli([
        "fields",
        "query",
        "--labels",
        "bug",
        "--severity",
        "s1",
        "--field",
        "component=parser",
        "--json",
      ], dbPath);
      expect(queryResult.exitCode).toBe(0);
      const query = JSON.parse(queryResult.stdout);
      expect(query.count).toBe(1);
      expect(query.tasks[0].id).toBe(created.id);
    } finally {
      try { unlinkSync(dbPath); } catch {}
    }
  });

  it("should scan and merge duplicate tasks from the CLI", async () => {
    const dbPath = "/tmp/test-cli-dedupe.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    try {
      const firstResult = await runCli(["add", "Duplicate parser crash", "--json"], dbPath);
      const secondResult = await runCli(["add", "Duplicate parser crash", "--json"], dbPath);
      expect(firstResult.exitCode).toBe(0);
      expect(secondResult.exitCode).toBe(0);
      const first = JSON.parse(firstResult.stdout);
      const second = JSON.parse(secondResult.stdout);

      const scanResult = await runCli(["dedupe", "scan", "--json"], dbPath);
      expect(scanResult.stderr).toBe("");
      expect(scanResult.exitCode).toBe(0);
      const scan = JSON.parse(scanResult.stdout);
      expect(scan.count).toBeGreaterThanOrEqual(1);
      expect(scan.candidates[0].reasons).toContain("exact normalized title match");

      const mergeResult = await runCli([
        "dedupe",
        "merge",
        first.id,
        second.id,
        "--agent",
        "codex",
        "--reason",
        "same title",
        "--json",
      ], dbPath);
      expect(mergeResult.stderr).toBe("");
      expect(mergeResult.exitCode).toBe(0);
      const merge = JSON.parse(mergeResult.stdout);
      expect(merge.primary_task.id).toBe(first.id);
      expect(merge.archived_duplicate.status).toBe("cancelled");
      expect(merge.archived_duplicate.metadata.merged_into).toBe(first.id);
    } finally {
      try { unlinkSync(dbPath); } catch {}
    }
  });

  it("should bootstrap a local project from CLI JSON output", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-cli-bootstrap-"));
    const dbPath = join(root, "todos.db");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "@hasna/cli-bootstrap" }, null, 2)}\n`);

    try {
      const { stdout, stderr, exitCode } = await runCli(["project-bootstrap", root, "--json"], dbPath);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout);
      expect(result.discovery.projectName).toBe("cli-bootstrap");
      expect(result.project.name).toBe("cli-bootstrap");
      expect(result.taskList.slug).toBe("todos-cli-bootstrap");
      expect(result.created.project).toBe(true);
    } finally {
      try { unlinkSync(dbPath); } catch {}
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should run week command", async () => {
    // Add a task so there's activity
    const addProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "add", "weekly test task", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-week.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await addProc.exited;

    const weekProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "week", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-week.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(weekProc.stdout).text();
    await weekProc.exited;

    const result = JSON.parse(stdout);
    expect(result.from).toBeDefined();
    expect(result.to).toBeDefined();
    expect(result.days).toBeDefined();

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-week.db"); } catch {}
  });

  it("should run mine command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "mine", "test-agent", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-mine.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-mine.db"); } catch {}
  });

  it("should run blocked command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "blocked", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-blocked.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-blocked.db"); } catch {}
  });

  it("should run burndown command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "burndown", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-burndown.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(7);
    expect(result[0].date).toBeDefined();
    expect(result[0].completed).toBeDefined();

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-burndown.db"); } catch {}
  });

  it("should run log command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "log", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-log.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-log.db"); } catch {}
  });

  it("should run ready command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "ready", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-ready.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-ready.db"); } catch {}
  });

  it("should expose a dependency graph through deps --graph --json", async () => {
    const dbPath = "/tmp/test-cli-deps-graph.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const taskA = JSON.parse((await runCli(["add", "Task A", "--json"], dbPath)).stdout);
    const taskB = JSON.parse((await runCli(["add", "Task B", "--json"], dbPath)).stdout);
    const taskC = JSON.parse((await runCli(["add", "Task C", "--json"], dbPath)).stdout);

    expect((await runCli(["deps", taskA.id, "--needs", taskB.id], dbPath)).exitCode).toBe(0);
    expect((await runCli(["deps", taskB.id, "--needs", taskC.id], dbPath)).exitCode).toBe(0);

    const graphResult = await runCli(["deps", taskA.id, "--graph", "--json"], dbPath);
    expect(graphResult.exitCode).toBe(0);
    const graph = JSON.parse(graphResult.stdout);
    expect(graph.task.id).toBe(taskA.id);
    expect(graph.task.is_blocked).toBe(true);
    expect(graph.depends_on[0].task.id).toBe(taskB.id);
    expect(graph.depends_on[0].depends_on[0].task.id).toBe(taskC.id);

    try { unlinkSync(dbPath); } catch {}
  });

  it("should link and query local git traceability evidence", async () => {
    const dbPath = "/tmp/test-cli-git-traceability.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}

    const task = JSON.parse((await runCli(["add", "Traceable task", "--json"], dbPath)).stdout);
    const commit = await runCli([
      "link-commit",
      task.id,
      "abcdef1234567890",
      "--message",
      "Implement traceability",
      "--files",
      "src/db/task-commits.ts,src/cli/cli.test.ts",
      "--json",
    ], dbPath);
    expect(commit.exitCode).toBe(0);

    const ref = await runCli([
      "link-ref",
      task.id,
      "task/local-git-pr-traceability",
      "--type",
      "branch",
      "--url",
      "https://github.com/hasna/todos/tree/task/local-git-pr-traceability",
      "--json",
    ], dbPath);
    expect(ref.exitCode).toBe(0);

    const verification = await runCli([
      "record-verification",
      task.id,
      "bun test src/db/task-commits.test.ts",
      "--status",
      "passed",
      "--summary",
      "task commit tests passed",
      "--json",
    ], dbPath);
    expect(verification.exitCode).toBe(0);

    const traceResult = await runCli(["trace", task.id, "--json"], dbPath);
    expect(traceResult.exitCode).toBe(0);
    const trace = JSON.parse(traceResult.stdout);
    expect(trace.commits[0].sha).toBe("abcdef1234567890");
    expect(trace.commits[0].files_changed).toContain("src/db/task-commits.ts");
    expect(trace.git_refs[0].name).toBe("task/local-git-pr-traceability");
    expect(trace.verifications[0].status).toBe("passed");

    const commitLookup = JSON.parse((await runCli(["find-commit", "abcdef12", "--json"], dbPath)).stdout);
    expect(commitLookup.task_id).toBe(task.id);

    const refLookup = JSON.parse((await runCli(["find-ref", "local-git-pr", "--json"], dbPath)).stdout);
    expect(refLookup[0].task_id).toBe(task.id);

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should create a local branch-safe work plan from the CLI", async () => {
    const dbPath = "/tmp/test-cli-branch-plan.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}

    const task = JSON.parse((await runCli(["add", "Branch safe task", "--json"], dbPath)).stdout);
    const result = await runCli([
      "branch-plan",
      task.id,
      "--branch",
      "task/branch-safe-task",
      "--base",
      "main",
      "--path",
      "src/branch-safe.ts",
      "--root",
      "/tmp/not-a-git-repo",
      "--no-git-status",
      "--json",
    ], dbPath);

    expect(result.exitCode).toBe(0);
    const workPlan = JSON.parse(result.stdout);
    expect(workPlan.safe_to_start).toBe(true);
    expect(workPlan.files).toEqual(["src/branch-safe.ts"]);
    expect(workPlan.commands).toContain(`todos link-ref ${task.id.slice(0, 8)} task/branch-safe-task --type branch --provider git`);

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should manage and run local verification providers from the CLI", async () => {
    const dbPath = "/tmp/test-cli-verification-providers.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}

    try {
      const createdResult = await runCli(["add", "provider task", "--json"], dbPath);
      expect(createdResult.exitCode).toBe(0);
      const task = JSON.parse(createdResult.stdout);

      const setResult = await runCli([
        "verify-providers",
        "set",
        "local",
        "--kind",
        "command",
        "--command",
        "printf provider-ok-{task_id}",
        "--capabilities",
        "command,evidence",
        "--json",
      ], dbPath);
      expect(setResult.stderr).toBe("");
      expect(setResult.exitCode).toBe(0);
      expect(JSON.parse(setResult.stdout).name).toBe("local");

      const capsResult = await runCli(["verify-providers", "capabilities", "local", "--json"], dbPath);
      expect(capsResult.exitCode).toBe(0);
      expect(JSON.parse(capsResult.stdout).capabilities).toEqual(expect.arrayContaining(["command", "evidence"]));

      const runResult = await runCli(["verify-providers", "run", "local", "--task", task.id, "--agent", "codex", "--json"], dbPath);
      expect(runResult.stderr).toBe("");
      expect(runResult.exitCode).toBe(0);
      const result = JSON.parse(runResult.stdout);
      expect(result.status).toBe("passed");
      expect(result.output_summary).toContain("provider-ok");

      const trace = JSON.parse((await runCli(["trace", task.id, "--json"], dbPath)).stdout);
      expect(trace.verifications[0].command).toBe("provider:local");
      expect(trace.verifications[0].status).toBe("passed");
    } finally {
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(`${dbPath}-shm`); } catch {}
      try { unlinkSync(`${dbPath}-wal`); } catch {}
    }
  });

  it("should record a local run ledger with command, file, artifact, and finish evidence", async () => {
    const dbPath = "/tmp/test-cli-run-ledger.db";
    const { mkdtempSync, rmSync, unlinkSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    const artifactDir = mkdtempSync(join(tmpdir(), "todos-cli-artifacts-"));
    process.env["HASNA_TODOS_ARTIFACTS_DIR"] = artifactDir;
    const logPath = join(artifactDir, "run-ledger.txt");
    writeFileSync(logPath, "run ledger tests passed\nbearer abcdefghijklmnopqrstuvwxyz\n");

    const task = JSON.parse((await runCli(["add", "Run ledger task", "--json"], dbPath)).stdout);
    const started = await runCli([
      "runs",
      "start",
      task.id,
      "--agent",
      "codex",
      "--title",
      "Local ledger",
      "--claim",
      "--json",
    ], dbPath);
    expect(started.exitCode).toBe(0);
    const run = JSON.parse(started.stdout);
    expect(run.status).toBe("running");

    expect((await runCli(["runs", "event", run.id, "comment", "Captured progress", "--agent", "codex", "--json"], dbPath)).exitCode).toBe(0);
    expect((await runCli([
      "runs",
      "command",
      run.id,
      "bun test src/db/task-runs.test.ts",
      "--status",
      "passed",
      "--exit-code",
      "0",
      "--summary",
      "run ledger tests passed",
      "--artifact",
      "logs/run-ledger.txt",
      "--json",
    ], dbPath)).exitCode).toBe(0);
    expect((await runCli(["runs", "file", run.id, "src/db/task-runs.ts", "--status", "modified", "--json"], dbPath)).exitCode).toBe(0);
    const artifactResult = await runCli(["runs", "artifact", run.id, logPath, "--type", "log", "--description", "Focused test output", "--require-file", "--retention-days", "7", "--json"], dbPath);
    expect(artifactResult.exitCode).toBe(0);
    const artifact = JSON.parse(artifactResult.stdout);
    expect(artifact.metadata.artifact_store.stored).toBe(true);
    expect(artifact.metadata.artifact_store.redaction.status).toBe("redacted");
    const verifyResult = await runCli(["runs", "artifact-verify", run.id, "--json"], dbPath);
    expect(verifyResult.exitCode).toBe(0);
    expect(JSON.parse(verifyResult.stdout)[0].status).toBe("ok");
    expect((await runCli(["runs", "finish", run.id, "--status", "completed", "--summary", "done", "--json"], dbPath)).exitCode).toBe(0);

    const ledgerResult = await runCli(["runs", "show", run.id, "--json"], dbPath);
    expect(ledgerResult.exitCode).toBe(0);
    const ledger = JSON.parse(ledgerResult.stdout);
    expect(ledger.run.status).toBe("completed");
    expect(ledger.commands[0].status).toBe("passed");
    expect(ledger.files[0].path).toBe("src/db/task-runs.ts");
    expect(ledger.artifacts[0].path).toBe(logPath);
    expect(ledger.events.map((event: { event_type: string }) => event.event_type)).toContain("comment");

    delete process.env["HASNA_TODOS_ARTIFACTS_DIR"];
    rmSync(artifactDir, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should simulate an agent replay fixture from the CLI without a project database", async () => {
    const dbPath = "/tmp/test-cli-replay-simulator.db";
    const { mkdtempSync, rmSync, unlinkSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    const dir = mkdtempSync(join(tmpdir(), "todos-cli-replay-"));
    const fixturePath = join(dir, "fixture.json");
    writeFileSync(fixturePath, JSON.stringify({
      task: { id: "task-1", title: "Replay CLI", status: "pending" },
      runs: {
        items: [{
          status: "completed",
          events: [{ event_type: "started", message: "start" }, { event_type: "completed", message: "done" }],
          commands: [{ command: "bun test", status: "passed", output_summary: "ok" }],
        }],
      },
      approvals: [{ gate: "release", status: "approved" }],
    }));

    const json = await runCli(["runs", "simulate", fixturePath, "--agent", "codex", "--json"], dbPath);
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(0);
    const simulation = JSON.parse(json.stdout);
    expect(simulation.mutates_database).toBe(false);
    expect(simulation.task.final_status).toBe("completed");
    expect(simulation.commands.passed).toBe(1);
    expect(simulation.approvals.approved).toBe(1);

    const markdown = await runCli(["runs", "simulate", fixturePath, "--format", "markdown"], dbPath);
    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("# Agent Replay Simulation: Replay CLI");

    rmSync(dir, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should capture local inbox intake and dedupe repeated failures", async () => {
    const dbPath = "/tmp/test-cli-inbox-intake.db";
    const { unlinkSync, writeFileSync } = await import("node:fs");
    const filePath = "/tmp/test-cli-inbox-intake.log";
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    try { unlinkSync(filePath); } catch {}

    writeFileSync(filePath, "bun test failed\nTypeError: broken\nbearer abcdefghijklmnopqrstuvwxyz");
    const created = await runCli(["inbox", "add", "--file", filePath, "--source-type", "ci_log", "--json"], dbPath);
    expect(created.exitCode).toBe(0);
    const first = JSON.parse(created.stdout);
    expect(first.item.source_type).toBe("ci_log");
    expect(first.item.body).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(first.task.tags).toContain("ci_log");

    const duplicate = JSON.parse((await runCli(["inbox", "add", "--file", filePath, "--source-type", "ci_log", "--json"], dbPath)).stdout);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.item.id).toBe(first.item.id);

    const github = JSON.parse((await runCli([
      "inbox",
      "add",
      "https://github.com/hasna/todos/issues/42",
      "--source-url",
      "https://github.com/hasna/todos/issues/42",
      "--json",
    ], dbPath)).stdout);
    expect(github.item.source_type).toBe("github_issue");
    expect(github.item.title).toBe("GitHub issue hasna/todos#42");

    const items = JSON.parse((await runCli(["inbox", "list", "--json"], dbPath)).stdout);
    expect(items).toHaveLength(2);

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    try { unlinkSync(filePath); } catch {}
  });

  it("should preview and apply local natural-language inbox intake from the CLI", async () => {
    const dbPath = "/tmp/test-cli-natural-intake.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}

    const preview = await runCli([
      "inbox",
      "parse",
      "Add task fix parser priority high @codex #cli due tomorrow",
      "--reference-date",
      "2026-01-02T12:00:00.000Z",
      "--json",
    ], dbPath);
    expect(preview.exitCode).toBe(0);
    const parsed = JSON.parse(preview.stdout);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.tasks[0].title).toBe("fix parser");
    expect(parsed.tasks[0].due_at).toBe("2026-01-03T12:00:00.000Z");

    const applied = await runCli([
      "inbox",
      "parse",
      "Add task build intake preview priority critical #intake",
      "--apply",
      "--json",
    ], dbPath);
    expect(applied.exitCode).toBe(0);
    const appliedPayload = JSON.parse(applied.stdout);
    expect(appliedPayload.dry_run).toBe(false);
    expect(appliedPayload.created_tasks[0].title).toBe("build intake preview");

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should export and import a local bridge bundle through the CLI", async () => {
    const sourceDb = "/tmp/test-cli-bridge-source.db";
    const targetDb = "/tmp/test-cli-bridge-target.db";
    const bundlePath = "/tmp/test-cli-bridge-bundle.json";
    const { unlinkSync } = await import("node:fs");
    for (const path of [sourceDb, targetDb, bundlePath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }

    const task = JSON.parse((await runCli(["add", "Bridge portable task", "--tag", "bridge", "--json"], sourceDb)).stdout);
    const exported = await runCli(["export", "--format", "bridge", "--output", bundlePath], sourceDb);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain("Bridge export written");

    const preview = await runCli(["bridge-import", bundlePath, "--json"], targetDb);
    expect(preview.exitCode).toBe(0);
    const previewResult = JSON.parse(preview.stdout);
    expect(previewResult.dry_run).toBe(true);
    expect(previewResult.inserted.tasks).toBe(1);
    expect(JSON.parse((await runCli(["list", "--json"], targetDb)).stdout)).toHaveLength(0);

    const applied = await runCli(["bridge-import", bundlePath, "--apply", "--json"], targetDb);
    expect(applied.exitCode).toBe(0);
    const importResult = JSON.parse(applied.stdout);
    expect(importResult.dry_run).toBe(false);
    expect(importResult.inserted.tasks).toBe(1);
    const tasks = JSON.parse((await runCli(["list", "--json"], targetDb)).stdout);
    expect(tasks[0].id).toBe(task.id);
    expect(tasks[0].title).toBe("Bridge portable task");

    expect((await runCli(["update", task.id, "--title", "Local title", "--tags", "local"], targetDb)).exitCode).toBe(0);
    expect((await runCli(["update", task.id, "--description", "incoming description", "--tags", "bridge,incoming"], sourceDb)).exitCode).toBe(0);
    expect((await runCli(["export", "--format", "bridge", "--output", bundlePath], sourceDb)).exitCode).toBe(0);
    const merged = await runCli(["bridge-import", bundlePath, "--apply", "--resolve-conflicts", "--json"], targetDb);
    expect(merged.exitCode).toBe(0);
    const mergedResult = JSON.parse(merged.stdout);
    expect(mergedResult.merged.tasks).toBe(1);
    expect(mergedResult.conflicts).toContainEqual(expect.objectContaining({
      table: "tasks",
      id: task.id,
      reason: "diverged",
      fields: expect.arrayContaining(["title"]),
    }));
    const mergedTasks = JSON.parse((await runCli(["list", "--json"], targetDb)).stdout);
    expect(mergedTasks[0].title).toBe("Local title");
    expect(mergedTasks[0].description).toBe("incoming description");
    expect(mergedTasks[0].tags).toEqual(["local", "bridge", "incoming"]);

    for (const path of [sourceDb, targetDb, bundlePath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }
  });

  it("should export and import todos.md markdown through the CLI", async () => {
    const sourceDb = "/tmp/test-cli-todos-md-source.db";
    const targetDb = "/tmp/test-cli-todos-md-target.db";
    const markdownPath = "/tmp/test-cli-todos.md";
    const { unlinkSync } = await import("node:fs");
    for (const path of [sourceDb, targetDb, markdownPath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }

    const task = JSON.parse((await runCli(["add", "Markdown portable task", "--tag", "md", "--json"], sourceDb)).stdout);
    const exported = await runCli(["export", "--format", "todos.md", "--output", markdownPath], sourceDb);
    expect(exported.exitCode).toBe(0);
    const markdown = await Bun.file(markdownPath).text();
    expect(markdown).toContain("schema: hasna.todos.md/v1");
    expect(markdown).toContain("- [ ] Markdown portable task");
    expect(markdown).toContain("hasna.todos.bridge");

    const preview = await runCli(["todos-md-import", markdownPath, "--json"], targetDb);
    expect(preview.exitCode).toBe(0);
    const previewResult = JSON.parse(preview.stdout);
    expect(previewResult.mode).toBe("embedded_bridge");
    expect(previewResult.dry_run).toBe(true);
    expect(previewResult.inserted.tasks).toBe(1);

    const applied = await runCli(["todos-md-import", markdownPath, "--apply", "--json"], targetDb);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout).inserted.tasks).toBe(1);
    const tasks = JSON.parse((await runCli(["list", "--json"], targetDb)).stdout);
    expect(tasks[0].id).toBe(task.id);
    expect(tasks[0].title).toBe("Markdown portable task");

    for (const path of [sourceDb, targetDb, markdownPath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }
  });

  it("should encrypt and decrypt local bridge bundles through the CLI", async () => {
    const sourceDb = "/tmp/test-cli-bridge-encrypted-source.db";
    const targetDb = "/tmp/test-cli-bridge-encrypted-target.db";
    const bundlePath = "/tmp/test-cli-bridge-bundle.enc.json";
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-encryption-home-"));
    const env = {
      HOME: home,
      TODOS_TEST_ENCRYPTION_KEY: "local cli encryption key material",
    };
    for (const path of [sourceDb, targetDb, bundlePath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }

    await runCli(["encryption", "set", "secure", "--key-env", "TODOS_TEST_ENCRYPTION_KEY", "--json"], sourceDb, env);
    const task = JSON.parse((await runCli(["add", "Encrypted bridge task", "--json"], sourceDb, env)).stdout);
    const exported = await runCli(["export", "--format", "bridge", "--encrypt", "--encryption-profile", "secure", "--output", bundlePath], sourceDb, env);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain("Encrypted bridge export written");

    const encryptedText = await Bun.file(bundlePath).text();
    expect(encryptedText).toContain("hasna.todos.encrypted-bridge");
    expect(encryptedText).not.toContain("Encrypted bridge task");

    const locked = await runCli(["bridge-import", bundlePath, "--json"], targetDb, env);
    expect(locked.exitCode).not.toBe(0);
    expect(locked.stderr).toContain("Bridge bundle is encrypted");

    const applied = await runCli(["bridge-import", bundlePath, "--decrypt", "--apply", "--json"], targetDb, env);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout).inserted.tasks).toBe(1);
    const tasks = JSON.parse((await runCli(["list", "--json"], targetDb, env)).stdout);
    expect(tasks[0].id).toBe(task.id);
    expect(tasks[0].title).toBe("Encrypted bridge task");

    for (const path of [sourceDb, targetDb, bundlePath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }
    rmSync(home, { recursive: true, force: true });
  });

  it("should create all tasks and dependencies from a reusable plan template", async () => {
    const dbPath = "/tmp/test-cli-plan-template-use.db";
    const importPath = "/tmp/test-cli-plan-template-use.json";
    const { unlinkSync, writeFileSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    try { unlinkSync(importPath); } catch {}

    writeFileSync(importPath, JSON.stringify({
      name: "Local Release Plan",
      title_pattern: "Release {feature}",
      description: "Reusable local release plan",
      priority: "high",
      tags: ["release"],
      variables: [{ name: "feature", required: true }],
      project_id: null,
      plan_id: null,
      metadata: {},
      tasks: [
        {
          position: 0,
          title_pattern: "Plan {feature}",
          description: "Scope {feature}",
          priority: "high",
          tags: ["planning"],
          task_type: null,
          condition: null,
          include_template_id: null,
          depends_on_positions: [],
          metadata: {},
        },
        {
          position: 1,
          title_pattern: "Build {feature}",
          description: "Implement {feature}",
          priority: "critical",
          tags: ["implementation"],
          task_type: null,
          condition: null,
          include_template_id: null,
          depends_on_positions: [0],
          metadata: {},
        },
      ],
    }));

    const imported = await runCli(["template-import", importPath, "--json"], dbPath);
    expect(imported.exitCode).toBe(0);
    const template = JSON.parse(imported.stdout);

    const used = await runCli(["templates", "--use", template.id, "--var", "feature=dashboard", "--json"], dbPath);
    expect(used.exitCode).toBe(0);
    const tasks = JSON.parse(used.stdout);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe("Plan dashboard");
    expect(tasks[0].description).toBe("Scope dashboard");
    expect(tasks[1].title).toBe("Build dashboard");
    expect(tasks[1].description).toBe("Implement dashboard");

    const graphResult = await runCli(["deps", tasks[1].id, "--graph", "--json"], dbPath);
    expect(graphResult.exitCode).toBe(0);
    const graph = JSON.parse(graphResult.stdout);
    expect(graph.task.id).toBe(tasks[1].id);
    expect(graph.task.is_blocked).toBe(true);
    expect(graph.depends_on[0].task.id).toBe(tasks[0].id);

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    try { unlinkSync(importPath); } catch {}
  });

  it("should expose and write the bundled local template library from the CLI", async () => {
    const dbPath = "/tmp/test-cli-template-library.db";
    const { mkdtempSync, rmSync, unlinkSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    try { unlinkSync(dbPath); } catch {}
    const dir = mkdtempSync(join(tmpdir(), "todos-cli-template-library-"));

    try {
      const listed = await runCli(["template-library", "--json"], dbPath);
      expect(listed.exitCode).toBe(0);
      const library = JSON.parse(listed.stdout);
      expect(library.map((template: { name: string }) => template.name)).toEqual(expect.arrayContaining([
        "bug-fix",
        "feature-implementation",
        "security-review",
        "release",
        "migration",
        "incident",
        "docs-refresh",
        "qa",
      ]));

      const written = await runCli(["template-library", "--write", dir, "--json"], dbPath);
      expect(written.exitCode).toBe(0);
      expect(JSON.parse(written.stdout).written).toBeGreaterThanOrEqual(8);
      expect(existsSync(join(dir, "qa.json"))).toBe(true);

      const initialized = await runCli(["template-init", "--json"], dbPath);
      expect(initialized.exitCode).toBe(0);
      expect(JSON.parse(initialized.stdout).names).toContain("feature-implementation");
    } finally {
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(`${dbPath}-shm`); } catch {}
      try { unlinkSync(`${dbPath}-wal`); } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should run sprint command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "sprint", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-sprint.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(result.in_progress).toBeDefined();
    expect(result.next_up).toBeDefined();
    expect(result.blocked).toBeDefined();
    expect(result.overdue).toBeDefined();

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-sprint.db"); } catch {}
  });

  it("should create and list handoffs", async () => {
    const { unlinkSync } = await import("node:fs");
    const dbPath = "/tmp/test-cli-handoff.db";
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}

    const taskResult = await runCli(["add", "Handoff task", "--json"], dbPath);
    const task = JSON.parse(taskResult.stdout);
    const createResult = await runCli([
      "handoff",
      "--create",
      "--agent",
      "test",
      "--session",
      "session-1",
      "--summary",
      "Test handoff",
      "--tasks",
      task.id,
      "--files",
      "src/cli/index.tsx",
      "--runs",
      "run-1",
      "--json",
    ], dbPath);
    expect(createResult.exitCode).toBe(0);
    const handoff = JSON.parse(createResult.stdout);
    expect(handoff.agent_id).toBe("test");
    expect(handoff.summary).toBe("Test handoff");
    expect(handoff.session_id).toBe("session-1");
    expect(handoff.task_ids).toEqual([task.id]);
    expect(handoff.relevant_files).toEqual(["src/cli/index.tsx"]);
    expect(handoff.run_ids).toEqual(["run-1"]);

    const readResult = await runCli(["handoff", "--read", handoff.id.slice(0, 8), "--json"], dbPath);
    expect(JSON.parse(readResult.stdout).id).toBe(handoff.id);

    const listResult = await runCli(["handoff", "--unread-for", "reviewer", "--json"], dbPath);
    const handoffs = JSON.parse(listResult.stdout);
    expect(handoffs.length).toBe(1);

    const ackResult = await runCli(["handoff", "--ack", handoff.id, "--agent", "reviewer", "--json"], dbPath);
    expect(JSON.parse(ackResult.stdout).acknowledged_by).toEqual(["reviewer"]);
    const unreadResult = await runCli(["handoff", "--unread-for", "reviewer", "--json"], dbPath);
    expect(JSON.parse(unreadResult.stdout)).toHaveLength(0);

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should export and import local handoff bundles from the CLI", async () => {
    const { unlinkSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "todos-cli-handoff-bundle-"));
    const sourceDb = join(dir, "source.db");
    const targetDb = join(dir, "target.db");
    const bundlePath = join(dir, "handoff.json");

    const task = JSON.parse((await runCli(["add", "Bundle handoff task", "--json"], sourceDb)).stdout);
    const created = await runCli([
      "handoff",
      "--create",
      "--agent",
      "codex",
      "--session",
      "session-bundle",
      "--summary",
      "Bundle handoff",
      "--tasks",
      task.id,
      "--files",
      "src/bundle.ts",
      "--runs",
      "run-bundle",
      "--json",
    ], sourceDb);
    const handoff = JSON.parse(created.stdout);

    const exported = await runCli(["handoff", "--export", handoff.id, "--output", bundlePath, "--json"], sourceDb);
    expect(exported.exitCode).toBe(0);
    expect(JSON.parse(exported.stdout).path).toBe(bundlePath);

    const preview = await runCli(["handoff", "--import", bundlePath, "--json"], targetDb);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout).applied).toBe(false);

    const applied = await runCli(["handoff", "--import", bundlePath, "--apply", "--json"], targetDb);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout).created).toBe(true);

    const read = await runCli(["handoff", "--read", handoff.id, "--json"], targetDb);
    expect(JSON.parse(read.stdout).summary).toBe("Bundle handoff");

    for (const path of [sourceDb, targetDb, bundlePath]) {
      try { unlinkSync(path); } catch {}
      try { unlinkSync(`${path}-shm`); } catch {}
      try { unlinkSync(`${path}-wal`); } catch {}
    }
  });

  it("should run overdue command", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "overdue", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-overdue.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const result = JSON.parse(stdout);
    expect(Array.isArray(result)).toBe(true);

    const { unlinkSync } = await import("node:fs");
    try { unlinkSync("/tmp/test-cli-overdue.db"); } catch {}
  });

  it("should create and list local SLA escalations", async () => {
    const dbPath = "/tmp/test-cli-sla.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const created = await runCli(["add", "Escalate me", "--due", "2026-05-20", "--sla-minutes", "1", "--json"], dbPath);
    const task = JSON.parse(created.stdout);
    expect(task.sla_minutes).toBe(1);

    const escalations = JSON.parse((await runCli(["sla", "--json"], dbPath)).stdout);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].task.id).toBe(task.id);
    expect(escalations[0].reasons).toContain("overdue");

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should manage local workspace trust profiles", async () => {
    const dbPath = "/tmp/test-cli-trust.db";
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-trust-home-"));
    const project = join(home, "project");
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    try { unlinkSync(dbPath); } catch {}

    const added = await runCli([
      "trust",
      "add",
      project,
      "--preset",
      "standard",
      "--allow-command",
      "bun,git",
      "--write-scope",
      "src",
      "--redact-env",
      "CUSTOM_SECRET",
      "--json",
    ], dbPath);
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).write_scopes).toEqual(["src"]);

    const allowed = await runCli(["trust", "check", project, "--command", "bun test", "--write", join(project, "src/index.ts"), "--env", "CUSTOM_SECRET,PATH", "--json"], dbPath);
    expect(allowed.exitCode).toBe(0);
    const allowedPayload = JSON.parse(allowed.stdout);
    expect(allowedPayload.allowed).toBe(true);
    expect(allowedPayload.redacted_env_keys).toEqual(["CUSTOM_SECRET"]);

    const denied = await runCli(["trust", "check", project, "--command", "rm -rf .", "--write", join(project, "README.md"), "--json"], dbPath);
    expect(denied.exitCode).toBe(0);
    const deniedPayload = JSON.parse(denied.stdout);
    expect(deniedPayload.allowed).toBe(false);
    expect(deniedPayload.requires_prompt).toBe(true);

    const removed = await runCli(["trust", "remove", project, "--json"], dbPath);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).removed).toBe(true);

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    rmSync(home, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local secret redaction from the CLI", async () => {
    const dbPath = "/tmp/test-cli-redaction.db";
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-redaction-home-"));
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    try { unlinkSync(dbPath); } catch {}

    const added = await runCli(["redaction", "add", "--pattern", "INTERNAL-[0-9]{4}", "--key", "license", "--json"], dbPath);
    expect(added.exitCode).toBe(0);
    expect(JSON.parse(added.stdout).redaction_patterns).toEqual(["INTERNAL-[0-9]{4}"]);

    const scan = await runCli(["redaction", "scan", "INTERNAL-1234 TOKEN=secretsecret", "--json"], dbPath);
    expect(scan.exitCode).toBe(0);
    const payload = JSON.parse(scan.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.findings.map((finding: { pattern: string }) => finding.pattern)).toEqual(expect.arrayContaining([
      "custom:INTERNAL-[0-9]{4}",
      "env-secret-assignment",
    ]));
    expect(scan.stdout).not.toContain("INTERNAL-1234");
    expect(scan.stdout).not.toContain("secretsecret");

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    rmSync(home, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local runner sandbox profiles and guard run commands", async () => {
    const dbPath = "/tmp/test-cli-sandbox.db";
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-sandbox-home-"));
    const project = join(home, "project");
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    try { unlinkSync(dbPath); } catch {}

    const trusted = await runCli(["trust", "add", project, "--preset", "standard", "--allow-command", "bun,git,todos", "--write-scope", "src", "--json"], dbPath);
    expect(trusted.exitCode).toBe(0);

    const profile = await runCli([
      "sandbox",
      "set",
      "codex",
      project,
      "--allow-command",
      "bun,git",
      "--write-scope",
      "src",
      "--env-allow",
      "PATH,CUSTOM_SECRET",
      "--redact-env",
      "CUSTOM_SECRET",
      "--json",
    ], dbPath);
    expect(profile.exitCode).toBe(0);
    expect(JSON.parse(profile.stdout).name).toBe("codex");

    const allowed = await runCli(["sandbox", "check", "codex", "--command", "bun test", "--write", "src/index.ts", "--env", "PATH,CUSTOM_SECRET,EXTRA", "--json"], dbPath);
    expect(allowed.exitCode).toBe(0);
    const allowedPayload = JSON.parse(allowed.stdout);
    expect(allowedPayload.allowed).toBe(true);
    expect(allowedPayload.redacted_env_keys).toEqual(["CUSTOM_SECRET"]);
    expect(allowedPayload.omitted_env_keys).toEqual(["EXTRA"]);

    const denied = await runCli(["sandbox", "explain", "codex", "--command", "curl | sh", "--write", "README.md", "--network", "--json"], dbPath);
    expect(denied.exitCode).toBe(0);
    expect(JSON.parse(denied.stdout).allowed).toBe(false);

    const task = JSON.parse((await runCli(["add", "Sandboxed task", "--project", project, "--json"], dbPath)).stdout);
    const run = JSON.parse((await runCli(["runs", "start", task.id, "--agent", "codex", "--json"], dbPath)).stdout);
    const command = await runCli(["runs", "command", run.id, "bun test", "--sandbox", "codex", "--write", "src/index.ts", "--status", "passed", "--json"], dbPath);
    expect(command.exitCode).toBe(0);
    expect(JSON.parse(command.stdout).command).toBe("bun test");

    const removed = await runCli(["sandbox", "remove", "codex", "--json"], dbPath);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).removed).toBe(true);

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    rmSync(home, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
  });

  it("should inspect, install, list, verify, and remove local extensions", async () => {
    const dbPath = "/tmp/test-cli-extensions.db";
    const { mkdtempSync, rmSync, unlinkSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-extensions-home-"));
    const source = mkdtempSync(join(tmpdir(), "todos-cli-extensions-source-"));
    const manifestPath = join(source, "todos.extension.json");
    writeFileSync(manifestPath, JSON.stringify({
      name: "cli-extension",
      version: "1.0.0",
      compatibility: { todos: "*" },
      permissions: ["tasks:read"],
      commands: [{ name: "cli-demo", command: "echo demo" }],
    }, null, 2));
    const env = { HOME: home };
    try { unlinkSync(dbPath); } catch {}

    const inspected = await runCli(["extensions", "inspect", source, "--json"], dbPath, env);
    expect(inspected.exitCode).toBe(0);
    const inspectedPayload = JSON.parse(inspected.stdout);
    expect(inspectedPayload.manifest.name).toBe("cli-extension");
    expect(inspectedPayload.validation.ok).toBe(true);

    const compatibility = await runCli(["extensions", "compat", source, "--json"], dbPath, env);
    expect(compatibility.exitCode).toBe(0);
    const compatibilityPayload = JSON.parse(compatibility.stdout);
    expect(compatibilityPayload.summary.commands).toBe(1);
    expect(compatibilityPayload.validation.sandbox_checks[0].command_name).toBe("cli-demo");

    const installed = await runCli(["extensions", "install", source, "--checksum", inspectedPayload.checksum, "--json"], dbPath, env);
    expect(installed.exitCode).toBe(0);
    const installedPayload = JSON.parse(installed.stdout);
    expect(installedPayload.status).toBe("needs_review");
    expect(installedPayload.trusted).toBe(false);

    const listed = await runCli(["extensions", "list", "--json"], dbPath, env);
    expect(JSON.parse(listed.stdout)).toHaveLength(1);

    const verified = await runCli(["extensions", "verify", source, "--checksum", inspectedPayload.checksum, "--json"], dbPath, env);
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout).checksum_ok).toBe(true);

    const removed = await runCli(["extensions", "remove", "cli-extension", "--json"], dbPath, env);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).removed).toBe(true);

    rmSync(home, { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should list and render local workflow prompts", async () => {
    const dbPath = "/tmp/test-cli-workflows.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const listed = await runCli(["workflows", "list", "--json"], dbPath);
    expect(listed.exitCode).toBe(0);
    const prompts = JSON.parse(listed.stdout);
    expect(prompts.map((prompt: { id: string }) => prompt.id)).toContain("goal_planning");

    const rendered = await runCli([
      "workflows",
      "show",
      "goal_planning",
      "--objective",
      "Ship release",
      "--task",
      "abcd1234",
      "--json",
    ], dbPath);
    expect(rendered.exitCode).toBe(0);
    const prompt = JSON.parse(rendered.stdout);
    expect(prompt.local_only).toBe(true);
    expect(prompt.messages[0].content.text).toContain("Ship release");

    const exported = await runCli(["workflows", "export", "--format", "markdown"], dbPath);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain("## /goal planning");

    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
  });

  it("should manage local policy packs and validate task evidence", async () => {
    const dbPath = "/tmp/test-cli-policies.db";
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "todos-cli-policies-home-"));
    const project = join(home, "project");
    const previousHome = process.env["HOME"];
    process.env["HOME"] = home;
    try { unlinkSync(dbPath); } catch {}

    const pack = await runCli([
      "policies",
      "set",
      "release",
      project,
      "--required-status",
      "completed",
      "--required-command",
      "bun test",
      "--require-passed-verification",
      "--require-commit",
      "--require-pr",
      "--require-approval",
      "--require-run",
      "--require-artifact",
      "--evidence-min",
      "6",
      "--branch-pattern",
      "task/*",
      "--json",
    ], dbPath);
    expect(pack.exitCode).toBe(0);
    expect(JSON.parse(pack.stdout).name).toBe("release");

    const task = JSON.parse((await runCli(["add", "Policy task", "--approval", "--json"], dbPath)).stdout);
    expect((await runCli(["--agent", "reviewer", "approve", task.id], dbPath)).exitCode).toBe(0);
    expect((await runCli(["update", task.id, "--status", "completed"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["link-commit", task.id, "abcdef1234567890", "--files", "src/policy.ts"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["link-ref", task.id, "task/local-policy-packs", "--type", "branch"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["link-ref", task.id, "17", "--type", "pull_request"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["record-verification", task.id, "bun test", "--status", "passed", "--artifact", "logs/test.txt"], dbPath)).exitCode).toBe(0);
    const run = JSON.parse((await runCli(["runs", "start", task.id, "--agent", "codex", "--json"], dbPath)).stdout);
    expect((await runCli(["runs", "artifact", run.id, "logs/run.txt", "--type", "log", "--no-store", "--json"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["runs", "finish", run.id, "--status", "completed", "--json"], dbPath)).exitCode).toBe(0);

    const validation = await runCli(["policies", "validate", "release", task.id, "--json"], dbPath);
    expect(validation.exitCode).toBe(0);
    expect(JSON.parse(validation.stdout).passed).toBe(true);

    const removed = await runCli(["policies", "remove", "release", "--json"], dbPath);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).removed).toBe(true);

    if (previousHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = previousHome;
    rmSync(home, { recursive: true, force: true });
    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local task contracts and review gates from the CLI", async () => {
    const dbPath = "/tmp/test-cli-task-contracts.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const task = JSON.parse((await runCli(["add", "Contract task", "--approval", "--json"], dbPath)).stdout);
    const set = await runCli([
      "contracts",
      "set",
      task.id,
      "--criteria",
      "Parser handles quotes;Parser rejects malformed checkboxes",
      "--verify",
      "bun test src/parser.test.ts",
      "--artifact",
      "logs/parser.txt",
      "--risk",
      "medium",
      "--done",
      "review approved",
      "--json",
    ], dbPath);
    expect(set.exitCode).toBe(0);
    expect(JSON.parse(set.stdout).acceptance_criteria).toHaveLength(2);

    const invalidRisk = await runCli(["contracts", "set", task.id, "--risk", "unknown"], dbPath);
    expect(invalidRisk.exitCode).toBe(1);
    expect(invalidRisk.stderr).toContain("--risk must be low, medium, high, or critical");

    const requested = await runCli(["contracts", "request-review", task.id, "--requester", "codex", "--reviewer", "reviewer", "--json"], dbPath);
    expect(requested.exitCode).toBe(0);
    expect(JSON.parse(requested.stdout).state).toBe("requested");

    const missing = await runCli(["contracts", "check", task.id, "--json"], dbPath);
    expect(missing.exitCode).toBe(0);
    expect(JSON.parse(missing.stdout).missing).toEqual(expect.arrayContaining(["task_status_completed", "review_approved"]));

    expect((await runCli(["record-verification", task.id, "bun test src/parser.test.ts", "--status", "passed", "--artifact", "logs/parser.txt"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["update", task.id, "--status", "completed"], dbPath)).exitCode).toBe(0);
    const reviewed = await runCli(["contracts", "review", task.id, "--state", "approved", "--reviewer", "reviewer", "--json"], dbPath);
    expect(reviewed.exitCode).toBe(0);
    expect(JSON.parse(reviewed.stdout).state).toBe("approved");

    const passed = await runCli(["contracts", "check", task.id, "--json"], dbPath);
    expect(passed.exitCode).toBe(0);
    expect(JSON.parse(passed.stdout).ok).toBe(true);

    const reopened = await runCli(["contracts", "review", task.id, "--state", "reopened", "--reviewer", "reviewer", "--json"], dbPath);
    expect(reopened.exitCode).toBe(0);
    expect(JSON.parse(reopened.stdout).state).toBe("reopened");
    const reopenedCheck = await runCli(["contracts", "check", task.id, "--json"], dbPath);
    expect(reopenedCheck.exitCode).toBe(0);
    expect(JSON.parse(reopenedCheck.stdout).missing).toContain("review_approved");

    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local approval gates and block failed checks in json mode", async () => {
    const dbPath = "/tmp/test-cli-approval-gates.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const task = JSON.parse((await runCli(["add", "Approval gate task", "--json"], dbPath)).stdout);
    const run = JSON.parse((await runCli(["runs", "start", task.id, "--agent", "codex", "--json"], dbPath)).stdout);

    const missing = await runCli(["approvals", "check", task.id, "deploy", "--json"], dbPath);
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout).allowed).toBe(false);

    const required = await runCli([
      "approvals",
      "require",
      task.id,
      "deploy",
      "--requester",
      "codex",
      "--reviewer",
      "reviewer",
      "--reason",
      "production-affecting action",
      "--run",
      run.id.slice(0, 8),
      "--json",
    ], dbPath);
    expect(required.exitCode).toBe(0);
    const pending = JSON.parse(required.stdout);
    expect(pending.status).toBe("pending");
    expect(pending.run_id).toBe(run.id);

    const blocked = await runCli(["approvals", "check", task.id, "deploy", "--json"], dbPath);
    expect(blocked.exitCode).toBe(1);
    expect(JSON.parse(blocked.stdout).reasons).toContain("approval gate deploy is pending");

    const approved = await runCli(["approvals", "approve", task.id, "deploy", "--reviewer", "reviewer", "--json"], dbPath);
    expect(approved.exitCode).toBe(0);
    expect(JSON.parse(approved.stdout).status).toBe("approved");

    const allowed = await runCli(["approvals", "check", task.id, "deploy", "--json"], dbPath);
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).allowed).toBe(true);

    const list = await runCli(["approvals", "list", task.id, "--json"], dbPath);
    expect(JSON.parse(list.stdout)).toHaveLength(1);
    try { unlinkSync(dbPath); } catch {}
  });

  it("should build local agent context packs from the CLI", async () => {
    const dbPath = "/tmp/test-cli-context-pack.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const task = JSON.parse((await runCli(["add", "Context pack task", "--description", "Run safely", "--json"], dbPath)).stdout);
    expect((await runCli(["comment", task.id, "Bearer abcdefghijklmnop should redact"], dbPath)).exitCode).toBe(0);
    expect((await runCli(["record-verification", task.id, "bun test", "--status", "passed", "--summary", "ok"], dbPath)).exitCode).toBe(0);
    const json = await runCli(["context-pack", task.id, "--profile", "codex", "--format", "json"], dbPath);
    expect(json.exitCode).toBe(0);
    const pack = JSON.parse(json.stdout);
    expect(pack.profile).toBe("codex");
    expect(pack.task.title).toBe("Context pack task");
    expect(pack.comments.recent[0].content).toContain("[REDACTED]");
    expect(pack.traceability.verifications[0].command).toBe("bun test");

    const markdown = await runCli(["context-pack", task.id, "--profile", "takumi", "--format", "markdown"], dbPath);
    expect(markdown.exitCode).toBe(0);
    expect(markdown.stdout).toContain("# Agent Context Pack: Context pack task");
    expect(markdown.stdout).toContain("For Takumi");

    const compactJson = await runCli([
      "context-pack",
      task.id,
      "--profile",
      "codex",
      "--format",
      "json",
      "--token-budget",
      "180",
      "--exclude",
      "comments,runs",
      "--compact",
    ], dbPath);
    expect(compactJson.exitCode).toBe(0);
    const budgeted = JSON.parse(compactJson.stdout);
    expect(budgeted.context_budget.token_budget).toBe(180);
    expect(budgeted.context_budget.omitted_sections).toContain("comments");
    expect(budgeted.context_budget.summaries.some((summary: { section: string; reason: string }) => summary.section === "comments" && summary.reason.includes("exclude_sections"))).toBe(true);
    expect(compactJson.stdout).not.toContain("\n  ");

    const compactMarkdown = await runCli(["context-pack", task.id, "--format", "compact-markdown", "--token-budget", "180"], dbPath);
    expect(compactMarkdown.exitCode).toBe(0);
    expect(compactMarkdown.stdout).toContain("# Context: Context pack task");
    expect(compactMarkdown.stdout).toContain("Estimated tokens:");
    try { unlinkSync(dbPath); } catch {}
  });

  it("should show a redacted local activity timeline from the CLI", async () => {
    const dbPath = "/tmp/test-cli-activity-timeline.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const task = JSON.parse((await runCli(["add", "Timeline task", "--json"], dbPath)).stdout);
    expect((await runCli(["comment", task.id, "Bearer abcdefghijklmnop should redact"], dbPath)).exitCode).toBe(0);
    const run = JSON.parse((await runCli(["runs", "start", task.id, "--agent", "codex", "--json"], dbPath)).stdout);
    expect((await runCli(["runs", "event", run.id, "progress", "Bearer bcdefghijklmnopq", "--json"], dbPath)).exitCode).toBe(0);

    const result = await runCli(["timeline", "--task", task.id, "--order", "asc", "--json"], dbPath);
    expect(result.exitCode).toBe(0);
    const timeline = JSON.parse(result.stdout);
    expect(timeline.entries.map((entry: { source: string }) => entry.source)).toEqual(expect.arrayContaining(["comment", "run_event"]));
    expect(JSON.stringify(timeline.entries)).not.toContain("abcdefghijklmnop");
    expect(JSON.stringify(timeline.entries)).toContain("[REDACTED]");
    try { unlinkSync(dbPath); } catch {}
  });

  it("should track local time and focus sessions from the CLI", async () => {
    const dbPath = "/tmp/test-cli-time-tracking.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const task = JSON.parse((await runCli(["add", "Time tracking task", "--estimated", "90", "--json"], dbPath)).stdout);
    const manual = await runCli(["time", "log", task.id, "15", "--agent", "codex", "--json"], dbPath);
    expect(manual.exitCode).toBe(0);
    expect(JSON.parse(manual.stdout).minutes).toBe(15);

    const started = await runCli([
      "time", "start", task.id,
      "--agent", "codex",
      "--title", "focus block",
      "--started-at", "2026-01-01T10:00:00.000Z",
      "--idle-after", "20",
      "--json",
    ], dbPath);
    expect(started.exitCode).toBe(0);
    const session = JSON.parse(started.stdout);
    expect(session.status).toBe("active");

    const idle = await runCli(["time", "idle", "--agent", "codex", "--now", "2026-01-01T10:30:00.000Z", "--json"], dbPath);
    expect(JSON.parse(idle.stdout)[0].idle_minutes).toBe(30);

    const stopped = await runCli(["time", "stop", session.id, "--at", "2026-01-01T10:45:00.000Z", "--notes", "done", "--json"], dbPath);
    expect(stopped.exitCode).toBe(0);
    expect(JSON.parse(stopped.stdout).actual_minutes).toBe(45);

    const report = await runCli(["time", "report", "--include-open", "--json"], dbPath);
    const entry = JSON.parse(report.stdout).find((item: { task_id: string }) => item.task_id === task.id);
    expect(entry.actual_minutes).toBe(60);
    expect(entry.logged_minutes).toBe(60);
    expect(entry.focus_minutes).toBe(45);

    const sessions = await runCli(["time", "list", "--all", "--json"], dbPath);
    expect(JSON.parse(sessions.stdout)).toHaveLength(1);
    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local kanban boards from the CLI", async () => {
    const dbPath = "/tmp/test-cli-boards.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    try {
      const first = JSON.parse((await runCli(["add", "board task one", "--status", "in_progress", "--json"], dbPath)).stdout);
      await runCli(["add", "board task two", "--status", "in_progress", "--json"], dbPath);
      const created = await runCli([
        "board",
        "create",
        "cli-board",
        "--lane",
        "Ready=pending",
        "Doing=in_progress:1",
        "--json",
      ], dbPath);
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout).name).toBe("cli-board");

      const shown = await runCli(["board", "show", "cli-board", "--json"], dbPath);
      expect(shown.exitCode).toBe(0);
      const snapshot = JSON.parse(shown.stdout);
      expect(snapshot.totals.cards).toBe(2);
      expect(snapshot.totals.wip_exceeded_lanes).toBe(1);
      expect(snapshot.keyboard.quit).toBe("q");

      const moved = await runCli(["board", "move", "cli-board", first.id.slice(0, 8), "--lane", "Ready", "--json"], dbPath);
      expect(moved.exitCode).toBe(0);
      expect(JSON.parse(moved.stdout).status).toBe("pending");

      const exported = JSON.parse((await runCli(["board", "export", "cli-board", "--json"], dbPath)).stdout);
      expect(exported.kind).toBe("hasna.todos.task-board");
      expect(exported.boards).toHaveLength(1);
    } finally {
      try { unlinkSync(dbPath); } catch {}
    }
  });

  it("should list export and import local calendar events from the CLI", async () => {
    const dbPath = "/tmp/test-cli-calendar.db";
    const icsPath = "/tmp/test-cli-calendar.ics";
    const { unlinkSync, writeFileSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(icsPath); } catch {}

    try {
      const task = JSON.parse((await runCli([
        "add",
        "calendar cli task",
        "--due",
        "2026-06-01T09:00:00.000Z",
        "--recurrence",
        "every week",
        "--json",
      ], dbPath)).stdout);
      const item = await runCli([
        "calendar",
        "add",
        "CLI milestone",
        "--kind",
        "milestone",
        "--start",
        "2026-06-02T10:00:00.000Z",
        "--task",
        task.id,
        "--json",
      ], dbPath);
      expect(item.exitCode).toBe(0);
      expect(JSON.parse(item.stdout).kind).toBe("milestone");

      const listed = JSON.parse((await runCli(["calendar", "list", "--json"], dbPath)).stdout);
      expect(listed.map((event: { kind: string }) => event.kind)).toEqual(expect.arrayContaining(["task_due", "milestone"]));

      const exported = JSON.parse((await runCli(["calendar", "export", "--json"], dbPath)).stdout);
      expect(exported.content).toContain("BEGIN:VCALENDAR");
      expect(exported.content).toContain("SUMMARY:Due: calendar cli task");

      writeFileSync(icsPath, `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cli@example.com
DTSTART:20260603T120000Z
SUMMARY:CLI imported
END:VEVENT
END:VCALENDAR`);
      const imported = JSON.parse((await runCli(["calendar", "import", icsPath, "--json"], dbPath)).stdout);
      expect(imported.imported).toBe(1);
    } finally {
      try { unlinkSync(dbPath); } catch {}
      try { unlinkSync(icsPath); } catch {}
    }
  });

  it("should queue and run local agent dispatches", async () => {
    const dbPath = "/tmp/test-cli-agent-runs.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const adapter = await runCli(["agent-runs", "adapter-set", "codex", "--command", "printf dispatched", "--json"], dbPath);
    expect(adapter.exitCode).toBe(0);
    expect(JSON.parse(adapter.stdout).name).toBe("codex");

    const task = JSON.parse((await runCli(["add", "Queued agent task", "--json"], dbPath)).stdout);
    const queued = await runCli(["agent-runs", "queue", task.id, "--adapter", "codex", "--agent", "codex", "--json"], dbPath);
    expect(queued.exitCode).toBe(0);
    const queuedPayload = JSON.parse(queued.stdout);
    expect(queuedPayload.dispatcher.state).toBe("queued");

    const dryRun = await runCli(["agent-runs", "run-next", "--dry-run", "--json"], dbPath);
    expect(dryRun.exitCode).toBe(0);
    expect(JSON.parse(dryRun.stdout).dry_run).toBe(true);

    const result = await runCli(["agent-runs", "run-next", "--json"], dbPath);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.status).toBe("completed");
    expect(payload.output_summary).toContain("dispatched");

    const removed = await runCli(["agent-runs", "adapter-remove", "codex", "--json"], dbPath);
    expect(removed.exitCode).toBe(0);
    expect(JSON.parse(removed.stdout).removed).toBe(true);
    try { unlinkSync(dbPath); } catch {}
  });

  it("should manage local event hooks from the CLI", async () => {
    const { mkdtempSync, readFileSync, rmSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-cli-event-hooks-"));
    process.env["HOME"] = home;
    const dbPath = join(home, "todos.db");
    const eventPath = join(home, "events.jsonl");

    try {
      const saved = await runCli(["event-hooks", "set", "audit", "--event", "task.completed", "--target", "file", "--file", eventPath, "--json"], dbPath);
      expect(saved.exitCode).toBe(0);
      expect(JSON.parse(saved.stdout).name).toBe("audit");

      const test = await runCli(["event-hooks", "test", "audit", "--event", "task.completed", "--payload", "{\"id\":\"task-1\"}", "--json"], dbPath);
      expect(test.exitCode).toBe(0);
      expect(JSON.parse(test.stdout)[0].status).toBe("delivered");
      expect(JSON.parse(readFileSync(eventPath, "utf-8").trim()).type).toBe("task.completed");

      const list = await runCli(["event-hooks", "list", "--json"], dbPath);
      expect(JSON.parse(list.stdout)).toHaveLength(1);

      const removed = await runCli(["event-hooks", "remove", "audit", "--json"], dbPath);
      expect(JSON.parse(removed.stdout).removed).toBe(true);
      try { unlinkSync(dbPath); } catch {}
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("should manage local terminal notification rules from the CLI", async () => {
    const { mkdtempSync, rmSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const previousHome = process.env["HOME"];
    const home = mkdtempSync(join(tmpdir(), "todos-cli-terminal-notifications-"));
    process.env["HOME"] = home;
    const dbPath = join(home, "todos.db");

    try {
      const saved = await runCli([
        "terminal-notifications",
        "set",
        "blocked",
        "--event",
        "task.blocked,task.failed",
        "--min-severity",
        "warning",
        "--agent",
        "codex",
        "--priority",
        "high",
        "--contains",
        "deploy",
        "--bell",
        "--json",
      ], dbPath);
      expect(saved.exitCode).toBe(0);
      expect(JSON.parse(saved.stdout).rule.name).toBe("blocked");

      const test = await runCli([
        "terminal-notifications",
        "test",
        "blocked",
        "--event",
        "task.failed",
        "--payload",
        "{\"id\":\"task-1\",\"title\":\"Deploy failed\",\"agent_id\":\"codex\",\"priority\":\"high\"}",
        "--json",
      ], dbPath);
      expect(test.exitCode).toBe(0);
      const payload = JSON.parse(test.stdout);
      expect(payload.matched).toBe(true);
      expect(payload.notifications[0].severity).toBe("critical");

      const list = await runCli(["terminal-notifications", "list", "--json"], dbPath);
      expect(JSON.parse(list.stdout)).toHaveLength(1);

      const removed = await runCli(["terminal-notifications", "remove", "blocked", "--json"], dbPath);
      expect(JSON.parse(removed.stdout).removed).toBe(true);
      try { unlinkSync(dbPath); } catch {}
    } finally {
      if (previousHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("should extract source TODOs with index metadata and watcher output", async () => {
    const { mkdtempSync, rmSync, writeFileSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "todos-cli-extract-"));
    const dbPath = join(root, "todos.db");

    try {
      writeFileSync(join(root, ".gitignore"), "ignored.ts\n");
      writeFileSync(join(root, "ignored.ts"), "// TODO: Do not include\n");
      writeFileSync(join(root, "app.ts"), "export function runAgent() {\n  // TODO: Create project plan\n}\n");

      const dryRun = await runCli(["--json", "extract", root, "--dry-run", "--index"], dbPath);
      expect(dryRun.exitCode).toBe(0);
      const dryPayload = JSON.parse(dryRun.stdout);
      expect(dryPayload.comments).toHaveLength(1);
      expect(dryPayload.comments[0].symbol).toBe("runAgent");
      expect(dryPayload.index.total_symbols).toBe(1);

      const watch = await runCli(["--json", "extract-watch", root, "--dry-run", "--max-runs", "1"], dbPath);
      expect(watch.exitCode).toBe(0);
      const watchPayload = JSON.parse(watch.stdout);
      expect(watchPayload.runs).toHaveLength(1);
      expect(watchPayload.runs[0].changed_files).toEqual(["app.ts"]);

      try { unlinkSync(dbPath); } catch {}
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should register machines with topology metadata and report diagnostics", async () => {
    const dbPath = "/tmp/test-cli-machines-topology.db";
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(dbPath); } catch {}

    const registered = await runCli([
      "machines",
      "register",
      "spark01",
      "--hostname",
      "spark01",
      "--ssh",
      "hasna@spark01",
      "--tailscale-name",
      "spark01.tailnet",
      "--tailscale-ip",
      "100.64.0.10",
      "--lan-address",
      "192.168.8.10",
      "--workspace",
      "/home/hasna/workspace",
      "--json",
    ], dbPath);
    expect(registered.exitCode).toBe(0);
    expect(JSON.parse(registered.stdout).metadata).toMatchObject({
      tailscale_name: "spark01.tailnet",
      tailscale_ip: "100.64.0.10",
      lan_address: "192.168.8.10",
      workspace_path: "/home/hasna/workspace",
    });

    const heartbeat = await runCli(["machines", "heartbeat", "spark01", "--workspace", "/home/hasna/workspace", "--json"], dbPath);
    expect(heartbeat.exitCode).toBe(0);
    expect(JSON.parse(heartbeat.stdout).name).toBe("spark01");

    const topology = await runCli(["machines", "topology", "--json"], dbPath);
    expect(topology.exitCode).toBe(0);
    const payload = JSON.parse(topology.stdout);
    expect(payload.machines.find((m: { name: string }) => m.name === "spark01").topology).toMatchObject({
      tailscale_name: "spark01.tailnet",
      tailscale_ip: "100.64.0.10",
      lan_address: "192.168.8.10",
      workspace_path: "/home/hasna/workspace",
    });
    try { unlinkSync(dbPath); } catch {}
  });
});
