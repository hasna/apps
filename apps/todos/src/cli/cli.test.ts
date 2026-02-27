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
});
