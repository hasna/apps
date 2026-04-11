import { expect, test } from "bun:test";
import { MACHINE_MCP_TOOL_NAMES, createMcpServer } from "../src/mcp/server.js";

test("exports expected MCP tool surface", () => {
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_doctor");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_self_test");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_apps_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_install_claude_diff");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_notifications_dispatch");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_serve_info");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_sync_apply");
  expect(createMcpServer("0.0.1")).toBeDefined();
});
