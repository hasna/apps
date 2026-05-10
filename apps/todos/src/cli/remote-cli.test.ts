import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CWD = join(import.meta.dir, "../..");

let fakeHome: string;
let server: ReturnType<typeof Bun.serve>;
let observedAuth: string | null = null;
let observedCreateBody: unknown = null;

async function runRemote(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCli(args, {
    TODOS_MODE: "remote",
    TODOS_API_URL: String(server.url).replace(/\/$/, ""),
    TODOS_API_KEY: "remote-test-key",
  });
}

async function runCli(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: {
      ...process.env,
      HOME: fakeHome,
      TODOS_DB_PATH: "/tmp/remote-cli-should-not-open.db",
      TODOS_AUTO_PROJECT: "false",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "todos-remote-cli-"));
  observedAuth = null;
  observedCreateBody = null;
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      observedAuth = req.headers.get("x-api-key");
      if (url.pathname === "/api/tasks" && req.method === "GET") {
        return Response.json([
          {
            id: "task-remote-1",
            short_id: "REM-1",
            title: "Remote pending task",
            status: "pending",
            priority: "high",
            assigned_to: null,
          },
        ]);
      }
      if (url.pathname === "/api/tasks" && req.method === "POST") {
        observedCreateBody = await req.json();
        return Response.json({
          id: "task-remote-2",
          short_id: "REM-2",
          title: (observedCreateBody as { title: string }).title,
          status: "pending",
          priority: "medium",
          assigned_to: null,
        }, { status: 201 });
      }
      if (url.pathname === "/api/tasks/status" && req.method === "GET") {
        return Response.json({
          pending: 1,
          in_progress: 0,
          completed: 0,
          total: 1,
          active_work: [],
          next_task: null,
          stale_count: 0,
          overdue_recurring: 0,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("remote CLI mode", () => {
  test("can bootstrap remote login before remote mode is configured", async () => {
    const result = await runCli(["--json", "login", "--api-url", "https://todos.example/", "--api-key", "secret-token"]);

    expect(result.exitCode).toBe(0);
    const config = JSON.parse(result.stdout);
    expect(config.mode).toBe("remote");
    expect(config.apiUrl).toBe("https://todos.example");
    expect(config.apiKey).toBe("secr...oken");
    expect(result.stdout).not.toContain("secret-token");
  });

  test("routes list through the remote API with auth", async () => {
    const result = await runRemote(["--json", "list"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("SQLite");
    expect(observedAuth).toBe("remote-test-key");
    const tasks = JSON.parse(result.stdout);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Remote pending task");
  });

  test("creates tasks through the remote API without touching local SQLite", async () => {
    const result = await runRemote(["--json", "add", "Created remotely", "--priority", "high"]);

    expect(result.exitCode).toBe(0);
    expect(observedAuth).toBe("remote-test-key");
    expect(observedCreateBody).toMatchObject({
      title: "Created remotely",
      priority: "high",
    });
    const task = JSON.parse(result.stdout);
    expect(task.id).toBe("task-remote-2");
  });

  test("prints remote status counts", async () => {
    const result = await runRemote(["--json", "count"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).total).toBe(1);
  });
});
