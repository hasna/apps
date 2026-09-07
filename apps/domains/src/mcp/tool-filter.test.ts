import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { READ_ONLY_TOOLS, isReadOnlyMcpTool } from "./tool-filter.js";

/**
 * The safe-mode allow-list is only meaningful for tools that exist. A stale
 * entry (`storage_status` lingered after the transport-report tool was never
 * registered — hasna/apps#1720 validation, P2) is dead configuration that
 * suggests a read-only tool MCP clients cannot actually call. Pin: every name
 * in READ_ONLY_TOOLS is registered in `src/mcp/index.ts`.
 *
 * The check is a static scan of the registration source so it needs no
 * store, no credential, and no transport — hermetic on any box.
 */
const MCP_ENTRY_SOURCE = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

function registeredToolNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)) {
    names.add(match[1]!);
  }
  return names;
}

describe("safe-mode read-only allow-list", () => {
  test("every allow-listed tool is registered by the MCP entry", () => {
    const registered = registeredToolNames(MCP_ENTRY_SOURCE);
    expect(registered.size).toBeGreaterThan(0);
    const dead = [...READ_ONLY_TOOLS].filter((name) => !registered.has(name));
    expect(dead).toEqual([]);
  });

  test("the never-registered storage_status entry is gone", () => {
    expect(isReadOnlyMcpTool("storage_status")).toBe(false);
  });

  test("a representative read tool stays allow-listed and a write tool is not", () => {
    expect(isReadOnlyMcpTool("list_domains")).toBe(true);
    expect(isReadOnlyMcpTool("create_domain")).toBe(false);
  });
});
