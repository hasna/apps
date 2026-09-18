import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];
const TEST_KEY = "[REDACTED_SECRET]";

function task(index: number, descriptionBytes = 200) {
  const stamp = new Date(Date.UTC(2026, 8, 18, 12, 0, 0) - index * 1_000).toISOString();
  return {
    id: `task-${String(index).padStart(5, "0")}`,
    short_id: `T${index}`,
    title: `Task ${index} ${"x".repeat(80)}`,
    description: "d".repeat(descriptionBytes),
    status: "pending",
    priority: "medium",
    assigned_to: null,
    project_id: null,
    task_list_id: null,
    created_at: stamp,
    updated_at: stamp,
    tags: [],
    metadata: { note: "y".repeat(120) },
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(args: string[], baseUrl: string) {
  const home = mkdtempSync(join(tmpdir(), "todos-list-efficiency-"));
  tempRoots.push(home);
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: ROOT,
    env: deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: home,
      LANG: "C.UTF-8",
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_KEY,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

function pagedServer(rows: ReturnType<typeof task>[]) {
  const requests: URL[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      if (url.pathname !== "/todos/v1/tasks") {
        return Response.json({ error: `unexpected route ${url.pathname}` }, { status: 404 });
      }
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? String(rows.length));
      return Response.json({
        tasks: rows.slice(offset, offset + limit),
        count: Math.max(0, Math.min(limit, rows.length - offset)),
        total: rows.length,
      });
    },
  });
  return { server, requests };
}

describe("todos list token-efficient pagination", () => {
  test("omitted limit is a <=50 page with truthful continuation and consecutive pages never overlap", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => task(index));
    const { server, requests } = pagedServer(rows);
    const baseUrl = `http://127.0.0.1:${server.port}/todos`;
    try {
      const first = await runCli(["--json", "list", "--status", "pending", "--format", "json"], baseUrl);
      expect(first).toMatchObject({ exitCode: 0, stderr: "" });
      expect(Buffer.byteLength(first.stdout)).toBeLessThanOrEqual(65_536);
      const firstPage = JSON.parse(first.stdout) as {
        tasks: Array<{ id: string }>;
        count: number;
        total: number;
        limit: number;
        offset: number;
        has_more: boolean;
        next_offset: number | null;
        complete: boolean;
        byte_length: number;
      };
      expect(firstPage).toMatchObject({
        count: 50,
        total: 1_001,
        limit: 50,
        offset: 0,
        has_more: true,
        next_offset: 50,
        complete: false,
      });
      expect(firstPage.tasks).toHaveLength(50);
      expect(firstPage.byte_length).toBe(Buffer.byteLength(first.stdout));

      const second = await runCli([
        "--json", "list", "--status", "pending", "--offset", String(firstPage.next_offset), "--format", "json",
      ], baseUrl);
      expect(second).toMatchObject({ exitCode: 0, stderr: "" });
      const secondPage = JSON.parse(second.stdout) as typeof firstPage;
      expect(secondPage).toMatchObject({ offset: 50, count: 50, total: 1_001, next_offset: 100, has_more: true });
      expect(new Set(firstPage.tasks.map((row) => row.id)).intersection(new Set(secondPage.tasks.map((row) => row.id))).size).toBe(0);

      const listRequests = requests.filter((url) => url.searchParams.get("limit") !== "1");
      expect(listRequests.map((url) => url.searchParams.get("limit"))).toEqual(["50", "50"]);
      expect(listRequests.map((url) => url.searchParams.get("offset"))).toEqual(["0", "50"]);
      expect(requests.every((url) => url.pathname === "/todos/v1/tasks")).toBe(true);
      expect(requests.every((url) => !url.pathname.includes("/v1/v1/"))).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("compact output carries truthful total/has_more/next_offset metadata", async () => {
    const rows = Array.from({ length: 75 }, (_, index) => task(index));
    const { server } = pagedServer(rows);
    try {
      const result = await runCli([
        "list", "--status", "pending", "--format", "compact", "--limit", "20", "--offset", "20",
      ], `http://127.0.0.1:${server.port}/todos`);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("T20 pending");
      expect(result.stdout).toContain("count=20");
      expect(result.stdout).toContain("total=75");
      expect(result.stdout).toContain("has_more=true");
      expect(result.stdout).toContain("next_offset=40");
    } finally {
      server.stop(true);
    }
  });

  test("--all exhausts >1000 rows only inside hard row and byte budgets", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => task(index, 40));
    const { server, requests } = pagedServer(rows);
    try {
      const result = await runCli(["--json", "list", "--all", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_048_576);
      const payload = JSON.parse(result.stdout) as { tasks: unknown[]; count: number; total: number; has_more: boolean; next_offset: null; complete: boolean | null; all: boolean };
      expect(payload).toMatchObject({ count: 1_001, total: 1_001, has_more: false, next_offset: null, complete: null, all: true });
      expect(payload.tasks).toHaveLength(1_001);
      expect(requests.map((url) => [url.searchParams.get("limit"), url.searchParams.get("offset")])).toEqual([
        ["500", "0"],
        ["500", "500"],
        ["500", "1000"],
      ]);
    } finally {
      server.stop(true);
    }

    const tooMany = Array.from({ length: 5_001 }, (_, index) => ({
      id: `t${index}`, title: "T", status: "pending", priority: "medium",
    })) as ReturnType<typeof task>[];
    const capped = pagedServer(tooMany);
    try {
      const refused = await runCli(["--json", "list", "--all", "--format", "json"], `http://127.0.0.1:${capped.server.port}/todos`);
      expect(refused.exitCode).not.toBe(0);
      expect(JSON.parse(refused.stdout)).toMatchObject({ error: expect.stringContaining("5000-row hard ceiling") });
      expect(refused.stderr).toContain("5000-row hard ceiling");
      expect(capped.requests.map((url) => url.searchParams.get("limit"))).toEqual(Array(11).fill("500"));
    } finally {
      capped.server.stop(true);
    }

    const huge = Array.from({ length: 30 }, (_, index) => task(index, 60_000));
    const byteCapped = pagedServer(huge);
    try {
      const refused = await runCli(["--json", "list", "--all", "--format", "json"], `http://127.0.0.1:${byteCapped.server.port}/todos`);
      expect(refused.exitCode).not.toBe(0);
      expect(JSON.parse(refused.stdout)).toMatchObject({ error: expect.stringContaining("1048576-byte hard ceiling") });
      expect(refused.stderr).toContain("1048576-byte hard ceiling");
    } finally {
      byteCapped.server.stop(true);
    }
  });
});

