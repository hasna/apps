/**
 * Regression coverage for the port of the list-filter and search capabilities to
 * the hosted (/v1) backend.
 *
 * Before the port, `ApiStore.listFiles` forwarded only a subset of the local
 * filter surface (source/machine/project/tag/ext/status) and dropped
 * collection/date/size/sort on the floor, while `ApiStore.searchFiles` refused
 * `--scope content` outright because the derived-content FTS index was on-box
 * only. Both capabilities now exist on the hosted path: the server /v1/files
 * route implements the richer filters and a ranked metadata+content search over
 * `file_search_documents`, and derived content documents can be written through
 * `/v1/files/:id/search-documents`.
 *
 * These tests pin the CLIENT half: every filter the CLI accepts must reach the
 * server query string, the content scope must be served rather than refused,
 * and the search-document write/read/delete verbs must route through the API.
 */
import { describe, expect, it } from "bun:test";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import { ApiStore } from "./api-store.js";

function transportRecordingQueries(): { transport: HasnaHttpTransport; queries: Array<Record<string, unknown>> } {
  const queries: Array<Record<string, unknown>> = [];
  const file = {
    id: "f_1", source_id: "src_1", machine_id: "m_1",
    path: "/docs/cert.pdf", name: "cert.pdf", ext: ".pdf",
    size: 1, mime: "application/pdf", status: "active",
    indexed_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z",
    tags: [],
  };
  const transport = {
    baseUrl: "https://files.example.invalid/v1",
    get: async (_path: string, opts?: { query?: Record<string, unknown> }) => {
      queries.push({ ...(opts?.query ?? {}) });
      return { items: [file] };
    },
    post: async () => ({}),
    put: async () => ({}),
    patch: async () => ({}),
    del: async () => ({}),
  } as unknown as HasnaHttpTransport;
  return { transport, queries };
}

describe("ApiStore listFiles — every filter the CLI accepts reaches /v1/files", () => {
  it("forwards the collection/date/size/sort filter subset (port of the local-only filters)", async () => {
    const { transport, queries } = transportRecordingQueries();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.listFiles({
      collection_id: "col_1",
      after: "2026-06-01",
      before: "2026-06-30",
      min_size: 1024,
      max_size: 2048,
      sort: "size",
      sort_dir: "asc",
      limit: 25,
      offset: 10,
    });

    expect(queries).toEqual([
      {
        source_id: undefined,
        machine_id: undefined,
        project_id: undefined,
        tag: undefined,
        ext: undefined,
        status: undefined,
        collection_id: "col_1",
        after: "2026-06-01",
        before: "2026-06-30",
        min_size: 1024,
        max_size: 2048,
        sort: "size",
        sort_dir: "asc",
        limit: 25,
        offset: 10,
      },
    ]);
  });

  it("forwards search_scope on searchFiles together with the term and the tag filter", async () => {
    const { transport, queries } = transportRecordingQueries();
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await store.searchFiles("warehouse", { tag: "legal", search_scope: "content", limit: 10 });

    expect(queries).toHaveLength(1);
    const forwarded = queries[0]!;
    expect(forwarded.q).toBe("warehouse");
    expect(forwarded.search_scope).toBe("content");
    expect(forwarded.tag).toBe("legal");
  });
});

