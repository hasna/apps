import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");

// A stand-in cloud API that cannot decrypt the stored value. The server must use
// the typed 422 contract, and the CLI must turn it into actionable recovery text
// rather than dumping a raw HasnaHttpError stack trace.
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        JSON.stringify({
          error: "Encrypted vault data cannot be decrypted with the configured master key.",
          code: "VAULT_DECRYPTION_FAILED",
          recovery: "Restore HASNA_SECRETS_MASTER_KEY, or recreate the affected entry.",
        }),
        { status: 422, headers: { "content-type": "application/json" } },
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

describe("CLI get — decryption failure handling", () => {
  it("prints actionable recovery guidance and exits non-zero without leaking a stack trace", async () => {
    const { stdout, stderr, exitCode } = await runGet();

    // Non-zero exit, like the "Not found" path.
    expect(exitCode).toBe(1);

    // Clean, actionable one-liner that names the key. Value material never leaks.
    expect(stderr).toContain("Unable to read secret");
    expect(stderr).toContain("hasna/cerebras/live/api_key");
    expect(stderr).toContain("Recovery: Restore HASNA_SECRETS_MASTER_KEY");

    // The defect being fixed: the raw exception + Bun source frames must NOT leak.
    expect(stderr).not.toContain("HasnaHttpError");
    expect(stderr).not.toMatch(/\n\s+at\s/); // no JS stack frames
    expect(stderr).not.toContain("missing sourcemaps");
    expect(stderr).not.toContain("index.js");

    // A failed read prints nothing to stdout.
    expect(stdout).toBe("");
  }, 20_000);
});
