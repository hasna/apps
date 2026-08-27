import { afterAll, describe, expect, it } from "bun:test";
import "./setup";
import { closeDb } from "../src/lib/db";
import { DEFAULT_HTTP_PORT } from "../src/mcp/http";
import { isMcpEntry, main, resolveMcpTransport } from "../src/mcp/index";

function captureStdout(fn: () => void): string {
  const logs: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => logs.push(String(message));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logs.join("\n");
}

function withEnv(name: string, value: string, fn: () => void): void {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

describe("mcps-mcp entry transport contract", () => {
  afterAll(() => {
    closeDb();
  });

  it("defaults to stdio transport when no flags are given", () => {
    expect(resolveMcpTransport([])).toBe("stdio");
    expect(resolveMcpTransport(["list"])).toBe("stdio");
  });

  it("opts into HTTP only via --http or MCP_HTTP=1", () => {
    expect(resolveMcpTransport(["--http"])).toBe("http");
    expect(resolveMcpTransport(["--http", "--port", "9000"])).toBe("http");
    withEnv("MCP_HTTP", "1", () => {
      expect(resolveMcpTransport([])).toBe("http");
    });
  });

  it("honors explicit --stdio and MCP_STDIO=1", () => {
    expect(resolveMcpTransport(["--stdio"])).toBe("stdio");
    withEnv("MCP_STDIO", "1", () => {
      expect(resolveMcpTransport([])).toBe("stdio");
    });
  });

  it("prefers explicit stdio over http when both are requested", () => {
    expect(resolveMcpTransport(["--http", "--stdio"])).toBe("stdio");
  });

  it("help documents the real default HTTP port, not the stale 8823", () => {
    const help = captureStdout(() => {
      main(["--help"]);
    });
    expect(help).toContain("stdio transport by default");
    expect(help).toContain(`default: ${DEFAULT_HTTP_PORT}`);
    expect(help).not.toContain("8823");
  });

  it("direct-run guard matches only the MCP entry files, never the CLI bundle", () => {
    // The CLI bundle (bin/index.js) inlines this module; importing it must never
    // self-start. `import.meta.main` covers the real entry; the suffix checks
    // cover direct runs of the built/dev MCP entry files.
    expect(isMcpEntry("apps/mcps/bin/mcp.js")).toBe(true);
    expect(isMcpEntry("apps/mcps/src/mcp/index.ts")).toBe(true);
    expect(isMcpEntry("node_modules/@hasna/mcps/dist/mcp/index.js")).toBe(true);
    // Regression: the CLI 'mcp' subcommand imports the module from bin/index.js.
    expect(isMcpEntry("apps/mcps/bin/index.js")).toBe(false);
    expect(isMcpEntry("/home/hasna/.bun/bin/bun")).toBe(false);
    expect(isMcpEntry(undefined)).toBe(false);
  });
});
