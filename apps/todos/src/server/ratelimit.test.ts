import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── M6: the rate limiter must key on the real socket peer, not spoofable
// client headers. Bun.serve never sets x-forwarded-for for direct connections,
// so trusting it (a) collapses every direct client into one bucket and
// (b) lets an attacker bypass the limiter by rotating a forged XFF value.
// This test proves rotating XFF no longer creates independent buckets.

let port: number;
let proc: ReturnType<typeof Bun.spawn>;
let tmpDir: string;
let dbPath: string;

const RATE_LIMIT_MAX = 5;
const SERVER_HOOK_TIMEOUT_MS = 15_000;

function reserveFreePort(start: number): number {
  for (let candidate = start; candidate < start + 100; candidate++) {
    try {
      const server = Bun.serve({ port: candidate, hostname: "127.0.0.1", fetch: () => new Response("") });
      server.stop(true);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`No free test port found starting at ${start}`);
}

function url(path: string): string {
  return `http://localhost:${port}${path}`;
}

beforeAll(async () => {
  port = reserveFreePort(19700 + Math.floor(Math.random() * 100));
  tmpDir = await mkdtemp(join(tmpdir(), "todos-ratelimit-test-"));
  dbPath = join(tmpDir, "test.db");

  proc = Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts", `--port=${port}`, "--no-open"],
    cwd: join(import.meta.dir, "..", ".."),
    env: {
      ...process.env,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      TODOS_NO_OPEN: "true",
      TODOS_RATE_LIMIT_MAX: String(RATE_LIMIT_MAX),
      // Ensure proxy header trust is OFF (default), so XFF must be ignored.
      TODOS_TRUST_PROXY: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      // /health is unauthenticated; a 200 or 429 both mean the server is up.
      const res = await fetch(url("/health"));
      if (res.status === 200 || res.status === 429) {
        ready = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error(`Rate-limit test server did not start on port ${port}`);
}, SERVER_HOOK_TIMEOUT_MS);

afterAll(async () => {
  proc.kill();
  await proc.exited;
  await rm(tmpDir, { recursive: true, force: true });
}, SERVER_HOOK_TIMEOUT_MS);

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
