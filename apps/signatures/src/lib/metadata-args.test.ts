import { describe, expect, test } from "bun:test";

import { getMetadataResponse } from "./metadata-args.js";
import { getPackageVersion } from "./package-info.js";

describe("metadata args", () => {
  test("returns package version without starting a service", () => {
    expect(getMetadataResponse(["--version"], {
      command: "signatures-serve",
      description: "Start server",
      usage: "signatures-serve",
    })).toBe(getPackageVersion());
  });

  test("returns concise help", () => {
    const help = getMetadataResponse(["--help"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp [--stdio] [--http] [--port <n>]",
      options: ["  --stdio        Use stdio transport"],
    });

    expect(help).toContain("Usage: signatures-mcp");
    expect(help).toContain("--version");
    expect(help).toContain("--stdio");
  });

  test("ignores normal runtime args", () => {
    expect(getMetadataResponse(["--http"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp",
    })).toBeUndefined();
  });

  test("supports short aliases for version and help", () => {
    expect(getMetadataResponse(["-V"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp",
    })).toBe(getPackageVersion());

    expect(getMetadataResponse(["-h"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp",
    })).toContain("Usage: signatures-mcp");
  });

  test("version takes precedence when help is also present", () => {
    expect(getMetadataResponse(["--help", "--version"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp",
    })).toBe(getPackageVersion());
  });

  test("renders optional custom options after the built-in options", () => {
    const help = getMetadataResponse(["--help"], {
      command: "signatures-mcp",
      description: "Start MCP server",
      usage: "signatures-mcp",
      options: ["  --http         Use HTTP transport"],
    });

    expect(help?.indexOf("-h, --help")).toBeLessThan(help?.indexOf("--http") ?? -1);
  });
});
