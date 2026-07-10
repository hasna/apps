import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "74009b15-d760-40b8-abb1-6519f06bd283";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCloudDetail(command: "show" | "inspect") {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      if (url.pathname === `/v1/tasks/${TASK_ID}`) {
        return Response.json({
          task: {
            id: TASK_ID,
            title: "Cloud comment regression",
            status: "in_progress",
            priority: "high",
            tags: [],
            version: 1,
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/comments`) {
        return Response.json({
          comments: [
            {
              id: "comment-1",
              task_id: TASK_ID,
              agent_id: "hortensia",
              session_id: null,
              content: "Persisted cloud milestone",
              type: "comment",
              progress_pct: null,
              created_at: "2026-07-10T00:01:00.000Z",
            },
          ],
          count: 1,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  const root = mkdtempSync(join(tmpdir(), "todos-cloud-comment-detail-"));
  tempRoots.push(root);
  try {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", "--json", command, TASK_ID], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: root,
        TODOS_DB_PATH: join(root, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_STORAGE_MODE: "self_hosted",
        HASNA_TODOS_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_TODOS_API_KEY: "hasna_todos_test_key",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr, requests };
  } finally {
    server.stop(true);
  }
}

describe("cloud task detail comments", () => {
  for (const command of ["show", "inspect"] as const) {
    test(`${command} reads persisted comments instead of fabricating an empty relation`, async () => {
      const result = await runCloudDetail(command);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");

      const task = JSON.parse(result.stdout);
      expect(task.comments).toHaveLength(1);
      expect(task.comments[0]).toMatchObject({
        task_id: TASK_ID,
        content: "Persisted cloud milestone",
      });
      expect(result.requests).toContain(`/v1/tasks/${TASK_ID}/comments`);
    });
  }
});
