import { describe, expect, test } from "bun:test";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function file(index: number) {
  return {
    id: `f_${String(index).padStart(3, "0")}`,
    source_id: "src_1",
    machine_id: "m_1",
    path: `/long/customer/contracts/${index}/final.pdf`,
    name: `final-${index}.pdf`,
    original_name: `Customer contract final ${index}.pdf`,
    canonical_name: `customer-contract-final-${index}.pdf`,
    ext: ".pdf",
    size: 20_000 + index,
    mime: "application/pdf",
    description: "x".repeat(1_000),
    hash: "a".repeat(64),
    status: "active",
    indexed_at: "2026-09-17T00:00:00.000Z",
    created_at: "2026-09-16T00:00:00.000Z",
    tags: ["legal", "customer"],
    rank: 0.9,
    search_match_sources: ["content"],
    search_document_kinds: ["extracted_text"],
    search_document_count: 1,
  };
}

describe("Files CLI compact machine output", () => {
  test("--json defaults to a compact page and --full preserves the legacy bare array", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => file(index));
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    try {
      const listed = await runCli(["list", "--json"], server.port);
      expect(listed.exitCode).toBe(0);
      const listPage = JSON.parse(listed.stdout) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(Array.isArray(listPage.items)).toBe(true);
      expect(listPage.items).toHaveLength(20);
      expect(listPage.items[0]).not.toHaveProperty("description");
      expect(listPage._meta).toMatchObject({ count: 20, has_more: true, next_offset: 20, max_bytes: 32_768 });
      expect(listPage._meta.next_cursor).toEqual(expect.any(String));
      expect(requests[0]?.searchParams.get("limit")).toBe("21");

      const legacyList = await runCli(["list", "--json", "--full"], server.port);
      const legacyListRows = JSON.parse(legacyList.stdout) as Array<Record<string, unknown>>;
      expect(Array.isArray(legacyListRows)).toBe(true);
      expect(legacyListRows).toHaveLength(21);
      expect(legacyListRows[0]).toHaveProperty("description");
      expect(requests[1]?.searchParams.get("limit")).toBe("50");

      const searched = await runCli(["search", "contract", "--json"], server.port);
      const searchPage = JSON.parse(searched.stdout) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(searchPage.items).toHaveLength(20);
      expect(searchPage.items[0]).toHaveProperty("rank");
      expect(searchPage._meta.next_cursor).toEqual(expect.any(String));
      expect(requests[2]?.searchParams.get("limit")).toBe("21");

      const legacySearch = await runCli(["search", "contract", "--json", "--full"], server.port);
      const legacySearchRows = JSON.parse(legacySearch.stdout) as Array<Record<string, unknown>>;
      expect(Array.isArray(legacySearchRows)).toBe(true);
      expect(legacySearchRows).toHaveLength(20);
      expect(legacySearchRows[0]).toHaveProperty("description");
      expect(requests[3]?.searchParams.get("limit")).toBe("20");

      const listDetail = await runCli(["list", "--json", "--detail", "compact"], server.port);
      expect(listDetail.exitCode).toBe(0);
      expect((JSON.parse(listDetail.stdout) as { _meta: { detail: string } })._meta.detail).toBe("compact");

      const detailWithoutJson = await runCli(["search", "contract", "--detail", "compact"], server.port);
      expect(detailWithoutJson.exitCode).toBe(1);
      expect(detailWithoutJson.stderr).toContain("require --json");
    } finally {
      server.stop(true);
    }
  });

  test("list uses /v1, over-fetches one row, and emits a minified continuation receipt", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => file(index));
    const requests: Array<{ url: URL; authenticated: boolean }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const expected = `fixture-${server.port}`;
        requests.push({
          url,
          authenticated: request.headers.get("x-api-key") === expected
            && request.headers.get("authorization") === `Bearer ${expected}`,
        });
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    try {
      const result = await runCli(["list", "--limit", "20", "--agent-json"], server.port);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.replace(/^\[files\] DEPRECATED:.*\n/gm, "")).toBe("");
      expect(result.stdout.trim()).not.toContain("\n");
      expect(Buffer.byteLength(result.stdout)).toBeLessThan(8_000);
      const page = JSON.parse(result.stdout) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(page.items).toHaveLength(20);
      expect(page.items[0]).toEqual({
        id: "f_000",
        name: "final-0.pdf",
        path: "/long/customer/contracts/0/final.pdf",
        ext: ".pdf",
        size: 20_000,
        mime: "application/pdf",
        status: "active",
        source_id: "src_1",
      });
      expect(page._meta).toMatchObject({ count: 20, limit: 20, offset: 0, next_offset: 20, has_more: true, complete: false, detail: "compact", max_bytes: 32_768, byte_limited: false });
      expect(page._meta.byte_length).toBe(Buffer.byteLength(result.stdout));
      expect(result.stdout).toBe(`${JSON.stringify(page)}\n`);
      expect(requests[0]?.url.pathname).toBe("/v1/files");
      expect(requests[0]?.url.searchParams.get("limit")).toBe("21");
      expect(requests[0]?.authenticated).toBe(true);

      const nextCursor = String(page._meta.next_cursor);
      const final = await runCli(["list", "--limit", "20", "--cursor", nextCursor, "--json"], server.port);
      const finalPage = JSON.parse(final.stdout) as { items: Array<{ id: string }>; _meta: Record<string, unknown> };
      expect(finalPage.items.map((item) => item.id)).toEqual(["f_020"]);
      expect(finalPage._meta).toMatchObject({ count: 1, offset: 20, next_offset: null, has_more: false, end_reached: true, complete: false, cursor: nextCursor, next_cursor: null });
      expect(requests.at(-1)?.url.searchParams.get("offset")).toBe("20");

      const mismatched = await runCli(["list", "--source", "different", "--cursor", nextCursor, "--json"], server.port);
      expect(mismatched.exitCode).toBe(1);
      expect(mismatched.stderr).toContain("does not match this query");
    } finally {
      server.stop(true);
    }
  });

  test("search supports field projection and full detail explicitly", async () => {
    const rows = [file(1), file(2)];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(rows) });
    try {
      const projected = await runCli(["search", "contract", "--agent-json", "--fields", "name,rank"], server.port);
      expect(projected.exitCode).toBe(0);
      const projectedPage = JSON.parse(projected.stdout) as { items: Array<Record<string, unknown>>; _meta: { fields: string[] } };
      expect(projectedPage.items[0]).toEqual({ id: "f_001", name: "final-1.pdf", rank: 0.9 });
      expect(projectedPage._meta.fields).toEqual(["id", "name", "rank"]);

      const full = await runCli(["search", "contract", "--limit", "1", "--agent-json", "--detail", "full"], server.port);
      expect(full.exitCode).toBe(0);
      const fullPage = JSON.parse(full.stdout) as { items: Array<Record<string, unknown>>; _meta: Record<string, unknown> };
      expect(fullPage.items[0]).toHaveProperty("description");
      expect(fullPage._meta).toMatchObject({ detail: "full", has_more: true, next_offset: 1 });

      const invalid = await runCli(["search", "contract", "--agent-json", "--detail", "full", "--fields", "name"], server.port);
      expect(invalid.exitCode).toBe(1);
      expect(invalid.stderr).toContain("fields cannot be combined with detail=full");

      const missingJson = await runCli(["search", "contract", "--fields", "name"], server.port);
      expect(missingJson.exitCode).toBe(1);
      expect(missingJson.stderr).toContain("require --json");

      const fullWithBudget = await runCli(["search", "contract", "--agent-json", "--detail", "full", "--max-bytes", "4096"], server.port);
      expect(fullWithBudget.exitCode).toBe(1);
      expect(fullWithBudget.stderr).toContain("--max-bytes cannot be combined with --detail full");
    } finally {
      server.stop(true);
    }
  });

  test("pretty output honors the exact byte ceiling and compact pages refuse unbounded limits", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...file(index),
      path: `/${"long-folder/".repeat(150)}${index}.pdf`,
    }));
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests++;
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    try {
      const pretty = await runCli(["list", "--agent-json", "--pretty", "--max-bytes", "4096"], server.port);
      expect(pretty.exitCode).toBe(0);
      const page = JSON.parse(pretty.stdout) as { items: unknown[]; _meta: Record<string, unknown> };
      expect(Buffer.byteLength(pretty.stdout)).toBeLessThanOrEqual(4096);
      expect(page._meta.byte_length).toBe(Buffer.byteLength(pretty.stdout));
      expect(page._meta.byte_limited).toBe(true);
      expect(page._meta.truncated_fields).toContain("path");

      const before = requests;
      const refused = await runCli(["list", "--agent-json", "--limit", "501"], server.port);
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("JSON page limit must be <= 500");
      expect(requests).toBe(before);
    } finally {
      server.stop(true);
    }
  });

  test("--all exhausts from offset zero with hard row/byte safety and a whole-query receipt", async () => {
    const rows = Array.from({ length: 1_001 }, (_, index) => file(index));
    const requests: Array<{ limit: number; offset: number }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        requests.push({ limit, offset });
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    try {
      const result = await runCli([
        "list", "--agent-json", "--all", "--max-bytes", "1048576",
      ], server.port);
      expect(result.exitCode).toBe(0);
      const page = JSON.parse(result.stdout) as { items: unknown[]; _meta: Record<string, unknown> };
      expect(page.items).toHaveLength(1_001);
      expect(page._meta).toMatchObject({
        count: 1_001,
        limit: 5_000,
        offset: 0,
        next_offset: null,
        has_more: false,
        end_reached: true,
        complete: true,
        all: true,
      });
      expect(requests).toEqual([
        { limit: 500, offset: 0 },
        { limit: 500, offset: 500 },
        { limit: 500, offset: 1_000 },
      ]);

      requests.length = 0;
      const searched = await runCli([
        "search", "contract", "--agent-json", "--all", "--max-bytes", "1048576",
      ], server.port);
      expect(searched.exitCode).toBe(0);
      expect((JSON.parse(searched.stdout) as { _meta: Record<string, unknown> })._meta).toMatchObject({
        count: 1_001,
        complete: true,
        all: true,
      });
      expect(requests).toEqual([
        { limit: 500, offset: 0 },
        { limit: 500, offset: 500 },
        { limit: 500, offset: 1_000 },
      ]);

      const legacyAll = await runCli(["list", "--json", "--full", "--all"], server.port);
      expect(legacyAll.exitCode).toBe(1);
      expect(legacyAll.stderr).toContain("--full cannot be combined");

      const offsetAll = await runCli(["list", "--agent-json", "--all", "--offset", "1"], server.port);
      expect(offsetAll.exitCode).toBe(1);
      expect(offsetAll.stderr).toContain("--all requires offset 0");

      const tooSmall = await runCli(["list", "--agent-json", "--all", "--max-bytes", "1024"], server.port);
      expect(tooSmall.exitCode).toBe(1);
      expect(tooSmall.stdout).toBe("");
      expect(tooSmall.stderr).toContain("use paginated --json output");
    } finally {
      server.stop(true);
    }
  });

  test("human list and search preserve logical reads above the 500-row machine cap", async () => {
    const rows = Array.from({ length: 502 }, (_, index) => file(index));
    const requests: Array<{ limit: number; offset: number; query: string | null }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        requests.push({ limit, offset, query: url.searchParams.get("q") });
        return Response.json(rows.slice(offset, offset + limit));
      },
    });
    try {
      const listed = await runCli(["list", "--limit", "501"], server.port);
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toContain("501 file(s)");
      expect(requests.slice(0, 2)).toEqual([
        { limit: 500, offset: 0, query: null },
        { limit: 1, offset: 500, query: null },
      ]);

      const searched = await runCli(["search", "contract", "--limit", "501"], server.port);
      expect(searched.exitCode).toBe(0);
      expect(searched.stdout).toContain("501 result(s)");
      expect(requests.slice(2).map(({ limit, offset, query }) => ({ limit, offset, query }))).toEqual([
        { limit: 500, offset: 0, query: "contract" },
        { limit: 1, offset: 500, query: "contract" },
      ]);
      expect(requests.every((request) => request.limit <= 500)).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});

async function runCli(args: string[], port: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), "files-cli-output-"));
  const stdoutPath = join(dir, "stdout");
  const stderrPath = join(dir, "stderr");
  const stdoutFd = openSync(stdoutPath, "w");
  const stderrFd = openSync(stderrPath, "w");
  try {
    const child = Bun.spawn([process.execPath, "src/cli/index.tsx", ...args], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        HASNA_HOME: dir,
        HASNA_FILES_API_URL: `http://127.0.0.1:${port}`,
        HASNA_FILES_API_KEY: `fixture-${port}`,
        HASNA_STATION: "files-output-no-such-station",
        NO_COLOR: "1",
      },
      stdout: stdoutFd,
      stderr: stderrFd,
    });
    const exitCode = await child.exited;
    closeSync(stdoutFd);
    closeSync(stderrFd);
    return {
      exitCode,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
