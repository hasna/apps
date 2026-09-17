import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVER_HOOK_BUDGET_MS, startTestServer, type TestServer } from "../test/server-harness.js";

async function withServer(
  overrides: Record<string, string | undefined>,
  run: (server: TestServer, key: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "todos-budget-test-"));
  const key = crypto.randomUUID();
  let server: TestServer | undefined;
  try {
    server = await startTestServer({
      env: {
        TODOS_DB_PATH: join(directory, "test.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_SERVER_API_KEY: key,
        HASNA_TODOS_RATE_LIMIT_MAX: undefined,
        TODOS_RATE_LIMIT_MAX: undefined,
        TODOS_TRUST_PROXY: "0",
        ...overrides,
      },
    });
    await run(server, key);
  } finally {
    await server?.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

describe("HTTP request budget", () => {
  it("allows an authenticated burst beyond the former 120/minute limit while retaining auth", async () => {
    await withServer({}, async (server, key) => {
      const unauthorized = await fetch(server.url("/api/health"));
      expect(unauthorized.status).toBe(401);
      await unauthorized.arrayBuffer();
      const statuses: number[] = [];
      for (let index = 0; index < 150; index++) {
        const response = await fetch(server.url("/api/health"), { headers: { "x-api-key": key } });
        statuses.push(response.status);
        await response.arrayBuffer();
      }
      expect(statuses).toEqual(Array(150).fill(200));
    });
  }, SERVER_HOOK_BUDGET_MS);

  for (const [name, overrides] of [
    ["legacy override", { TODOS_RATE_LIMIT_MAX: "5" }],
    ["canonical precedence", { HASNA_TODOS_RATE_LIMIT_MAX: "5", TODOS_RATE_LIMIT_MAX: "20" }],
  ] as const) {
    it(`keeps the exact finite ${name} and Retry-After response`, async () => {
      await withServer(overrides, async (server, key) => {
        for (let index = 0; index < 6; index++) {
          const response = await fetch(server.url("/api/health"), {
            headers: { "x-api-key": key, "x-forwarded-for": `203.0.113.${index}`, "x-real-ip": `198.51.100.${index}` },
          });
          expect(response.status).toBe(index < 5 ? 200 : 429);
          if (index === 5) {
            const body = await response.json() as { retry_after: number };
            expect(body.retry_after).toBeGreaterThan(0);
            expect(body.retry_after).toBeLessThanOrEqual(60);
            expect(response.headers.get("Retry-After")).toBe(String(body.retry_after));
          } else await response.arrayBuffer();
        }
      });
    }, SERVER_HOOK_BUDGET_MS);
  }

  it("rejects an invalid budget before creating a database or accepting requests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "todos-budget-invalid-test-"));
    const databasePath = join(directory, "must-not-exist.db");
    let server: TestServer | undefined;
    let failure: unknown;
    try {
      try {
        server = await startTestServer({
          args: ["--allow-anonymous"],
          env: { TODOS_DB_PATH: databasePath, HASNA_TODOS_RATE_LIMIT_MAX: "NaN", TODOS_RATE_LIMIT_MAX: "5" },
        });
      } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toContain("HASNA_TODOS_RATE_LIMIT_MAX");
      expect(existsSync(databasePath)).toBe(false);
    } finally {
      await server?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, SERVER_HOOK_BUDGET_MS);
});
