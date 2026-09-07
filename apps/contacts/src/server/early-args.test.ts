import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * Regression tests for the binds-before-help class (hasna/apps#1720
 * validation): `contacts-serve --help` fell through to `startCloudServer` and
 * bound the port (EADDRINUSE on a station where another serve held it).
 * --help/--version must answer rc=0 on stdout WITHOUT binding anything.
 */

const SERVE_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const BIND_MARKER = "Contacts cloud server running at";
/** Distinctive high port so an accidental bind cannot collide with a real serve. */
const PINNED_PORT = "49293";

async function runServe(...args: string[]): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
    "DATABASE_URL",
    "CONTACTS_HOST",
  ]) delete env[key];
  env.PORT = PINNED_PORT;
  const proc = Bun.spawn(["bun", "run", SERVE_ENTRY, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, 10_000);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut };
}

describe("contacts-serve early arguments (binds-before-help class)", () => {
  test("--help answers with usage on stdout, rc=0, without binding the port", async () => {
    const result = await runServe("--help");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("contacts-serve");
    expect(result.stdout).not.toContain(BIND_MARKER);
    expect(result.stderr).not.toContain(BIND_MARKER);
  });

  test("-h is the short form", async () => {
    const result = await runServe("-h");
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).not.toContain(BIND_MARKER);
  });

  test("--version answers with the package version on stdout, rc=0, without binding the port", async () => {
    const result = await runServe("--version");
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stdout).not.toContain(BIND_MARKER);
    expect(result.stderr).not.toContain(BIND_MARKER);
  });
});
