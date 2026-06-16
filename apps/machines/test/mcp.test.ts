import { expect, test } from "bun:test";
import { MACHINE_MCP_TOOL_NAMES, createMcpServer } from "../src/mcp/server.js";

test("exports expected MCP tool surface", () => {
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_doctor");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_self_test");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_apps_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_install_claude_diff");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_notifications_dispatch");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_webhooks_add");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_events_emit");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_serve_info");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_sync_apply");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_compatibility");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_route_resolve");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("machines_workspace_resolve");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_status");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_push");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_pull");
  expect(MACHINE_MCP_TOOL_NAMES).toContain("storage_sync");
  expect(createMcpServer("0.0.1")).toBeDefined();
});
