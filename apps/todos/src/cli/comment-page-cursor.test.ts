import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

/**
 * Regression: `show`/`inspect` emitted `comments_page.next_cursor` and
 * `pagination_supported: true` while no verb could spend the cursor, so every
 * comment older than the newest page was unreachable from the CLI. Measured on
 * a live 125-comment task (`0ba8ff46`): page one carried the newest 100 and the
 * remaining 25 could not be read by any command.
 *
 * The mock below reproduces the SERVER semantics that were measured against the
 * live deployment rather than assumed: `getCommentsPage` returns the NEWEST
 * `limit` comments in ascending display order, `before` selects strictly older
 * rows, and `next_cursor` encodes the FIRST (oldest) element of the page so the
 * walk moves toward older history.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const TEST_API_KEY = "hasna_todos_test_key";
const TOTAL_COMMENTS = 125;
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function stderrWithoutAttributionWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.includes("ownerless and unattributable"))
    .filter((line) => !line.includes("filed with no project"))
    .join("\n")
    .trim();
}

async function runCli(args: string[], root: string, baseUrl: string) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
}),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

/** Ascending fixture: comment-000 is the oldest, comment-124 the newest. */
function allComments() {
  return Array.from({ length: TOTAL_COMMENTS }, (_, index) => ({
    id: `comment-${String(index).padStart(3, "0")}`,
    task_id: TASK_ID,
    agent_id: null,
    session_id: null,
    content: `comment body ${index}`,
    type: "comment" as const,
    progress_pct: null,
    created_at: `2026-07-10T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
  }));
}

function encodeCursor(comment: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ created_at: comment.created_at, id: comment.id }), "utf8")
    .toString("base64url");
}

function decodeCursor(value: string): { created_at: string; id: string } {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function currentGitRefDetailResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname === "/v1/openapi.json" && request.method === "GET") {
    return Response.json({
      openapi: "3.1.0",
      paths: {
        "/v1/tasks/{id}/refs": { get: {}, post: {} },
        "/v1/refs/{ref}": { get: {} },
      },
    });
  }
  if (url.pathname === `/v1/tasks/${TASK_ID}/refs` && request.method === "GET") {
    return Response.json({ refs: [], count: 0 });
  }
  return null;
}

function startServer(seen: string[]) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      seen.push(`${request.method} ${url.pathname}${url.search}`);
      const gitRefResponse = currentGitRefDetailResponse(request);
      if (gitRefResponse) return gitRefResponse;
      if (url.pathname === `/v1/tasks/${TASK_ID}` && request.method === "GET") {
        return Response.json({
          task: {
            id: TASK_ID,
            title: "Busy task",
            status: "in_progress",
            priority: "high",
            tags: [],
            version: 1,
            created_at: "2026-07-10T00:00:00.000Z",
            updated_at: "2026-07-10T00:00:00.000Z",
          },
        });
      }
      if (url.pathname === `/v1/tasks/${TASK_ID}/comments` && request.method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        const rawCursor = url.searchParams.get("cursor");
        const limit = rawLimit === null ? 100 : Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          return Response.json({ error: "limit must be an integer between 1 and 500" }, { status: 400 });
        }
        let rows = allComments();
        if (rawCursor) {
          let before: { created_at: string; id: string };
          try {
            before = decodeCursor(rawCursor);
          } catch {
            return Response.json({ error: "invalid comment cursor" }, { status: 400 });
          }
          rows = rows.filter((row) =>
            row.created_at < before.created_at ||
            (row.created_at === before.created_at && row.id < before.id));
        }
        // Newest `limit + 1` in ascending order, mirroring the measured server.
        const page = rows.slice(-(limit + 1));
        const hasMore = page.length > limit;
        const comments = hasMore ? page.slice(1) : page;
        return Response.json({
          comments,
          count: comments.length,
          has_more: hasMore,
          next_cursor: hasMore && comments[0] ? encodeCursor(comments[0]) : null,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
}

describe("comment page cursor has a consumer", () => {
  test("show walks the ENTIRE comment history through next_cursor", async () => {
    const seen: string[] = [];
    const server = startServer(seen);
    const root = mkdtempSync(join(tmpdir(), "todos-comment-cursor-walk-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const first = await runCli(["--json", "show", TASK_ID], root, baseUrl);
      expect(stderrWithoutAttributionWarning(first.stderr)).toBe("");
      expect(first.exitCode).toBe(0);
      const page1 = JSON.parse(first.stdout);

      // The default page is the NEWEST 100, ascending — the newest comment is
      // the LAST element and is already reachable today.
      expect(page1.comments).toHaveLength(100);
      // Newest 100 of 125 => comment-025 .. comment-124, ascending.
      expect(page1.comments[0].id).toBe("comment-025");
      expect(page1.comments[99].id).toBe("comment-124");
      expect(page1.comments_page).toMatchObject({ count: 100, has_more: true, pagination_supported: true });
      expect(typeof page1.comments_page.next_cursor).toBe("string");

      // The defect: that cursor must be spendable by the same command.
      const second = await runCli(
        ["--json", "show", TASK_ID, "--comments-cursor", page1.comments_page.next_cursor],
        root,
        baseUrl,
      );
      expect(stderrWithoutAttributionWarning(second.stderr)).toBe("");
      expect(second.exitCode).toBe(0);
      const page2 = JSON.parse(second.stdout);

      expect(page2.comments).toHaveLength(25);
      expect(page2.comments_page).toMatchObject({ has_more: false, next_cursor: null });
      // Page two is strictly OLDER, and the two pages together are the whole history.
      expect(page2.comments[0].id).toBe("comment-000");
      expect(page2.comments[24].id).toBe("comment-024");
      const walked = [...page2.comments, ...page1.comments].map((c: { id: string }) => c.id);
      expect(new Set(walked).size).toBe(TOTAL_COMMENTS);
      expect(walked).toEqual(allComments().map((c) => c.id));

      expect(seen).toContain(`GET /v1/tasks/${TASK_ID}/comments?limit=100`);
      expect(seen.some((line) => line.includes("cursor="))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("--comments-limit bounds the page and is sent to the server", async () => {
    const seen: string[] = [];
    const server = startServer(seen);
    const root = mkdtempSync(join(tmpdir(), "todos-comment-cursor-limit-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const result = await runCli(["--json", "show", TASK_ID, "--comments-limit", "1"], root, baseUrl);
      expect(stderrWithoutAttributionWarning(result.stderr)).toBe("");
      expect(result.exitCode).toBe(0);
      const task = JSON.parse(result.stdout);
      // limit=1 must return the single NEWEST comment — the probe that
      // discriminates "newest page" from "oldest page".
      expect(task.comments).toHaveLength(1);
      expect(task.comments[0].id).toBe("comment-124");
      expect(task.comments_page).toMatchObject({ count: 1, limit: 1, has_more: true });
      expect(seen).toContain(`GET /v1/tasks/${TASK_ID}/comments?limit=1`);
    } finally {
      server.stop(true);
    }
  });

  test("inspect accepts the same paging flags", async () => {
    const seen: string[] = [];
    const server = startServer(seen);
    const root = mkdtempSync(join(tmpdir(), "todos-comment-cursor-inspect-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const result = await runCli(["--json", "inspect", TASK_ID, "--comments-limit", "5"], root, baseUrl);
      expect(stderrWithoutAttributionWarning(result.stderr)).toBe("");
      expect(result.exitCode).toBe(0);
      const task = JSON.parse(result.stdout);
      expect(task.comments).toHaveLength(5);
      expect(task.comments[4].id).toBe("comment-124");
      expect(seen).toContain(`GET /v1/tasks/${TASK_ID}/comments?limit=5`);
    } finally {
      server.stop(true);
    }
  });

  test("an out-of-range limit and a malformed cursor fail with an actionable message", async () => {
    const seen: string[] = [];
    const server = startServer(seen);
    const root = mkdtempSync(join(tmpdir(), "todos-comment-cursor-invalid-"));
    tempRoots.push(root);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      for (const limit of ["0", "501", "abc"]) {
        const result = await runCli(["--json", "show", TASK_ID, "--comments-limit", limit], root, baseUrl);
        expect(result.exitCode).not.toBe(0);
        // "unknown option '--comments-limit'" would satisfy a loose /comments-limit/
        // match, so this asserts the VALIDATION message and explicitly refuses the
        // not-implemented message. Without this the case passes before the fix exists.
        expect(result.stderr).not.toMatch(/unknown option/i);
        expect(result.stderr).toMatch(/between 1 and 500/i);
      }
      const badCursor = await runCli(["--json", "show", TASK_ID, "--comments-cursor", "!!!not-base64!!!"], root, baseUrl);
      expect(badCursor.exitCode).not.toBe(0);
      expect(badCursor.stderr).not.toMatch(/unknown option/i);
      expect(badCursor.stderr).toMatch(/cursor/i);
    } finally {
      server.stop(true);
    }
  });

  // Spawns ~10 CLI processes; the 5s default is not enough on a loaded station.
  test("local store pages and emits a walkable cursor with the same semantics", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-comment-cursor-local-"));
    tempRoots.push(root);

    async function localCli(args: string[]) {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
        cwd: REPO_ROOT,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: root,
          TMPDIR: root,
          LANG: "C.UTF-8",
          TODOS_DB_PATH: join(root, "todos.db"),
          TODOS_AUTO_PROJECT: "false",
          // Fail-closed ruling (hasna/apps#1613): this env is built from scratch
          // (no ambient spread), so the local store needs the explicit opt-in.
          HASNA_TODOS_LOCAL: "1",
          TODOS_LOCAL: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      return { exitCode: await proc.exited, stdout, stderr };
    }

    const added = await localCli(["--json", "add", "Local paging task"]);
    expect(added.exitCode).toBe(0);
    const taskId = JSON.parse(added.stdout).id as string;

    for (let index = 0; index < 5; index += 1) {
      const commented = await localCli(["comment", taskId, `local comment ${index}`]);
      expect(commented.exitCode).toBe(0);
    }

    const page1 = await localCli(["--json", "show", taskId, "--comments-limit", "2"]);
    expect(page1.exitCode).toBe(0);
    const first = JSON.parse(page1.stdout);
    expect(first.comments).toHaveLength(2);
    // Newest-last ordering, same as cloud.
    expect(first.comments[1].content).toContain("local comment 4");
    expect(first.comments_page).toMatchObject({ count: 2, limit: 2, has_more: true });
    expect(typeof first.comments_page.next_cursor).toBe("string");

    const page2 = await localCli([
      "--json", "show", taskId,
      "--comments-limit", "2",
      "--comments-cursor", first.comments_page.next_cursor,
    ]);
    expect(page2.exitCode).toBe(0);
    const second = JSON.parse(page2.stdout);
    expect(second.comments).toHaveLength(2);
    expect(second.comments[1].content).toContain("local comment 2");
    expect(second.comments[0].content).toContain("local comment 1");

    // Without the flags the local shape is unchanged: the complete history.
    const unbounded = await localCli(["--json", "show", taskId]);
    expect(unbounded.exitCode).toBe(0);
    expect(JSON.parse(unbounded.stdout).comments).toHaveLength(5);
  }, 60_000);
});
