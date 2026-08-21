import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression (I38-00523): an unsupported or empty project filter must fail
 * closed instead of silently returning success.
 *
 * Measured defect family (memento 67df58cf, 2026-08-20): hosted `todos`
 * returned rc=0 with an empty result and empty stderr for an unsupported
 * `--project` filter, while the documented `--project-name` query worked.
 * Reproduced in source: `todos projects --project <ref>` and
 * `todos show --project <ref> <id>` silently ignored the flag (rc=0,
 * unfiltered output, no error), and `todos list --project-name ""` /
 * `--project ""` silently dropped the empty filter and returned the FULL
 * population with rc=0.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "[REDACTED_SECRET]";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "todos-project-filter-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(
  args: string[],
  root: string,
  baseUrl: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

/** A minimal /v1 authority that answers project reads and task reads. */
function startServer(): { url: string; stop: () => Promise<void> } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/projects") {
        return Response.json({ projects: [{ id: PROJECT_ID, name: "Open Emails", path: "/workspace/open-emails", task_list_id: "emails-canonical" }] });
      }
      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = decodeURIComponent(taskMatch[1] ?? "");
        if (id === PROJECT_ID) {
          return Response.json({ task: { id, title: "fixture", project_id: PROJECT_ID } });
        }
        return Response.json({ error: "task not found" }, { status: 404 });
      }
      const commentsMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/comments$/);
      if (commentsMatch) {
        return Response.json({
          comments: [],
          comments_page: { count: 0, limit: 10, has_more: false, pagination_supported: true },
        });
      }
      if (url.pathname === "/v1/tasks" && request.method === "GET") {
        return Response.json({ tasks: [] });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

describe("unsupported project filter fails closed (I38-00523)", () => {
  test("projects --project <ref> is rejected instead of silently ignored", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(
        ["projects", "--project", "definitely-nonexistent-xyz", "--json"],
        root,
        server.url,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/does not support a --project filter/i);
      expect(result.stdout).not.toMatch(/^\s*\[/);
    } finally {
      await server.stop();
    }
  });

  test("projects without a project filter still lists projects (positive control)", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(["projects", "--json"], root, server.url);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(PROJECT_ID);
    } finally {
      await server.stop();
    }
  });

  test("show --project <ref> <id> is rejected instead of silently ignored", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(
        ["show", "--project", "definitely-nonexistent-xyz", PROJECT_ID],
        root,
        server.url,
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/does not support a --project filter/i);
    } finally {
      await server.stop();
    }
  });

  test("show <id> without a project filter still resolves (positive control)", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(["show", PROJECT_ID, "--json"], root, server.url);
      expect(result.exitCode).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test("list --project-name '' is rejected instead of returning the full population", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(["list", "--project-name", "", "--json"], root, server.url);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/--project-name requires a non-empty/i);
    } finally {
      await server.stop();
    }
  });

  test("list --project '' is rejected instead of returning the full population", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(["list", "--project", "", "--json"], root, server.url);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/--project requires a non-empty/i);
    } finally {
      await server.stop();
    }
  });

  test("list --project-name <valid> still resolves (positive control)", async () => {
    const root = tempRoot();
    const server = startServer();
    try {
      const result = await runCli(
        ["list", "--project-name", "Open Emails", "--json"],
        root,
        server.url,
      );
      expect(result.exitCode).toBe(0);
    } finally {
      await server.stop();
    }
  });
});
