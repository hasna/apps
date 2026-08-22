import { describe, expect, it } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MCP_HTTP_PORT } from "./http.js";

// Regressions for the hasna-testers-mcp.service crash-restart loop (2026-06-10,
// 85k+ restarts): the systemd unit ran `testers-mcp` bare, stdio transport saw
// EOF on /dev/null stdin and exited 0 every ~3s forever.
describe("testers-mcp entrypoint", () => {
  it("pins DEFAULT_MCP_HTTP_PORT to 8880 — the port deployed clients are configured for", () => {
    // ~/.claude.json fleet config connects to http://127.0.0.1:8880/mcp.
    // This port has flip-flopped between 8880 and 8840 across releases; changing
    // it strands every configured client. Do not change without migrating clients.
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8880);
  });

  it("exits 1 with a --http hint when stdio mode gets /dev/null stdin", () => {
    // stdio: "ignore" attaches /dev/null — exactly what systemd gives a bare
    // ExecStart. No MCP stdio client can ever attach, so starting the stdio
    // transport is always a misconfiguration; it must fail loudly, not exit 0.
    const res = spawnSync("bun", ["src/mcp/index.ts"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
      env: { ...process.env, TESTERS_DB_PATH: ":memory:" },
    });
    expect(res.status).toBe(1);
    expect(String(res.stderr)).toContain("--http");
  });
});

// Regression for command injection via run_for_diff's baseRef argument
// (todos 970bf61f): the MCP-caller-supplied baseRef was interpolated into an
// execSync shell string, so metacharacters (`;`, `|`, backticks, `$()`) ran
// arbitrary commands as the server process user. baseRef must never reach a
// shell — it is passed to git as one literal argv entry and validated against
// an allowlist before any command runs.
describe("testers-mcp run_for_diff baseRef injection", () => {
  // A git repo with one commit so `git diff --cached --name-only` (the first
  // command in the handler) succeeds and the injection-bearing second command
  // is actually reached — in a non-repo cwd the first command throws first.
  function initScratchRepo(prefix: string): string {
    const scratch = mkdtempSync(join(tmpdir(), prefix));
    execSync("git init -q", { cwd: scratch });
    execSync("git config user.email test@example.com", { cwd: scratch });
    execSync("git config user.name test", { cwd: scratch });
    execSync("git commit -q --allow-empty -m init", { cwd: scratch });
    return scratch;
  }

  function callRunForDiff(cwd: string, baseRef: string): { stdout: string; status: number | null } {
    const entry = new URL("./index.ts", import.meta.url).pathname;
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "testers-injection-test", version: "0.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "run_for_diff",
          arguments: { url: "http://example.com", baseRef },
        },
      },
    ];
    const res = spawnSync("bun", [entry], {
      cwd,
      env: { ...process.env, TESTERS_DB_PATH: ":memory:" },
      input: messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
      encoding: "utf8",
      timeout: 20_000,
    });
    return { stdout: String(res.stdout), status: res.status };
  }

  it("never executes shell metacharacters embedded in baseRef", () => {
    const scratch = initScratchRepo("testers-mcp-inject-");
    try {
      const artifact = join(scratch, "PWNED-by-injection");
      // "HEAD; touch <artifact>" would create the file if baseRef ever reached
      // a shell. The server runs in cwd=scratch, so git (and the injection)
      // operate on this directory.
      const { stdout, status } = callRunForDiff(scratch, `HEAD; touch ${artifact}`);
      expect(status).toBe(0);
      expect(existsSync(artifact)).toBe(false);
      // The call must still be answered (fail closed), not hang.
      expect(stdout).toContain('"id":2');
      expect(stdout).toContain("Invalid baseRef");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("still accepts a valid baseRef and runs git diff against it", () => {
    const scratch = initScratchRepo("testers-mcp-validref-");
    try {
      const { stdout, status } = callRunForDiff(scratch, "HEAD");
      expect(status).toBe(0);
      // Empty diff on a fresh repo → skipped with the no-changes reason,
      // proving the ref was accepted and git actually ran.
      expect(stdout).toContain("No changed files detected");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