describe("CLI hosted list/search — the verbs work against the /v1 backend", () => {
  const cliPath = join(process.cwd(), "src/cli/index.tsx");

  /** Run the CLI with stdout/stderr redirected to files (the api-pagination
   *  test's proven spawn shape — pipe-spawn of the CLI stalls in this runtime
   *  for verb combinations that keep the API transport open). */
  async function runCli(args: string[], env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const stdoutPath = join(process.cwd(), "..", "..", `.tmp-cli-${Math.random().toString(36).slice(2)}.out`);
    const stderrPath = join(process.cwd(), "..", "..", `.tmp-cli-${Math.random().toString(36).slice(2)}.err`);
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    const child = Bun.spawn(["bun", "run", cliPath, ...args], {
      cwd: process.cwd(),
      env,
      stdout: stdoutFd,
      stderr: stderrFd,
    });
    const exitCode = await child.exited;
    closeSync(stdoutFd);
    closeSync(stderrFd);
    const stdout = readFileSync(stdoutPath, "utf8");
    const stderr = readFileSync(stderrPath, "utf8");
    rmSync(stdoutPath, { force: true });
    rmSync(stderrPath, { force: true });
    return { exitCode, stdout, stderr };
  }

  it("files list forwards collection/date/size/sort to the hosted backend", async () => {
    const received: Array<Record<string, string>> = [];
    const files = [
      { id: "f_1", source_id: "src_1", machine_id: "m_1", path: "/a.pdf", name: "a.pdf", ext: ".pdf", size: 3, mime: "application/pdf", status: "active", indexed_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", tags: [] },
      { id: "f_2", source_id: "src_1", machine_id: "m_1", path: "/b.pdf", name: "b.pdf", ext: ".pdf", size: 1, mime: "application/pdf", status: "active", indexed_at: "2026-01-02T00:00:00.000Z", created_at: "2026-01-02T00:00:00.000Z", tags: [] },
    ];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== "/v1/files") return Response.json({ error: "not found" }, { status: 404 });
        received.push(Object.fromEntries(url.searchParams.entries()));
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Response.json(files.slice(offset, offset + limit));
      },
    });

    try {
      const out = await runCli([
        "list",
        "--collection", "col_1",
        "--after", "2026-06-01",
        "--min-size", "1kb",
        "--sort", "size",
        "--asc",
        "--json",
      ], {
        PATH: process.env.PATH ?? "",
        HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_FILES_API_KEY: String(server.port),
        NO_COLOR: "1",
      });
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe("");
      expect(JSON.parse(out.stdout)).toHaveLength(2);
      const query = received[0]!;
      expect(query.collection_id).toBe("col_1");
      expect(query.after).toBe("2026-06-01");
      expect(query.min_size).toBe("1024");
      expect(query.sort).toBe("size");
      expect(query.sort_dir).toBe("asc");
    } finally {
      server.stop(true);
    }
  });

  it("files search --scope content is served by the hosted backend with rank (no refusal)", async () => {
    const received: Array<Record<string, string>> = [];
    const results = [
      { id: "f_1", source_id: "src_1", machine_id: "m_1", path: "/docs/lease.pdf", name: "lease.pdf", ext: ".pdf", size: 3, mime: "application/pdf", status: "active", indexed_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", tags: [], rank: 0.87, search_match_sources: ["content"], search_document_kinds: ["extracted_text"], search_document_count: 1 },
    ];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== "/v1/files") return Response.json({ error: "not found" }, { status: 404 });
        received.push(Object.fromEntries(url.searchParams.entries()));
        return Response.json(results);
      },
    });

    try {
      const out = await runCli(["search", "warehouse lease", "--scope", "content", "--json"], {
        PATH: process.env.PATH ?? "",
        HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_FILES_API_KEY: String(server.port),
        NO_COLOR: "1",
      });
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe("");
      const parsed = JSON.parse(out.stdout) as Array<{ rank: number; search_match_sources: string[] }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.rank).toBe(0.87);
      expect(parsed[0]!.search_match_sources).toEqual(["content"]);
      expect(received[0]!.q).toBe("warehouse lease");
      expect(received[0]!.search_scope).toBe("content");
    } finally {
      server.stop(true);
    }
  });

  it("files search-index add/list/remove route through the hosted backend", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "files-api-search-index-"));
    const artifactPath = join(testDir, "artifact.txt");
    writeFileSync(artifactPath, "Agent-visible summary for warehouse lease renewal.");
    const file = {
      id: "f_1", source_id: "src_1", machine_id: "m_1",
      path: "/docs/lease.pdf", name: "lease.pdf", ext: ".pdf",
      size: 3, mime: "application/pdf", status: "active",
      indexed_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z",
      tags: [],
    };
    const document = {
      id: "fsd_1", file_id: "f_1", source_ref: "open-files://file/f_1",
      kind: "llm_summary", extractor: "test-agent", content_hash: "sha256:abc",
      searchable_text: "Agent-visible summary for warehouse lease renewal.",
      metadata: {}, status: "ready", private: true,
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const received: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        received.push({ method: request.method, path: url.pathname });
        if (url.pathname === "/v1/files/f_1" && request.method === "GET") return Response.json(file);
        if (url.pathname === "/v1/files/f_1/search-documents" && request.method === "POST") return Response.json(document, { status: 201 });
        if (url.pathname === "/v1/search-documents" && request.method === "GET") return Response.json([document]);
        if (url.pathname === "/v1/search-documents/fsd_1" && request.method === "DELETE") return Response.json({ ok: true });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });

    try {
      const env = {
        PATH: process.env.PATH ?? "",
        HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
        HASNA_FILES_API_KEY: String(server.port),
        NO_COLOR: "1",
      };

      const add = await runCli(["search-index", "add", "f_1", "--text-file", artifactPath, "--kind", "llm_summary", "--extractor", "test-agent", "--json"], env);
      expect(add.exitCode).toBe(0);
      expect(add.stderr).toBe("");
      const added = JSON.parse(add.stdout) as { id: string };
      expect(added.id).toBe("fsd_1");
      expect(received.some((r) => r.method === "POST" && r.path === "/v1/files/f_1/search-documents")).toBe(true);

      const list = await runCli(["search-index", "list", "f_1", "--json"], env);
      expect(list.exitCode).toBe(0);
      expect(list.stderr).toBe("");
      expect(JSON.parse(list.stdout) as unknown[]).toHaveLength(1);
      expect(received.some((r) => r.method === "GET" && r.path === "/v1/search-documents")).toBe(true);

      const remove = await runCli(["search-index", "remove", "fsd_1", "--json"], env);
      expect(remove.exitCode).toBe(0);
      expect(remove.stderr).toBe("");
      expect(received.some((r) => r.method === "DELETE" && r.path === "/v1/search-documents/fsd_1")).toBe(true);
    } finally {
      server.stop(true);
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
