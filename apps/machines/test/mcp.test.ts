import { expect, test } from "bun:test";
import { MACHINE_MCP_TOOL_NAMES, createMcpServer } from "../src/mcp/server.js";

test("exports expected MCP tool surface", () => {
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_agent_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_apps_plan");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_serve_info");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_sync_apply");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_install_claude_preview");
  expect(createMcpServer("0.0.1")).toBeDefined();
});