describe("todos list adversarial authority envelopes", () => {
  test("one response supplies page and total, so insert-between-probe/page cannot race", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => task(index));
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const url = new URL(request.url); requests.push(url);
        if (requests.length > 1) rows.unshift(task(9_999));
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        return Response.json({ tasks: rows.slice(offset, offset + limit), count: limit, total: rows.length, limit, offset, has_more: true, next_offset: offset + limit });
      },
    });
    try {
      const result = await runCli(["list", "--status", "pending", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(requests).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ count: 50, total: 100, requested_limit: 50, offset: 0, next_offset: 50 });
    } finally { server.stop(true); }
  });

  test("preserves server cap/offset and treats legacy completeness as unknown", async () => {
    let mode: "cap" | "legacy" = "cap";
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch() {
        if (mode === "legacy") return Response.json({ tasks: [task(0), task(1)], count: 2 });
        return Response.json({
          tasks: Array.from({ length: 20 }, (_, index) => task(index + 10)), count: 20, total: 100,
          limit: 20, cap: 20, offset: 10, has_more: true, next_offset: 30, complete: false,
        });
      },
    });
    try {
      const capped = await runCli(["list", "--status", "pending", "--limit", "50", "--offset", "10", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      expect(JSON.parse(capped.stdout)).toMatchObject({ count: 20, total: 100, requested_limit: 50, limit: 20, server_cap: 20, offset: 10, consumed: 20, has_more: true, next_offset: 30, complete: false });
      mode = "legacy";
      const legacy = await runCli(["list", "--status", "pending", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      expect(legacy).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(legacy.stdout)).toMatchObject({ count: 2, total: null, has_more: null, next_offset: 2, complete: null });
    } finally { server.stop(true); }
  });

  test("authority cursor prevents overlap across a concurrent insert", async () => {
    const original = Array.from({ length: 100 }, (_, index) => task(index));
    const snapshotRows = original.slice();
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const url = new URL(request.url); requests.push(url);
        if (url.searchParams.get("cursor") === "snap-A:50") {
          return Response.json({ tasks: snapshotRows.slice(50), count: 50, total: 100, limit: 50, offset: 50, has_more: false, next_offset: null, next_cursor: null, snapshot: "snap-A", complete: true });
        }
        original.unshift(task(9_999));
        return Response.json({ tasks: snapshotRows.slice(0, 50), count: 50, total: 100, limit: 50, offset: 0, has_more: true, next_offset: 50, next_cursor: "snap-A:50", snapshot: "snap-A", complete: false });
      },
    });
    try {
      const first = await runCli(["list", "--status", "pending", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      const firstPage = JSON.parse(first.stdout) as { tasks: Array<{ id: string }>; next_cursor: string };
      const second = await runCli(["list", "--status", "pending", "--cursor", firstPage.next_cursor, "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      const secondPage = JSON.parse(second.stdout) as { tasks: Array<{ id: string }>; complete: boolean };
      expect(requests.map((url) => url.searchParams.get("cursor"))).toEqual([null, "snap-A:50"]);
      expect(new Set(firstPage.tasks.map((row) => row.id)).intersection(new Set(secondPage.tasks.map((row) => row.id))).size).toBe(0);
      expect(secondPage.complete).toBe(true);
    } finally { server.stop(true); }
  });

  test("byte-trimmed snapshot pages re-page at the authority cursor without overlap or skips under mutation", async () => {
    const snapshotRows = Array.from({ length: 37 }, (_, index) => task(index, 12_000));
    const liveRows = snapshotRows.slice();
    const requests: URL[] = [];
    let mutated = false;
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        const cursor = url.searchParams.get("cursor");
        const requestedSnapshot = url.searchParams.get("snapshot");
        const start = cursor?.startsWith("snap-large:")
          ? Number(cursor.slice("snap-large:".length))
          : Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const source = cursor || requestedSnapshot === "snap-large" ? snapshotRows : liveRows;
        const tasks = source.slice(start, start + limit);
        const consumed = tasks.length;
        const next = start + consumed;
        const hasMore = next < snapshotRows.length;
        const response = Response.json({
          tasks,
          count: consumed,
          total: snapshotRows.length,
          limit,
          offset: start,
          consumed,
          has_more: hasMore,
          next_offset: hasMore ? next : null,
          next_cursor: hasMore ? `snap-large:${next}` : null,
          snapshot: "snap-large",
          complete: !hasMore,
        });
        // Change the live ordering after the first 50-row request. The byte-fit
        // retry must name snap-large and reproduce the original prefix instead
        // of observing this insertion through a plain offset.
        if (!mutated) {
          mutated = true;
          liveRows.unshift(task(9_999, 12_000));
        }
        return response;
      },
    });

    try {
      const collected: string[] = [];
      let cursor: string | null = null;
      let pageCount = 0;
      do {
        const result = await runCli([
          "list", "--status", "pending", "--format", "json",
          ...(cursor ? ["--cursor", cursor] : []),
        ], `http://127.0.0.1:${server.port}/todos`);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(65_536);
        const page = JSON.parse(result.stdout) as {
          tasks: Array<{ id: string }>;
          count: number;
          requested_limit: number;
          limit: number;
          offset: number;
          consumed: number;
          has_more: boolean;
          next_offset: number | null;
          next_cursor: string | null;
          snapshot: string;
          byte_limited: boolean;
        };
        expect(page).toMatchObject({
          requested_limit: 50,
          count: page.tasks.length,
          consumed: page.tasks.length,
          snapshot: "snap-large",
        });
        expect(page.count).toBeGreaterThan(0);
        if (page.has_more) {
          expect(page.byte_limited).toBe(true);
          expect(page.limit).toBe(page.count);
          expect(page.next_cursor).toBe(`snap-large:${page.offset + page.consumed}`);
          expect(page.next_offset).toBe(page.offset + page.consumed);
        } else {
          expect(page.next_cursor).toBeNull();
          expect(page.next_offset).toBeNull();
        }
        collected.push(...page.tasks.map((row) => row.id));
        cursor = page.next_cursor;
        pageCount++;
        expect(pageCount).toBeLessThan(20);
      } while (cursor);

      expect(collected).toEqual(snapshotRows.map((row) => row.id));
      expect(new Set(collected).size).toBe(snapshotRows.length);
      expect(collected).not.toContain("task-09999");

      expect(requests[0]!.searchParams.get("limit")).toBe("50");
      expect(requests[0]!.searchParams.get("snapshot")).toBeNull();
      const byteFitRetries = requests.filter((url) => Number(url.searchParams.get("limit")) < 50);
      expect(byteFitRetries.length).toBeGreaterThan(0);
      expect(byteFitRetries.every((url) => url.searchParams.get("snapshot") === "snap-large")).toBe(true);
      expect(byteFitRetries[0]!.searchParams.get("offset")).toBe("0");
      expect(requests.some((url) => /^snap-large:\d+$/.test(url.searchParams.get("cursor") ?? ""))).toBe(true);
    } finally { server.stop(true); }
  });

  test("fails closed when an authority cannot reproduce a byte-limited snapshot prefix", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => task(index, 12_000));
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        calls++;
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const returned = calls === 1 ? rows.slice(0, limit) : [task(9_999, 12_000), ...rows].slice(0, limit);
        return Response.json({
          tasks: returned,
          count: returned.length,
          total: rows.length,
          limit,
          offset: 0,
          has_more: true,
          next_offset: returned.length,
          next_cursor: `snap-broken:${returned.length}`,
          snapshot: "snap-broken",
          complete: false,
        });
      },
    });
    try {
      const result = await runCli([
        "--json", "list", "--status", "pending", "--format", "json",
      ], `http://127.0.0.1:${server.port}/todos`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("could not reproduce the byte-limited task page");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: expect.stringContaining("task prefix changed at row 0"),
      });
      expect(calls).toBe(2);
    } finally { server.stop(true); }
  });

  test("fails closed when a smaller snapshot page keeps the original full-page continuation", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => task(index, 12_000));
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        calls++;
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const returned = rows.slice(0, limit);
        return Response.json({
          tasks: returned,
          count: returned.length,
          total: rows.length,
          limit,
          offset: 0,
          has_more: true,
          // This is the original ten-row boundary even when the retry returns
          // only five rows. Accepting it would skip the un-emitted rows 5-9.
          next_offset: 10,
          next_cursor: "snap-stale:10",
          snapshot: "snap-stale",
          complete: false,
        });
      },
    });
    try {
      const result = await runCli([
        "--json", "list", "--status", "pending", "--format", "json",
      ], `http://127.0.0.1:${server.port}/todos`);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("refusing an unsafe continuation");
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: expect.stringContaining("retained the original full-page next_cursor"),
      });
      expect(calls).toBe(2);
    } finally { server.stop(true); }
  });

  test("dedupes legacy multi-status totals and preserves empty compact stdout", async () => {
    const duplicate = task(0);
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const status = new URL(request.url).searchParams.get("status");
        if (status === "pending,in_progress") return Response.json({ tasks: [], count: 0, total: 0 });
        if (status === "pending" || status === "in_progress") return Response.json({ tasks: [duplicate], count: 1, total: 1, limit: 50, offset: 0, has_more: false, next_offset: null });
        return Response.json({ tasks: [], count: 0, total: 0 });
      },
    });
    try {
      const listed = await runCli(["list", "--format", "json"], `http://127.0.0.1:${server.port}/todos`);
      expect(JSON.parse(listed.stdout)).toMatchObject({ count: 1, total: 1, complete: null });
      const empty = await runCli(["list", "--status", "completed", "--format", "compact"], `http://127.0.0.1:${server.port}/todos`);
      expect(empty).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
    } finally { server.stop(true); }
  });

  test("legacy --json --all measures pretty output and refuses >1MiB before task data is written", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => task(index, 60_000));
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "500");
        return Response.json({ tasks: rows.slice(offset, offset + limit), count: Math.min(limit, rows.length - offset), total: rows.length, limit, offset, has_more: offset + limit < rows.length, next_offset: offset + limit < rows.length ? offset + limit : null });
      },
    });
    try {
      const result = await runCli(["--json", "list", "--all"], `http://127.0.0.1:${server.port}/todos`);
      expect(result.exitCode).not.toBe(0);
      const parsed = JSON.parse(result.stdout) as { error: string };
      expect(parsed.error).toContain("1048576-byte hard ceiling");
      expect(result.stdout.trimStart().startsWith("[")).toBe(false);
      expect(Buffer.byteLength(`${JSON.stringify(rows, null, 2)}\n`)).toBeGreaterThan(1_048_576);
    } finally { server.stop(true); }
  });
});
