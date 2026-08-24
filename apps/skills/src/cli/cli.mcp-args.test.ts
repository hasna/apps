import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLI_PATH, runCli } from "./cli.test-utils.js";
import { useDefaultTestTimeout, withoutDataDirOverrideEnv } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Regression tests for BUG e3997558: `skills mcp <unrecognised-word>` exited
 * rc=0 with zero bytes on stdout AND stderr, so an agent following docs that
 * name a phantom verb (skills.md "skills mcp connect" A5-00216, mcps.md
 * "mcps auth login" A5-00254) concluded it was connected.
 *
 * The documented contract of the `skills mcp` subcommand (README: "Start MCP
 * server on stdio", "skills mcp  # stdio transport") must hold: bare
 * `skills mcp` starts the stdio MCP server, `--register <agent>` registers it,
 * and a stray positional argument is rejected loudly instead of silently
 * ignored.
 */

function cliEnv(home: string): Record<string, string> {
  return {
    ...withoutDataDirOverrideEnv({ ...process.env }),
    HOME: home,
    NO_COLOR: "1",
    SKILLS_TEST_MODE: "1",
  };
}

describe("skills mcp argument handling (e3997558)", () => {
  test("an unrecognised positional argument exits non-zero with valid forms on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCli(["mcp", "connect"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("takes no positional arguments");
    expect(stderr).toContain("--register");
  });

  test("bare `skills mcp` still starts the stdio MCP server", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-cli-mcp-bare-"));
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--", "mcp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: cliEnv(home),
    });
    const stdin = proc.stdin as import("bun").FileSink;
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const messages: any[] = [];
    let procDone = false;
    proc.exited.then(() => {
      procDone = true;
    });
    const readLoop = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.trim()) {
              try {
                messages.push(JSON.parse(line));
              } catch {}
            }
          }
        }
      } catch {}
    })();

    try {
      stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "cli-mcp-args-test", version: "1.0" },
          },
        }) + "\n",
      );
      const deadline = Date.now() + 10_000;
      let response: any = null;
      while (Date.now() < deadline && !response) {
        if (procDone) break; // process exited without answering: server never started
        response = messages.find((m) => m.id === 1) ?? null;
        if (!response) await new Promise((r) => setTimeout(r, 50));
      }
      expect(response, "expected an initialize response from the stdio MCP server").not.toBeNull();
      expect(response?.result?.serverInfo?.name).toBe("skills");
      expect(response?.result?.serverInfo?.version).toBeDefined();
    } finally {
      try {
        stdin.end();
      } catch {}
      proc.kill("SIGKILL");
      await Promise.race([proc.exited.catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    }
  });

  test("`skills mcp --register <agent>` still works", async () => {
    const home = mkdtempSync(join(tmpdir(), "skills-cli-mcp-reg-"));
    const { stdout, exitCode } = await runCli(["mcp", "--register", "codex", "--json"], { HOME: home });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.registered).toBe(1);
    expect(parsed.results[0]).toMatchObject({ agent: "codex", success: true });
  });

  test("`skills mcp --register <unknown-agent> --json` still errors cleanly", async () => {
    const { stdout, exitCode } = await runCli(["mcp", "--register", "zzz-no-such-agent", "--json"]);
    expect(exitCode).not.toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.registered).toBe(0);
    expect(parsed.results[0].success).toBe(false);
    expect(parsed.results[0].error).toContain("Unknown agent");
  });
});
