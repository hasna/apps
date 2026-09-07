/**
 * recordings-mcp must fail closed at STARTUP (hasna/apps#1720 acceptance (c), fleet
 * fail-closed wave): with no resolvable fleet credential and no local opt-in it exits
 * non-zero before connecting any transport — `initialize` is never answered over stdio,
 * the HTTP transport never listens, and nothing is created under the app home.
 *
 * Hermetic against the station Keychain: HASNA_STATION names a station that has no
 * Keychain item, HOME/HASNA_HOME point at a scratch directory, and every
 * HASNA_RECORDINGS_* / opt-in variable is stripped from the inherited env.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function hermeticEnv(extra: Record<string, string> = {}): { env: Record<string, string>; home: string } {
  const home = mkdtempSync(join(tmpdir(), "recordings-mcp-fail-closed-"));
  roots.push(home);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of Object.keys(env)) {
    if (/^HASNA_RECORDINGS_|^RECORDINGS_(LOCAL|API_URL|API_KEY)$|^HASNA_PROFILE$|^MCP_(STDIO|HTTP|HTTP_PORT)$/.test(key)) {
      delete env[key];
    }
  }
  return {
    home,
    env: { ...env, HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: "no-such-station", ...extra },
  };
}

async function runMcp(args: string[], env: Record<string, string>, stdin: string | null) {
  const proc = Bun.spawn([process.execPath, "src/mcp/index.ts", ...args], {
    cwd: process.cwd(),
    env,
    stdin: stdin === null ? "ignore" : new Response(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const killer = setTimeout(() => proc.kill(), 15_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(killer);
  return { stdout, stderr, exitCode };
}

function dbFilesUnder(home: string): string[] {
  const dir = join(home, ".hasna", "recordings");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.includes(".db"));
}

describe("recordings-mcp fails closed at startup with no credential", () => {
  test("--stdio: exits non-zero before answering initialize, names the tiers, creates nothing", async () => {
    const { env, home } = hermeticEnv();
    const result = await runMcp(["--stdio"], env, `${INITIALIZE}\n`);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.split("\n")[0]).toMatch(/^ERROR: REMOTE_API_CONFIG_MISSING/);
    expect(result.stderr).toContain("hasna.credentials.recordings.api-key");
    expect(result.stderr).toContain("HASNA_RECORDINGS_API_KEY");
    expect(dbFilesUnder(home)).toEqual([]);
  });

  test("default (HTTP) transport: exits non-zero instead of listening", async () => {
    const { env, home } = hermeticEnv({ MCP_HTTP_PORT: "0" });
    const result = await runMcp([], env, null);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("listening");
    expect(result.stderr.split("\n")[0]).toMatch(/^ERROR: REMOTE_API_CONFIG_MISSING/);
    expect(dbFilesUnder(home)).toEqual([]);
  });

  test("an env-tier credential lets --stdio answer initialize", async () => {
    const { env, home } = hermeticEnv({ HASNA_RECORDINGS_API_KEY: "fixture-hosted-key-not-a-secret" });
    const result = await runMcp(["--stdio"], env, `${INITIALIZE}\n`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"result"');
    expect(result.stderr).not.toContain("ERROR:");
    expect(result.stdout).not.toContain("fixture-hosted-key-not-a-secret");
    expect(result.stderr).not.toContain("fixture-hosted-key-not-a-secret");
    expect(dbFilesUnder(home)).toEqual([]);
  });

  test("the explicit local opt-in starts, and says LOCAL on stderr", async () => {
    const { env } = hermeticEnv({ HASNA_RECORDINGS_LOCAL: "1" });
    const result = await runMcp(["--stdio"], env, `${INITIALIZE}\n`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"result"');
    expect(result.stderr).toContain("LOCAL mode");
  });
});
