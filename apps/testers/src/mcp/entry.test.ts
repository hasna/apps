import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
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
