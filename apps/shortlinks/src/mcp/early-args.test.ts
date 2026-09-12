import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleEarlyArgs } from "../early-args.js";
import { assertMcpBackend, mcpUsage } from "./startup.js";

/**
 * `shortlinks-mcp` startup (hasna/apps#1720 validation).
 *
 *  - The binds-before-version class: `--version` / `--help` used to fall
 *    through to the stdio JSON-RPC loop and announce "[shortlinks-mcp] stdio
 *    ready". They must answer rc=0 on stdout WITHOUT starting the server.
 *  - Fail closed at startup (acceptance (c)): with no credential resolvable and
 *    no local opt-in the bin used to announce "stdio ready" and exit 0 when
 *    stdin closed — a server whose every tool would refuse. It must exit
 *    non-zero BEFORE serving, name where the credential should live on the
 *    first stderr line, print nothing on stdout, and create no *.db.
 *  - Positive probes: a hosted credential starts the stdio server and creates
 *    nothing under the app home; the explicit local opt-in starts it too,
 *    announces the local backend, and opens the database in the caller's home.
 *
 * Hermetic against the station: the child gets an absent Keychain account
 * (HASNA_STATION), an empty HASNA_HOME, and no ambient fleet variables.
 */

const MCP_ENTRY = new URL("./index.ts", import.meta.url).pathname;
const STDIO_MARKER = "[shortlinks-mcp] stdio ready";

/** Env keys stripped from the child so nothing ambient configures a backend. */
const STRIP_ENV_KEYS = [
  "MCP_HTTP",
  "MCP_HTTP_PORT",
  "MCP_STDIO",
  "HASNA_SHORTLINKS_API_URL",
  "HASNA_SHORTLINKS_API_KEY",
  "SHORTLINKS_API_URL",
  "SHORTLINKS_API_KEY",
  "HASNA_SHORTLINKS_API_KEY_OVERRIDE",
  "HASNA_SHORTLINKS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_CONFIG_HOME",
  "HASNA_SHORTLINKS_LOCAL",
  "SHORTLINKS_LOCAL",
  "SHORTLINKS_DB",
  "SHORTLINKS_HOME",
  "SHORTLINKS_CLICK_SALT",
];

const tempHomes: string[] = [];

interface McpRun {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
  home: string;
}

async function runMcp(args: string[], extraEnv: Record<string, string> = {}, killAfterMs = 15_000): Promise<McpRun> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STRIP_ENV_KEYS.includes(key)) env[key] = value;
  }
  const home = mkdtempSync(join(tmpdir(), "shortlinks-mcp-startup-"));
  tempHomes.push(home);
  env.HOME = home;
  env.HASNA_HOME = join(home, "hasna");
  env.HASNA_STATION = "no-such-station";
  Object.assign(env, extraEnv);
  const proc = Bun.spawn(["bun", "run", MCP_ENTRY, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
    cwd: join(import.meta.dir, "..", ".."),
  });
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
  return { stdout, stderr, code: proc.exitCode ?? -1, timedOut, home };
}

function databaseFilesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[]).filter((entry) => /\.db(-wal|-shm)?$/.test(entry));
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("shortlinks-mcp early arguments", () => {
  test("classifies --help/-h and --version/-V ahead of every transport flag", () => {
    expect(handleEarlyArgs(["--help"])).toBe("help");
    expect(handleEarlyArgs(["-h"])).toBe("help");
    expect(handleEarlyArgs(["--version"])).toBe("version");
    expect(handleEarlyArgs(["-V"])).toBe("version");
    expect(handleEarlyArgs(["--http", "--version"])).toBe("version");
    expect(handleEarlyArgs(["--http", "--port", "8851"])).toBe("start");
    expect(handleEarlyArgs([])).toBe("start");
    expect(mcpUsage()).toContain("shortlinks-mcp");
    expect(mcpUsage()).toContain("hasna.credentials.shortlinks.api-key");
  });

  test("--version answers with the package version on stdout, rc=0, without starting the server", async () => {
    const result = await runMcp(["--version"]);
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(databaseFilesUnder(result.home)).toEqual([]);
  });

  test("--help answers with usage on stdout, rc=0, without starting the server", async () => {
    const result = await runMcp(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("usage");
    expect(result.stdout).toContain("shortlinks-mcp");
    expect(result.stderr).not.toContain(STDIO_MARKER);
  });
});

describe("shortlinks-mcp fails closed at startup", () => {
  test("assertMcpBackend throws the chain-naming message and opens nothing without a credential", () => {
    const home = mkdtempSync(join(tmpdir(), "shortlinks-mcp-gate-"));
    tempHomes.push(home);
    const error = () => assertMcpBackend({ HOME: home, SHORTLINKS_HOME: home });
    expect(error).toThrow(/hasna\.credentials\.shortlinks\.api-key/);
    expect(error).toThrow(/HASNA_SHORTLINKS_API_KEY/);
    expect(error).toThrow(/never falls back to local storage/);
    expect(readdirSync(home)).toEqual([]);
    // A hosted credential passes the gate and still touches nothing on disk.
    expect(() => assertMcpBackend({ HOME: home, SHORTLINKS_HOME: home, HASNA_SHORTLINKS_API_KEY: "test-key" })).not.toThrow();
    expect(readdirSync(home)).toEqual([]);
  });

  test("no credential and no local opt-in: exits non-zero before serving, names the chain on stderr line 1, creates no *.db", async () => {
    const result = await runMcp([]);
    expect(result.timedOut).toBe(false);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    const firstLine = result.stderr.split("\n")[0] ?? "";
    expect(firstLine).toContain("hasna.credentials.shortlinks.api-key");
    expect(firstLine).toContain("~/.hasna/shortlinks/config/credentials");
    expect(firstLine).toContain("HASNA_SHORTLINKS_API_KEY");
    expect(result.stderr).not.toContain(STDIO_MARKER);
    expect(result.stderr).not.toMatch(/local-fallback/);
    expect(databaseFilesUnder(result.home)).toEqual([]);
  });

  test("a hosted credential starts the stdio server and creates nothing under the app home (positive probe)", async () => {
    const result = await runMcp([], { HASNA_SHORTLINKS_API_KEY: "test-key" }, 10_000);
    expect(result.stderr).toContain(STDIO_MARKER);
    expect(result.stdout).not.toContain("usage");
    expect(databaseFilesUnder(result.home)).toEqual([]);
    expect(existsSync(join(result.home, "hasna", "shortlinks"))).toBe(false);
  });

  test("the explicit local opt-in starts the server, announces the local backend, and opens the database in the caller's home", async () => {
    const result = await runMcp([], { HASNA_SHORTLINKS_LOCAL: "1" }, 10_000);
    expect(result.stderr).toContain("local backend");
    expect(result.stderr).toContain(STDIO_MARKER);
    // The app home follows HASNA_HOME: $HASNA_HOME/shortlinks/shortlinks.db.
    expect(existsSync(join(result.home, "hasna", "shortlinks", "shortlinks.db"))).toBe(true);
  });
});
