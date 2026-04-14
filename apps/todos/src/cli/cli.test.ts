import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask } from "../db/tasks.js";

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
});
