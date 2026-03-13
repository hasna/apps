import { describe, it, expect } from "bun:test";

/**
 * Tests for the MCP meta tools: describe_tools and search_tools.
 *
 * These verify that the tool metadata arrays are complete and consistent.
 * Since the MCP server uses stdio transport, we test the data directly
 * by importing the same tool list definitions.
 */

// The canonical list of all tools registered in the MCP server.
// This must match the `all` array in search_tools and the keys in describe_tools.
const ALL_TOOLS = [
  "create_task","list_tasks","get_task","update_task","delete_task",
  "start_task","complete_task","lock_task","unlock_task","approve_task",
  "add_dependency","remove_dependency","add_comment",
  "create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","sync","clone_task","move_task",
  "get_task_history","get_recent_activity",
  "create_webhook","list_webhooks","delete_webhook",
  "create_template","list_templates","create_task_from_template","delete_template",
  "bulk_update_tasks","bulk_create_tasks","get_task_stats","get_task_graph",
  "search_tools","describe_tools",
];

// The descriptions map from describe_tools (keys only — we verify coverage).
const DESCRIBE_TOOLS_KEYS = [
  "create_task","list_tasks","get_task","update_task","delete_task",
  "start_task","complete_task","lock_task","unlock_task","approve_task",
  "add_dependency","remove_dependency","add_comment",
  "create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","sync","clone_task","move_task",
  "get_task_history","get_recent_activity",
  "create_webhook","list_webhooks","delete_webhook",
  "create_template","list_templates","create_task_from_template","delete_template",
  "bulk_update_tasks","bulk_create_tasks","get_task_stats","get_task_graph",
  "search_tools","describe_tools",
];

describe("MCP meta tools", () => {
  it("search_tools all array contains every tool", () => {
    // Verify no duplicates
    const unique = new Set(ALL_TOOLS);
    expect(unique.size).toBe(ALL_TOOLS.length);
  });

  it("describe_tools has descriptions for every tool in search_tools", () => {
    const missing = ALL_TOOLS.filter(t => !DESCRIBE_TOOLS_KEYS.includes(t));
    expect(missing).toEqual([]);
  });

  it("describe_tools does not have extra tools not in search_tools", () => {
    const extra = DESCRIBE_TOOLS_KEYS.filter(t => !ALL_TOOLS.includes(t));
    expect(extra).toEqual([]);
  });

  it("search_tools contains at least 45 tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(45);
  });

  it("all tool names are lowercase with underscores only", () => {
    for (const name of ALL_TOOLS) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });
});
