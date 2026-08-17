// Shared stub server for the mementos cloud API's bounded-page contract
// (BUG 2796806b): single responses capped at 1000 rows with has_more /
// next_cursor / total. Used by the api-mode regression tests that assert a
// caller assembles the FULL population instead of silently taking one page.

import {
  API_URL_ENV_KEYS,
  API_KEY_ENV_KEYS,
  DATABASE_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS,
} from "../db/api-mode.js";

export interface MemoriesPageStub {
  server: ReturnType<typeof Bun.serve>;
  baseUrl: string;
  stop(): void;
}

/** Start a stub GET /v1/memories serving `rowCount` rows on capped pages. */
export function startMemoriesPageStub(rowCount: number): MemoriesPageStub {
  const memories = Array.from({ length: rowCount }, (_, i) => ({
    id: `mem-${String(i).padStart(5, "0")}`,
    key: `key-${i}`,
    value: `value ${i}`,
    importance: 1,
    scope: "shared",
    category: "knowledge",
    status: "active",
    created_at: "2026-08-17T00:00:00.000Z",
  }));
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/v1/memories") {
        const limit = Math.min(Number(u.searchParams.get("limit")) || 1000, 1000);
        const offset = Number(u.searchParams.get("offset")) || 0;
        const page = memories.slice(offset, offset + limit);
        const has_more = offset + page.length < memories.length;
        return Response.json({
          memories: page,
          count: page.length,
          total: memories.length,
          limit,
          has_more,
          next_cursor: has_more ? offset + page.length : null,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(),
  };
}

/**
 * A process env for API mode pointed at a loopback stub. All store selectors
 * are stripped first (the ambient environment on fleet machines carries the
 * production API selectors), then the stub URL + a dummy key are set.
 */
export function apiModeTestEnv(baseUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of Object.keys(process.env)) env[k] = process.env[k] ?? "";
  for (const k of [
    ...API_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...DATABASE_URL_ENV_KEYS,
    ...DB_PATH_ENV_KEYS,
  ]) {
    delete env[k];
  }
  env[API_URL_ENV_KEYS[0]] = baseUrl;
  env[API_KEY_ENV_KEYS[0]] = "test-key";
  return env;
}

export interface MemoriesPageStubProcess {
  port: number;
  baseUrl: string;
  stop(): void;
}

/**
 * Start the stub as a SEPARATE process. Required whenever the caller under
 * test runs in the same process that would host the stub: the CLI's cloud
 * reads are SYNCHRONOUS curl children (Bun.spawnSync), which deadlock against
 * an in-process server whose event loop the spawn blocks.
 */
export function startMemoriesPageStubProcess(
  rowCount: number,
): MemoriesPageStubProcess {
  const port = 39000 + Math.floor(Math.random() * 2000);
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      new URL("./memories-page-stub-server.ts", import.meta.url).pathname,
    ],
    {
      env: { ...process.env, STUB_PORT: String(port), STUB_ROWS: String(rowCount) },
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  // Wait for readiness by polling the health of the stub (async fetch from
  // this process is safe — the stub is a separate process).
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      proc.kill();
    },
  };
}

/** Poll the stub until it serves a page, or throw after ~5s. */
export async function waitForMemoriesPageStub(baseUrl: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${baseUrl}/v1/memories?limit=1`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`stub server at ${baseUrl} did not become ready`);
}
