import { describe, expect, test } from "bun:test";
import { buildServer, createChangelogMcpServer } from "./server.js";
import { VERSION } from "../version.js";

interface McpServerInternals {
  _registeredTools: Record<string, unknown>;
  server: { _serverInfo: { name: string; version: string } };
}

function internals(server: ReturnType<typeof createChangelogMcpServer>): McpServerInternals {
  return server as unknown as McpServerInternals;
}

const EXPECTED_TOOLS = [
  "add_changelog_entry",
  "list_changelog_entries",
  "get_changelog_entry",
  "update_changelog_entry",
  "release_changelog",
  "generate_changelog",
  "publish_changelog",
  "changelog_stats",
  "export_changelog_jsonl",
];

describe("createChangelogMcpServer", () => {
  test("defaults the name to changelog and the version to the package VERSION", () => {
    const server = createChangelogMcpServer();
    const { server: underlying, _registeredTools } = internals(server);
    expect(underlying._serverInfo).toEqual({ name: "changelog", version: VERSION });
    expect(Object.keys(_registeredTools).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  test("honors explicit name and version options", () => {
    const server = createChangelogMcpServer({ name: "custom-changelog", version: "9.9.9" });
    expect(internals(server).server._serverInfo).toEqual({ name: "custom-changelog", version: "9.9.9" });
  });

  test("registers every expected tool definition", () => {
    const server = createChangelogMcpServer();
    const { _registeredTools } = internals(server);
    for (const name of EXPECTED_TOOLS) {
      expect(_registeredTools[name], `missing tool ${name}`).toBeDefined();
    }
  });

  test("buildServer is an alias that produces the same tool surface", () => {
    const built = buildServer({ name: "alias", version: "1.0.0" });
    const { server: underlying, _registeredTools } = internals(built);
    expect(underlying._serverInfo).toEqual({ name: "alias", version: "1.0.0" });
    expect(Object.keys(_registeredTools).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });
});
