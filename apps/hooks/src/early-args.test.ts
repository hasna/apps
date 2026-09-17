import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SERVE_ENTRY = new URL("./serve.ts", import.meta.url).pathname;
const PROBE_TIMEOUT_MS = 5_000;
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** Run the real entry point without inherited credentials, homes, or bind options. */
async function runProbe(args: string[], readiness = false, timeoutMs = PROBE_TIMEOUT_MS) {
  const home = mkdtempSync(join(tmpdir(), "hooks-serve-probe-"));
  const proc = Bun.spawn([process.execPath, "--no-env-file", ...args], {
    stdout: "pipe", stderr: "pipe",
    env: {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home,
      HASNA_HOOKS_DATA_DIR: join(home, "data"), HASNA_HOOKS_DB_PATH: ":memory:",
      HASNA_STATION: `hooks-probe-${crypto.randomUUID()}`, NO_COLOR: "1",
    },
  });
  let stdout = "", stderr = "", ready = false, timedOut = false;
  let code: number | null = null, port: number | null = null, failure = "";
  const output = Promise.all([
    (async () => { for await (const chunk of proc.stdout) stdout += Buffer.from(chunk).toString(); })(),
    (async () => { for await (const chunk of proc.stderr) stderr += Buffer.from(chunk).toString(); })(),
  ]);
  const exited = proc.exited.then((status) => { code = status; });
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!readiness) {
      await Promise.race([exited, new Promise<void>((resolve) => {
        timer = setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
      })]);
    } else {
      while (Date.now() < deadline) {
        if (code !== null) { failure = "child exited before readiness"; break; }
        const match = stderr.match(/hooks registry listening on http:\/\/127\.0\.0\.1:([1-9][0-9]*) /);
        if (match) {
          port = Number(match[1]);
          try {
            const response = await fetch(`http://127.0.0.1:${port}/health`, {
              signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline - Date.now()))),
            });
            const body = await response.json();
            if (response.status === 200 && body.status === "ok" && body.name === "hooks-registry" && code === null) {
              ready = true; break;
            }
            failure = "listener did not return the Hooks health response";
            break;
          } catch (error) { failure = error instanceof Error ? error.message : "health request failed"; }
        }
        await Bun.sleep(10);
      }
      if (!ready && code === null && Date.now() >= deadline) timedOut = true;
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // Kill only this probe's child and reap it before removing its home.
    if (proc.exitCode === null) proc.kill("SIGKILL");
    await exited;
    await output;
    rmSync(home, { recursive: true, force: true });
  }
  return { stdout, stderr, code, ready, timedOut, port, failure, reaped: code !== null };
}

describe("hooks-serve early arguments (binds-before-help regression)", () => {
  test("--help exits with usage without binding", async () => {
    const result = await runProbe([SERVE_ENTRY, "--help"]);
    expect(result, JSON.stringify(result)).toMatchObject({ timedOut: false, code: 0, reaped: true });
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("hooks-serve");
    expect(result.stdout + result.stderr).not.toContain("listening on");
  }, 10_000); // Budget includes the child deadline and cleanup if early-argument handling regresses.

  test("--version exits with a version without binding", async () => {
    const result = await runProbe([SERVE_ENTRY, "--version"]);
    expect(result, JSON.stringify(result)).toMatchObject({ timedOut: false, code: 0, reaped: true });
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
    expect(result.stdout + result.stderr).not.toContain("listening on");
  }, 10_000);

  test("plain serve binds an ephemeral loopback listener and answers real health requests", async () => {
    const result = await runProbe([SERVE_ENTRY, "--port", "0", "--host", "127.0.0.1"], true);
    expect(result, JSON.stringify(result)).toMatchObject({ ready: true, timedOut: false, reaped: true });
    expect(result.port).toBeGreaterThan(0);
    expect(result.stderr).toContain(`listening on http://127.0.0.1:${result.port}`);
  }, 10_000);

  test("an occupied owned port fails early with diagnostics instead of reporting readiness", async () => {
    const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("owned listener") });
    try {
      const result = await runProbe([SERVE_ENTRY, "--port", String(occupied.port), "--host", "127.0.0.1"], true);
      expect(result, JSON.stringify(result)).toMatchObject({ ready: false, timedOut: false, code: 1, reaped: true });
      expect(result.failure).toBe("child exited before readiness");
      expect(result.stderr).toMatch(/EADDRINUSE|address already in use/i);
      expect(await (await fetch(occupied.url)).text()).toBe("owned listener");
    } finally { occupied.stop(true); }
  }, 10_000);

  test("an early child exit retains its exit code and stderr", async () => {
    const result = await runProbe(["--eval", 'console.error("fixture startup failed"); process.exit(23)'], true);
    expect(result).toMatchObject({ ready: false, timedOut: false, code: 23, reaped: true, failure: "child exited before readiness" });
    expect(result.stderr).toContain("fixture startup failed");
  }, 10_000);

  test("a live child without a listener reaches the deadline and is reaped", async () => {
    const result = await runProbe(["--eval", "setInterval(() => {}, 1000)"], true, 100);
    expect(result).toMatchObject({ ready: false, timedOut: true, reaped: true, port: null });
    expect(result.code).not.toBe(0);
  }, 5_000); // Bounded fixture deadline and cleanup; no minimum startup or elapsed-time assertion.

  test("an announcement and live process cannot substitute for the real health response", async () => {
    const script = `const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ status: "wrong" }) });
      console.error("hooks registry listening on http://127.0.0.1:" + s.port + " (fixture)");`;
    const result = await runProbe(["--eval", script], true);
    expect(result, JSON.stringify(result)).toMatchObject({ ready: false, timedOut: false, reaped: true });
    expect(result.failure).toBe("listener did not return the Hooks health response");
  }, 10_000);
});
