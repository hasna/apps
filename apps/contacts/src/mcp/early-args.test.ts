import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleEarlyArgs, mcpUsage } from "./index.js";

/**
 * Regression tests for the binds-before-version class (hasna/apps#1720
 * validation): `contacts-mcp --version` / `--help` used to fall through to the
 * stdio JSON-RPC loop and print "Contacts MCP server running on stdio". The
 * probes are two-sided: --help/--version answer rc=0 WITHOUT starting the
 * server, and a plain start still takes the stdio path.
 */

const MCP_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const STDIO_MARKER = "Contacts MCP server running on stdio";
const tempHomes: string[] = [];

async function runMcp(args: string[], killAfterMs: number, overrides: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean; tempHome: string }> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of [
    "MCP_HTTP",
    "MCP_HTTP_PORT",
    "HASNA_CONTACTS_API_URL",
    "CONTACTS_API_URL",
    "HASNA_CONTACTS_API_KEY",
    "CONTACTS_API_KEY",
    "HASNA_CONTACTS_API_KEY_OVERRIDE",
    "HASNA_CONTACTS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_CONFIG_HOME",
    // Retired client selectors: the startup gate refuses them hard, and any
    // other file in the same `bun test` process may leave one on process.env.
    "HASNA_CONTACTS_STORAGE_MODE",
    "CONTACTS_STORAGE_MODE",
    "HASNA_CONTACTS_DB_PATH",
    "CONTACTS_DB_PATH",
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
  ]) delete env[key];
  // Hermetic against the station: an absent Keychain account and an empty
  // HASNA_HOME, so nothing on the machine configures the child.
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-mcp-args-"));
  tempHomes.push(tempHome);
  env.HASNA_HOME = tempHome;
  env.HASNA_STATION = "no-such-station";
  Object.assign(env, overrides);
  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      setTimeout(() => {
        proc.kill();
        resolve(true);
      }, killAfterMs);
    }),
  ]);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut, tempHome };
}

afterEach(() => {
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

describe("contacts-mcp early arguments", () => {
  test("classifies --help/-h and --version/-V ahead of every transport flag", () => {
    expect(handleEarlyArgs(["--help"])).toBe("help");
    expect(handleEarlyArgs(["-h"])).toBe("help");
    expect(handleEarlyArgs(["--version"])).toBe("version");
    expect(handleEarlyArgs(["-V"])).toBe("version");
    expect(handleEarlyArgs(["--http", "--version"])).toBe("version");
    expect(handleEarlyArgs(["--http", "--port", "8809"])).toBe("start");
    expect(handleEarlyArgs([])).toBe("start");
    expect(mcpUsage()).toContain("contacts-mcp");
  });

  test("--version answers with the package version on stdout, rc=0, without starting the server", async () => {
    const result = await runMcp(["--version"], 10_000);
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).not.toContain(STDIO_MARKER);
  });

  test("--help answers with usage on stdout, rc=0, without starting the server", async () => {
    const result = await runMcp(["--help"], 10_000);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("contacts-mcp");
    expect(result.stderr).not.toContain(STDIO_MARKER);
  });

  test("a plain start with a credential still takes the stdio server path (negative probe)", async () => {
    const result = await runMcp([], 5_000, { HASNA_CONTACTS_API_KEY: "test-key" });
    expect(result.stderr).toContain(STDIO_MARKER);
    expect(result.stdout).not.toContain("usage");
  });

  test("fails closed at startup without a credential: non-zero exit, first stderr line names where the credential should live, nothing created under HASNA_HOME", async () => {
    const result = await runMcp([], 15_000);
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    // The FIRST stderr line is the diagnosis — a leading blank line (or a
    // "running on stdio" marker) would defeat the fail-closed contract.
    const [firstLine] = result.stderr.split("\n");
    expect(firstLine).toContain("CONTACTS_API_NOT_CONFIGURED");
    expect(firstLine).toContain("HASNA_CONTACTS_API_KEY");
    expect(firstLine).toContain(join(result.tempHome, "contacts", "config", "credentials"));
    expect(result.stderr).not.toContain("local-fallback");
    // The gate runs before any transport is connected: the app home stays empty.
    expect(readdirSync(result.tempHome)).toEqual([]);
  });

  test("fails closed identically in HTTP mode before binding the port", async () => {
    const result = await runMcp(["--http"], 15_000);
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("HTTP listening");
    expect(result.stderr.split("\n")[0]).toContain("CONTACTS_API_NOT_CONFIGURED");
  });
  // The in-process gate itself (every tier, the deliberate refusals, the
  // pointer dereference) is covered by startup-gate.test.ts on a caller-built
  // env; the spawned fail-closed contract by fail-closed-startup.test.ts.
});
