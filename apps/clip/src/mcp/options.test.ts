import { describe, expect, it } from "bun:test";
import { DEFAULT_MCP_HTTP_PORT, isHttpMode, isStdioMode, resolveHttpPort } from "./options.js";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("MCP startup options", () => {
  it("detects HTTP and stdio modes from args and environment", () => {
    const previous = process.env["MCP_HTTP"];
    try {
      expect(isHttpMode(["--http"])).toBe(true);
      expect(isStdioMode(["--http"])).toBe(false);
      expect(isHttpMode([])).toBe(false);
      expect(isStdioMode([])).toBe(true);

      process.env["MCP_HTTP"] = "1";
      expect(isHttpMode([])).toBe(true);
      expect(isStdioMode([])).toBe(false);
    } finally {
      restoreEnv("MCP_HTTP", previous);
    }
  });

  it("resolves HTTP ports from flags, env, and safe defaults", () => {
    const previous = process.env["MCP_HTTP_PORT"];
    try {
      process.env["MCP_HTTP_PORT"] = "9900";
      expect(resolveHttpPort([])).toBe(9900);
      expect(resolveHttpPort(["--port", "9901"])).toBe(9901);
      expect(resolveHttpPort(["-p", "9902"])).toBe(9902);

      process.env["MCP_HTTP_PORT"] = "bad";
      expect(resolveHttpPort([])).toBe(DEFAULT_MCP_HTTP_PORT);
      expect(resolveHttpPort(["--port", "-1"])).toBe(DEFAULT_MCP_HTTP_PORT);
    } finally {
      restoreEnv("MCP_HTTP_PORT", previous);
    }
  });
});
