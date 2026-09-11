/**
 * Hosted `log_stats` must use the server aggregate rather than downloading the
 * log corpus. The real MCP process talks to the real `/v1` app over HTTP, so
 * this proves authority normalization, store selection, route ownership and
 * the preserved response contract together.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { QueryResultRow } from "pg";
import type { TypedQueryClient } from "../generated/storage-kit/index.ts";
import { buildCloudApp } from "../server/cloud/app.ts";
import { SIGNING_SECRET, tokenWith } from "../server/cloud/test-helpers.ts";

const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
const packageRoot = join(dirname(entry), "../..");
const now = Date.now();
const rows = [
  {
    level: "error",
    service: "api",
    timestamp: new Date(now).toISOString(),
  },
  {
    level: "fatal",
    service: "api",
    timestamp: new Date(now - 86_400_000).toISOString(),
  },
  {
    level: "info",
    service: null,
    timestamp: new Date(now - 2 * 86_400_000).toISOString(),
  },
];

const queryClient: TypedQueryClient = (() => {
  const run = async <T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => {
    if (!text.includes("WITH scoped_logs AS MATERIALIZED")) {
      throw new Error(`Unexpected aggregate SQL: ${text}`);
    }
    const since = Date.parse(String(params.at(-1)));
    const count = (values: string[]): Record<string, string> => {
      const counts = new Map<string, number>();
      for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
      return Object.fromEntries(
        [...counts].map(([key, value]) => [key, String(value)]),
      );
    };
    const times = rows
      .map((row) => Date.parse(row.timestamp))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    return [
      {
        total: String(rows.length),
        by_level: count(rows.map((row) => row.level)),
        by_service: count(rows.map((row) => row.service ?? "-")),
        by_day: count(
          times
            .filter((observedAt) => observedAt >= since)
            .map((observedAt) =>
              new Date(observedAt).toISOString().slice(0, 10),
            ),
        ),
        oldest: times[0] === undefined ? null : new Date(times[0]),
        newest:
          times.at(-1) === undefined ? null : new Date(times.at(-1)!),
      },
    ] as unknown as T[];
  };
  return {
    async query<T extends QueryResultRow>(text: string, params?: readonly unknown[]) {
      const result = await run<T>(text, params);
      return { rows: result, rowCount: result.length };
    },
    many: <T extends QueryResultRow>(text: string, params?: readonly unknown[]) =>
      run<T>(text, params),
    async get<T extends QueryResultRow>(text: string, params?: readonly unknown[]) {
      return (await run<T>(text, params))[0] ?? null;
    },
    async one<T extends QueryResultRow>(text: string, params?: readonly unknown[]) {
      const result = await run<T>(text, params);
      if (result.length !== 1) throw new Error("Expected one aggregate row");
      return result[0] as T;
    },
    async execute<T extends QueryResultRow>(text: string, params?: readonly unknown[]) {
      await run<T>(text, params);
    },
  };
})();

const cloud = buildCloudApp({
  client: queryClient,
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
    requests.push(`${request.method} ${url.pathname}${url.search}`);
    return cloud.fetch(request);
  },
});

afterAll(() => server.stop(true));

function childEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const key of [
    "HASNA_PROFILE",
    "HASNA_LOGS_API_URL",
    "HASNA_LOGS_API_KEY",
    "HASNA_LOGS_API_KEY_OVERRIDE",
    "HASNA_LOGS_API_KEY_REF",
    "HASNA_LOGS_LOCAL",
    "LOGS_LOCAL",
    "LOGS_API_URL",
    "LOGS_API_KEY",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    HOME: home,
    HASNA_STATION: "no-such-station",
    // The configured authority is the app base. The client appends /v1.
    HASNA_LOGS_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_LOGS_API_KEY: tokenWith(["logs:read"]),
  };
}

function dbFiles(home: string): string[] {
  return (readdirSync(home, { recursive: true }) as string[])
    .map(String)
    .filter((name) => /\.(db|sqlite|sqlite3)($|-)/.test(name));
}

function textContent(result: unknown): string {
  return (
    (result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? ""
  );
}

describe("log_stats hosted aggregate", () => {
  test("uses one /v1 aggregate request and preserves the seven-day response", async () => {
    const home = mkdtempSync(join(tmpdir(), "logs-mcp-stats-home-"));
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", entry],
      cwd: packageRoot,
      env: childEnv(home),
      stderr: "pipe",
    });
    const client = new Client(
      { name: "logs-stats-test", version: "0.0.0" },
      { capabilities: {} },
    );

    try {
      requests.length = 0;
      await client.connect(transport);
      const result = await client.callTool({
        name: "log_stats",
        arguments: {},
      });
      const body = JSON.parse(textContent(result)) as {
        total: number;
        by_level: Record<string, number>;
        top_services: Array<{ service: string; c: number }>;
        last_7_days: Array<{ day: string; c: number }>;
        error_rate_pct: number;
      };

      expect(requests).toEqual(["GET /v1/logs/stats?days=7"]);
      expect(body.total).toBe(3);
      expect(body.by_level).toEqual({ error: 1, fatal: 1, info: 1 });
      expect(body.top_services).toContainEqual({ service: "api", c: 2 });
      expect(body.last_7_days).toHaveLength(3);
      expect(body.error_rate_pct).toBe(66.67);
      expect(dbFiles(home)).toEqual([]);
    } finally {
      await client.close().catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
