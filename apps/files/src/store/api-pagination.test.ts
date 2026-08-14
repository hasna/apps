import { describe, expect, test } from "bun:test";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import type { FileWithTags } from "../types/index.js";
import { ApiStore } from "./api-store.js";

const SERVER_PAGE_CAP = 500;

function syntheticFile(index: number): FileWithTags {
  // Deliberately shared by every row: the server must use `id` as the unique
  // tie-breaker or offset-backed pages can duplicate and omit boundary rows.
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id: `f_${String(index).padStart(4, "0")}`,
    source_id: "src_1",
    machine_id: "m_1",
    path: `/symbols/${String(index).padStart(4, "0")}.png`,
    name: `${String(index).padStart(4, "0")}.png`,
    ext: ".png",
    size: 1,
    mime: "image/png",
    status: "active",
    indexed_at: timestamp,
    created_at: timestamp,
    tags: [],
  };
}

function cappedFilesTransport(total: number): {
  transport: HasnaHttpTransport;
  queries: Array<Record<string, unknown>>;
} {
  const files = Array.from({ length: total }, (_, index) => syntheticFile(index));
  const queries: Array<Record<string, unknown>> = [];
  const transport = {
    baseUrl: "https://files.example.invalid/v1",
    async get(path: string, options?: { query?: Record<string, unknown> }) {
      if (path !== "/files") return {};
      const query = { ...(options?.query ?? {}) };
      queries.push(query);
      const requestedLimit = typeof query.limit === "number" ? query.limit : 50;
      const offset = typeof query.offset === "number" ? query.offset : 0;
      const servedLimit = Math.min(requestedLimit, SERVER_PAGE_CAP);
      return { items: files.slice(offset, offset + servedLimit) };
    },
    async post() { return {}; },
    async put() { return {}; },
    async patch() { return {}; },
    async del() { return {}; },
  } as unknown as HasnaHttpTransport;
  return { transport, queries };
}

describe("ApiStore listFiles logical limits", () => {
  test("a requested 1000 rows cannot look complete after a silent 500-row server cap", async () => {
    const { transport, queries } = cappedFilesTransport(1_200);
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const files = await store.listFiles({ source_id: "src_1", limit: 1_000, offset: 0 });

    expect(files).toHaveLength(1_000);
    expect(files[0]!.id).toBe("f_0000");
    expect(files.at(-1)!.id).toBe("f_0999");
    expect(queries).toEqual([
      { source_id: "src_1", limit: 500, offset: 0 },
      { source_id: "src_1", limit: 500, offset: 500 },
    ]);
  });

  test("preserves a non-zero offset across bounded internal pages", async () => {
    const { transport, queries } = cappedFilesTransport(1_200);
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const files = await store.listFiles({ source_id: "src_1", limit: 750, offset: 250 });

    expect(files).toHaveLength(750);
    expect(files[0]!.id).toBe("f_0250");
    expect(files.at(-1)!.id).toBe("f_0999");
    expect(queries).toEqual([
      { source_id: "src_1", limit: 500, offset: 250 },
      { source_id: "src_1", limit: 250, offset: 750 },
    ]);
  });

  test("stops on a short page when the source has fewer rows than requested", async () => {
    const { transport, queries } = cappedFilesTransport(620);
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const files = await store.listFiles({ source_id: "src_1", limit: 1_000, offset: 0 });

    expect(files).toHaveLength(620);
    expect(queries).toEqual([
      { source_id: "src_1", limit: 500, offset: 0 },
      { source_id: "src_1", limit: 500, offset: 500 },
    ]);
  });

  test("keeps one request for limits already within the server contract", async () => {
    const { transport, queries } = cappedFilesTransport(1_200);
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const files = await store.listFiles({ source_id: "src_1", limit: 125, offset: 75 });

    expect(files).toHaveLength(125);
    expect(queries).toEqual([{ source_id: "src_1", limit: 125, offset: 75 }]);
  });

  test("leaves invalid limits for the server to reject instead of returning an empty success", async () => {
    const transport = {
      baseUrl: "https://files.example.invalid/v1",
      async get(_path: string, options?: { query?: Record<string, unknown> }) {
        const limit = options?.query?.limit;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
          throw new Error("limit must be a positive integer");
        }
        return { items: [] };
      },
      async post() { return {}; },
      async put() { return {}; },
      async patch() { return {}; },
      async del() { return {}; },
    } as unknown as HasnaHttpTransport;
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    await expect(store.listFiles({ limit: Number.NaN })).rejects.toThrow(/limit/i);
  });

  test("the CLI emits one requested JSON array while the HTTP API serves bounded pages", async () => {
    const sourceFiles = Array.from({ length: 1_200 }, (_, index) => syntheticFile(index));
    const queries: Array<{ limit: number; offset: number }> = [];
    const outputDir = mkdtempSync(join(tmpdir(), "files-api-pagination-"));
    const stdoutPath = join(outputDir, "stdout.json");
    const stderrPath = join(outputDir, "stderr.txt");
    let stdoutFd = openSync(stdoutPath, "w");
    let stderrFd = openSync(stderrPath, "w");
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname !== "/v1/files") {
          return Response.json({ error: "not found" }, { status: 404 });
        }
        const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Math.min(requestedLimit, SERVER_PAGE_CAP);
        queries.push({ limit: requestedLimit, offset });
        return Response.json(sourceFiles.slice(offset, offset + limit));
      },
    });

    try {
      const child = Bun.spawn([
        process.execPath,
        "src/cli/index.tsx",
        "list",
        "--source",
        "src_1",
        "--limit",
        "1000",
        "--offset",
        "0",
        "--json",
      ], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH ?? "",
          HASNA_FILES_API_URL: `http://127.0.0.1:${server.port}`,
          HASNA_FILES_API_KEY: String(server.port),
          NO_COLOR: "1",
        },
        stdout: stdoutFd,
        stderr: stderrFd,
      });
      const exitCode = await child.exited;
      closeSync(stdoutFd);
      closeSync(stderrFd);
      stdoutFd = -1;
      stderrFd = -1;
      const stdout = readFileSync(stdoutPath, "utf8");
      const stderr = readFileSync(stderrPath, "utf8");

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      let files: FileWithTags[];
      try {
        files = JSON.parse(stdout) as FileWithTags[];
      } catch (error) {
        throw new Error(`CLI stdout was not one JSON array: ${JSON.stringify(stdout.slice(0, 240))}`, {
          cause: error,
        });
      }
      expect(files).toHaveLength(1_000);
      expect(files.at(-1)!.id).toBe("f_0999");
      expect(queries).toEqual([
        { limit: 500, offset: 0 },
        { limit: 500, offset: 500 },
      ]);
    } finally {
      if (stdoutFd >= 0) closeSync(stdoutFd);
      if (stderrFd >= 0) closeSync(stderrFd);
      server.stop(true);
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
