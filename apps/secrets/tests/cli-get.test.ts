import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");

// A stand-in cloud API that always fails the value read with a 500, mirroring the
// real defect: the server returns 500 ("Unsupported state or unable to authenticate
// data") when it cannot decrypt a stored secret. ApiStore.getSecret rethrows any
// non-404 error, so the CLI `get` command must surface a clean one-line error
// rather than dumping a raw HasnaHttpError stack trace.
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        JSON.stringify({ error: "Unsupported state or unable to authenticate data" }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    },
  });
});

afterAll(() => {
  server.stop(true);
});

// Use async spawn (not spawnSync): the in-process mock server shares this event
// loop, and spawnSync would block it so the subprocess request could never be
// answered.
async function runGet() {
  const proc = Bun.spawn({
    cmd: ["bun", "src/index.ts", "get", "hasna/cerebras/live/api_key"],
    cwd: rootDir,
    env: {
      ...process.env,
      HASNA_SECRETS_STORAGE_MODE: "cloud",
      HASNA_SECRETS_API_URL: `http://localhost:${server.port}`,
      HASNA_SECRETS_API_KEY: "test-api-key",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("CLI get — API 500 handling", () => {
  it("prints a clean one-line error and exits non-zero without leaking a stack trace", async () => {
    const { stdout, stderr, exitCode } = await runGet();

    // Non-zero exit, like the "Not found" path.
    expect(exitCode).toBe(1);

    // Clean, actionable one-liner that names the key. Value material never leaks.
    expect(stderr).toContain("Unable to read secret");
    expect(stderr).toContain("hasna/cerebras/live/api_key");

    // The defect being fixed: the raw exception + Bun source frames must NOT leak.
    expect(stderr).not.toContain("HasnaHttpError");
    expect(stderr).not.toMatch(/\n\s+at\s/); // no JS stack frames
    expect(stderr).not.toContain("missing sourcemaps");
    expect(stderr).not.toContain("index.js");

    // A failed read prints nothing to stdout.
    expect(stdout).toBe("");
  }, 20_000);
});
