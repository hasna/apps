// Sol-guided coverage — Priority 5: MCP entrypoint.
//
// `createFeedbackMcpServer`/`buildServer` are wired and register the full tool
// set; `--help`/`-h`/`--version`/`-V` return BEFORE the stdio transport would
// connect (proven by the process exiting 0 promptly with captured stdout, and
// the negative control: the same invocation WITHOUT a flag does not exit 0 —
// it either errors on closed stdin or blocks on stdio, which is the documented
// non-test boundary).
import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer, createFeedbackMcpServer } from "./server.js";
import { VERSION } from "../version.js";

interface ServerInternals {
  // The McpServer facade keeps the underlying SDK Server (with _serverInfo)
  // on `server` and the registered tool registry on `_registeredTools`.
  server?: { _serverInfo?: { name: string; version: string } };
  _registeredTools?: Record<string, unknown>;
}

const MCP_CLI = join(dirname(fileURLToPath(import.meta.url)), "cli.ts");

function runCli(args: string[]): { code: number; stdout: string; stderr: string; timedOut: boolean } {
  const result = Bun.spawnSync(["bun", "run", MCP_CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: 15000,
  });
  return {
    code: result.exitCode ?? -1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    timedOut: result.signalCode === "SIGTERM" || result.signalCode === "SIGKILL",
  };
}

describe("createFeedbackMcpServer / buildServer wiring", () => {
  test("wires the default feedback name and the package version", () => {
    const server = createFeedbackMcpServer() as unknown as ServerInternals;
    expect(server.server?._serverInfo).toBeDefined();
    expect(server.server?._serverInfo?.name).toBe("feedback");
    expect(server.server?._serverInfo?.version).toBe(VERSION);
  });

  test("honors custom name and version options", () => {
    const server = createFeedbackMcpServer({ name: "custom-feedback", version: "9.9.9" }) as unknown as ServerInternals;
    expect(server.server?._serverInfo?.name).toBe("custom-feedback");
    expect(server.server?._serverInfo?.version).toBe("9.9.9");
  });

  test("buildServer registers the full non-empty tool set", () => {
    const server = buildServer() as unknown as ServerInternals;
    const tools = Object.keys(server._registeredTools ?? {});
    expect(tools.length).toBeGreaterThanOrEqual(7);
    expect(tools).toContain("submit_feedback");
    expect(tools).toContain("list_feedback");
    expect(tools).toContain("get_feedback");
    expect(tools).toContain("update_feedback_status");
    expect(tools).toContain("feedback_stats");
    expect(tools).toContain("export_feedback");
    expect(tools).toContain("feedback_diagnostics");
  });
});

describe("feedback-mcp CLI flags return before stdio connect", () => {
  test("--help prints usage and exits 0 without touching stdio", () => {
    const result = runCli(["--help"]);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: feedback-mcp");
    expect(result.stdout).toContain("--version");
  });

  test("-h behaves like --help", () => {
    const result = runCli(["-h"]);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: feedback-mcp");
  });

  test("--version prints exactly the package version and exits 0", () => {
    const result = runCli(["--version"]);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  test("-V behaves like --version", () => {
    const result = runCli(["-V"]);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  test("negative control: with no flag the process never takes the flag path — it blocks on or fails the stdio connect", () => {
    // The documented non-test boundary: a bare invocation connects the stdio
    // transport instead of returning. Whether stdin EOF makes it fail fast or
    // block until the timeout is runtime-dependent, so the discriminating
    // assertion is that it produced NEITHER the usage text NOR the version
    // line — the two outputs the flags are proven to produce above.
    const result = runCli([]);
    expect(result.stdout).not.toContain("Usage: feedback-mcp");
    expect(result.stdout.trim()).not.toBe(VERSION);
  });
});
