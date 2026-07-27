import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SERVER_HOOK_BUDGET_MS,
  SERVER_STOP_BUDGET_MS,
  startTestServer,
  type TestServer,
} from "../test/server-harness.js";

// ── M6: the rate limiter must key on the real socket peer, not spoofable
// client headers. Bun.serve never sets x-forwarded-for for direct connections,
// so trusting it (a) collapses every direct client into one bucket and
// (b) lets an attacker bypass the limiter by rotating a forged XFF value.
// This test proves rotating XFF no longer creates independent buckets.

let server: TestServer;
let tmpDir: string;
let dbPath: string;

const RATE_LIMIT_MAX = 5;

function url(path: string): string {
  return server.url(path);
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-ratelimit-test-"));
  dbPath = join(tmpDir, "test.db");

  // Readiness comes from the server's own ready line rather than by polling
  // /health, which keeps liveness probing out of the budget this suite asserts
  // on: with TODOS_RATE_LIMIT_MAX=5, every probe request that reached the server
  // spent one of the 5 tokens the assertion below depends on.
  server = await startTestServer({
    // `--allow-anonymous` keeps this suite focused on route behavior: the server
    // now fails closed when no credential is configured, and auth itself is covered
    // by auth.test.ts + auth-fail-closed.test.ts.
    args: ["--allow-anonymous"],
    env: {
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      TODOS_RATE_LIMIT_MAX: String(RATE_LIMIT_MAX),
      // Ensure proxy header trust is OFF (default), so XFF must be ignored.
      TODOS_TRUST_PROXY: "0",
    },
  });
}, SERVER_HOOK_BUDGET_MS);

afterAll(async () => {
  await server?.stop();
  await rm(tmpDir, { recursive: true, force: true });
}, SERVER_STOP_BUDGET_MS);

describe("Rate limiter keying (M6)", () => {
  it("does not let a rotating X-Forwarded-For bypass the limit", async () => {
    // Fire well past the limit, each request carrying a unique fake XFF/real-ip.
    // If those headers keyed the limiter, every request would be its own bucket
    // and none would ever be throttled. Keying on the socket peer means they
    // all share one bucket and we must eventually see a 429.
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX + 5; i++) {
      const res = await fetch(url("/health"), {
        headers: {
          "x-forwarded-for": `203.0.113.${i}`,
          "x-real-ip": `198.51.100.${i}`,
        },
      });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
