/**
 * `logs stats` on the hosted path — the client half of the `/v1/logs/stats` port.
 *
 * The REAL CLI binary is spawned against a REAL listener on 127.0.0.1 serving
 * the REAL cloud `/v1` app, so a pass proves the whole chain: credential
 * resolution, `ApiStore.stats`, the route, and the rendering.
 *
 * The load-bearing assertion is the request LIST. `stats` used to issue
 * `GET /v1/logs?limit=100000` and fold up to 100k rows in the client; it must
 * now issue exactly one `GET /v1/logs/stats` and never touch `/v1/logs`.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { buildCloudApp } from "../server/cloud/app.ts";
import { SIGNING_SECRET, tokenWith } from "../server/cloud/test-helpers.ts";
import type { TypedQueryClient } from "../generated/storage-kit/index.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = Date.now();
const iso = (offsetDays: number): string =>
  new Date(NOW - offsetDays * 86_400_000).toISOString();

const data = [
  { level: "error", service: "api", timestamp: iso(0) },
  { level: "error", service: "api", timestamp: iso(1) },
  { level: "info", service: null, timestamp: iso(2) },
];

/** Answers exactly the four aggregates `statsSummary` issues. */
const client: TypedQueryClient = (() => {
  const run = async <T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => {
    if (text.includes("GROUP BY level")) {
      const counts = new Map<string, number>();
      for (const r of data) counts.set(r.level, (counts.get(r.level) ?? 0) + 1);
      return [...counts].map(([level, c]) => ({
        level,
        c: String(c),
      })) as unknown as T[];
    }
    if (text.includes("GROUP BY service")) {
      const counts = new Map<string | null, number>();
      for (const r of data)
        counts.set(r.service, (counts.get(r.service) ?? 0) + 1);
      return [...counts]
        .sort((a, b) => b[1] - a[1])
        .map(([service, c]) => ({ service, c: String(c) })) as unknown as T[];
    }
    if (text.includes("MIN(timestamp)")) {
      const times = data.map((r) => r.timestamp).sort();
      return [
        { oldest: times[0] ?? null, newest: times.at(-1) ?? null },
      ] as unknown as T[];
    }
    if (text.includes("GROUP BY day")) {
      const since = String(params.at(-1));
      const counts = new Map<string, number>();
      for (const r of data) {
        if (r.timestamp < since) continue;
        const d = r.timestamp.slice(0, 10);
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      return [...counts]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([d, c]) => ({ day: d, c: String(c) })) as unknown as T[];
    }
    throw new Error(`unexpected SQL in the stats lane: ${text}`);
  };
  return {
    async query<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      const rows = await run<T>(t, p);
      return { rows, rowCount: rows.length };
    },
    many: <T extends QueryResultRow>(t: string, p?: readonly unknown[]) =>
      run<T>(t, p),
    async get<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      return (await run<T>(t, p))[0] ?? null;
    },
    async one<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      const rows = await run<T>(t, p);
      if (rows.length !== 1) throw new Error("expected one row");
      return rows[0] as T;
    },
    async execute<T extends QueryResultRow>(t: string, p?: readonly unknown[]) {
      await run<T>(t, p);
    },
  };
})();

const cloud = buildCloudApp({
  client,
  version: "9.9.9",
  signingSecret: SIGNING_SECRET,
  keyStatus: async (): Promise<"active"> => "active",
});

const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}`);
    return cloud.fetch(request);
  },
});
afterAll(() => {
  server.stop(true);
});

/**
 * The spawn MUST be asynchronous: the `/v1` listener lives in this process, so
 * a synchronous child would block the loop that has to answer it.
 */
async function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...process.env,
    HASNA_STATION: "no-such-station",
    HASNA_PROFILE: undefined,
    HASNA_LOGS_API_URL: undefined,
    HASNA_LOGS_API_KEY: undefined,
    HASNA_LOGS_API_KEY_OVERRIDE: undefined,
    HASNA_LOGS_API_KEY_REF: undefined,
    HASNA_LOGS_LOCAL: undefined,
    LOGS_LOCAL: undefined,
    LOGS_API_URL: undefined,
    LOGS_API_KEY: undefined,
    NO_COLOR: "1",
    ...env,
  })) {
    if (value !== undefined) clean[key] = value;
  }
  const child = Bun.spawn(["bun", "src/cli/index.ts", ...args], {
    cwd: repoRoot,
    env: clean,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

function hosted(home: string): Record<string, string | undefined> {
  return {
    HOME: home,
    HASNA_LOGS_API_URL: `http://127.0.0.1:${server.port}/v1`,
    HASNA_LOGS_API_KEY: tokenWith(["logs:read", "logs:write"]),
  };
}

function dbFiles(home: string): string[] {
  return (readdirSync(home, { recursive: true }) as string[])
    .map(String)
    .filter((name) => /\.(db|sqlite|sqlite3)($|-)/.test(name));
}

describe("logs stats (hosted)", () => {
  test("issues GET /v1/logs/stats, renders the aggregate, opens no database", async () => {
    const home = mkdtempSync(join(tmpdir(), "logs-stats-home-"));
    try {
      requests.length = 0;
      const result = await runCli(["stats"], hosted(home));
      expect(result.status, result.stderr).toBe(0);

      // The whole point of the port: ONE aggregate request, and the corpus
      // route is never touched.
      expect(requests).toEqual(["GET /v1/logs/stats"]);
      expect(requests.some((r) => r === "GET /v1/logs")).toBe(false);

      expect(result.stdout).toContain("Log Volume Stats");
      expect(result.stdout).toContain("Total:      3");
      // 2 errors + 0 fatals of 3 rows.
      expect(result.stdout).toContain("66.67%");
      expect(result.stdout).toContain("Top Services:");
      expect(result.stdout).toContain("api");
      expect(result.stdout).toContain("Last 7 Days:");
      expect(dbFiles(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);

  test("--days is forwarded to the hosted aggregate", async () => {
    const home = mkdtempSync(join(tmpdir(), "logs-stats-home-"));
    try {
      requests.length = 0;
      const result = await runCli(["stats", "--days", "2"], hosted(home));
      expect(result.status, result.stderr).toBe(0);
      expect(requests).toEqual(["GET /v1/logs/stats"]);
      expect(result.stdout).toContain("Last 2 Days:");
      expect(dbFiles(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);

  test("without a credential it fails closed and reaches no route", async () => {
    const home = mkdtempSync(join(tmpdir(), "logs-stats-home-"));
    try {
      requests.length = 0;
      const result = await runCli(["stats"], { HOME: home });
      expect(result.status).not.toBe(0);
      expect(requests).toEqual([]);
      expect(dbFiles(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30000);
});
