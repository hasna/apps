import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";

async function runCli(args: string[], dbPath: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env: { ...process.env, TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
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
    writeFileSync(logPath, "run ledger tests passed\nTOKEN=super-secret-token-value\n");

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

  it("should capture local inbox intake and dedupe repeated failures", async () => {
    const dbPath = "/tmp/test-cli-inbox-intake.db";
    const { unlinkSync, writeFileSync } = await import("node:fs");
    const filePath = "/tmp/test-cli-inbox-intake.log";
    try { unlinkSync(dbPath); } catch {}
    try { unlinkSync(`${dbPath}-shm`); } catch {}
    try { unlinkSync(`${dbPath}-wal`); } catch {}
    try { unlinkSync(filePath); } catch {}

    writeFileSync(filePath, "bun test failed\nTypeError: broken\nTOKEN=secret-token-value");
    const created = await runCli(["inbox", "add", "--file", filePath, "--source-type", "ci_log", "--json"], dbPath);
    expect(created.exitCode).toBe(0);
    const first = JSON.parse(created.stdout);
    expect(first.item.source_type).toBe("ci_log");
    expect(first.item.body).not.toContain("secret-token-value");
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

    for (const path of [sourceDb, targetDb, bundlePath, `${sourceDb}-shm`, `${sourceDb}-wal`, `${targetDb}-shm`, `${targetDb}-wal`]) {
      try { unlinkSync(path); } catch {}
    }
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
    try { unlinkSync("/tmp/test-cli-handoff.db"); } catch {}
    try { unlinkSync("/tmp/test-cli-handoff.db-shm"); } catch {}
    try { unlinkSync("/tmp/test-cli-handoff.db-wal"); } catch {}

    const createProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "handoff", "--create", "--agent", "test", "--summary", "Test handoff", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-handoff.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const createOut = await new Response(createProc.stdout).text();
    await createProc.exited;
    const handoff = JSON.parse(createOut);
    expect(handoff.agent_id).toBe("test");
    expect(handoff.summary).toBe("Test handoff");

    const listProc = Bun.spawn(
      ["bun", "run", "src/cli/index.tsx", "handoff", "--json"],
      {
        cwd: import.meta.dir + "/../..",
        env: { ...process.env, TODOS_DB_PATH: "/tmp/test-cli-handoff.db", TODOS_AUTO_PROJECT: "false" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const listOut = await new Response(listProc.stdout).text();
    await listProc.exited;
    const handoffs = JSON.parse(listOut);
    expect(handoffs.length).toBe(1);

    try { unlinkSync("/tmp/test-cli-handoff.db"); } catch {}
    try { unlinkSync("/tmp/test-cli-handoff.db-shm"); } catch {}
    try { unlinkSync("/tmp/test-cli-handoff.db-wal"); } catch {}
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
});
