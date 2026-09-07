import { test, expect } from "bun:test";
import { join } from "path";

const CLI_ENTRY = join(import.meta.dir, "../index.ts"); // src/cli/index.ts

const PORT = 48000 + Math.floor(Math.random() * 2000);

async function runServe(...args: string[]): Promise<{ stdout: string; stderr: string; code: number; signal: string | null }> {
  const proc = Bun.spawn([process.execPath, "run", CLI_ENTRY, ...args], {
    cwd: join(import.meta.dir, "../../.."), // apps/attachments/
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // The serve command exits right after the server starts when this is set,
      // so the test does not need to signal the process.
      ATTACHMENTS_SERVE_EXIT_AFTER_START: "1",
    },
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  return { stdout, stderr, code: proc.exitCode ?? -1, signal: proc.signalCode ?? null, exitCode: proc.exitCode };
}

test("attachments serve starts the on-box HTTP server and reports the bind", async () => {
  const result = await runServe("serve", "--port", String(PORT));
  expect(result.code).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stdout).toContain(`attachments server running at http://localhost:${PORT} (on-box store)`);
  expect(result.stderr).toBe("");
});

test("attachments serve --help lists the bind options (not a transport refusal)", async () => {
  const result = await runServe("serve", "--help");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("--port");
  expect(result.stdout).toContain("--host");
  expect(result.stdout).not.toContain("retired");
});
