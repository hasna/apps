import { describe, expect, it } from "bun:test";
import "./setup";
import { installToAgents } from "../src/lib/install";
import type { McpServerEntry } from "../src/types";

function makeEntry(overrides: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    id: "local-server",
    name: "Local Server",
    description: null,
    command: "npx",
    args: ["-y", "@example/mcp-server"],
    env: {},
    transport: "stdio",
    url: null,
    source: "local",
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("install consent", () => {
  it("refuses to install local stdio commands into agents without approval", () => {
    const results = installToAgents(makeEntry(), ["claude"]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      agent: "claude",
      success: false,
    });
    expect(results[0].error).toContain("local stdio command approval is required");
  });
});
