import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_HTTP_REFUSED_EXIT_CODE, mcpHttpRefusal } from "./index.js";

/**
 * `todos-mcp` is stdio-only. The Streamable HTTP transport is a listener with
 * an auth posture, which is `todos-serve`'s job (it mounts `POST /mcp`). The
 * MCP bin used to start the FULL `todos-serve` app with `allowAnonymous: true`
 * on `--http` / `--port` / `MCP_HTTP=1` — a server-only code path reachable
 * from a client binary that MCP clients spawn with no credential. It now
 * refuses BEFORE resolving any authority and before any transport exists, so
 * the refusal is the same on an unconfigured box and a hosted one.
 */

const ROOT = join(import.meta.dir, "../..");
let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "todos-mcp-http-refusal-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

async function run(args: string[], extraEnv: Record<string, string> = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/mcp/index.ts", ...args], {
    cwd: ROOT,
    env: {
      PATH: process.env["PATH"] ?? "",
      BUN_INSTALL: process.env["BUN_INSTALL"] ?? join(process.env["HOME"] ?? "", ".bun"),
      // No credential anywhere: the refusal must not depend on one.
      HOME: home,
      HASNA_STATION: "no-such-station",
      ...extraEnv,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("todos-mcp refuses the HTTP transport (server-only)", () => {
  test("the refusal names todos-serve and never a credential", () => {
    const line = mcpHttpRefusal();
    expect(line).toContain("todos-serve");
    expect(line).toContain("stdio only");
    expect(line).not.toMatch(/api[-_ ]?key/i);
    expect(MCP_HTTP_REFUSED_EXIT_CODE).toBe(2);
  });

  test("--http exits 2 with the refusal on stderr and nothing on stdout", async () => {
    const result = await run(["--http"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("todos-serve");
    // It refused before the authority decision: no REMOTE_API_* line.
    expect(result.stderr).not.toContain("REMOTE_API_");
  }, 30_000);

  test("--port implies HTTP and is refused the same way", async () => {
    for (const args of [["--port", "8881"], ["--port=8881"]]) {
      const result = await run(args);
      expect({ args, exitCode: result.exitCode }).toEqual({ args, exitCode: 2 });
      expect(result.stderr).toContain("todos-serve");
    }
  }, 30_000);

  test("MCP_HTTP=1 is refused", async () => {
    const result = await run([], { MCP_HTTP: "1" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("todos-serve");
  }, 30_000);

  test("CONTROL: bare stdio start on the same unconfigured box fails closed with exit 1, not 2", async () => {
    // Proves the exit-2 refusal is specific to the HTTP request and that the
    // stdio path still runs the authority decision (hasna/apps#1720).
    const result = await run([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("REMOTE_API_");
    expect(result.stderr).not.toContain("todos-serve");
  }, 30_000);
});
