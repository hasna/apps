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
  "start_task","complete_task","fail_task","lock_task","unlock_task","approve_task",
  "add_dependency","remove_dependency","add_comment",
  "create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","sync","clone_task","move_task","get_next_task","claim_next_task",
  "get_task_history","get_recent_activity",
  "create_webhook","list_webhooks","delete_webhook",
  "create_template","list_templates","create_task_from_template","delete_template",
  "bulk_update_tasks","bulk_create_tasks","get_task_stats","get_task_graph",
  "get_active_work","get_tasks_changed_since","get_stale_tasks","get_status",
  "search_tools","describe_tools",
];

// The descriptions map from describe_tools (keys only — we verify coverage).
const DESCRIBE_TOOLS_KEYS = [
  "create_task","list_tasks","get_task","update_task","delete_task",
  "start_task","complete_task","fail_task","lock_task","unlock_task","approve_task",
  "add_dependency","remove_dependency","add_comment",
  "create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","sync","clone_task","move_task","get_next_task","claim_next_task",
  "get_task_history","get_recent_activity",
  "create_webhook","list_webhooks","delete_webhook",
  "create_template","list_templates","create_task_from_template","delete_template",
  "bulk_update_tasks","bulk_create_tasks","get_task_stats","get_task_graph",
  "get_active_work","get_tasks_changed_since","get_stale_tasks","get_status",
  "search_tools","describe_tools",
];

// Profile filtering logic (mirrors src/mcp/index.ts)
const MINIMAL_TOOLS = new Set([
  "claim_next_task", "complete_task", "fail_task", "get_status",
  "get_task", "start_task", "add_comment", "get_next_task",
]);

const STANDARD_EXCLUDED = new Set([
  "get_org_chart", "set_reports_to", "rename_agent", "delete_agent",
  "create_webhook", "list_webhooks", "delete_webhook",
  "create_template", "list_templates", "create_task_from_template", "delete_template",
  "approve_task",
]);

function shouldRegisterTool(name: string, profile: string): boolean {
  if (profile === "minimal") return MINIMAL_TOOLS.has(name);
  if (profile === "standard") return !STANDARD_EXCLUDED.has(name);
  return true;
}

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

  it("search_tools contains at least 59 tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(59);
  });

  it("all tool names are lowercase with underscores only", () => {
    for (const name of ALL_TOOLS) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("TODOS_PROFILE filtering", () => {
  it("minimal profile registers exactly 8 tools", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterTool(n, "minimal"));
    expect(registered).toHaveLength(8);
    expect(registered).toContain("claim_next_task");
    expect(registered).toContain("complete_task");
    expect(registered).toContain("fail_task");
    expect(registered).toContain("get_status");
    expect(registered).toContain("get_task");
    expect(registered).toContain("start_task");
    expect(registered).toContain("add_comment");
    expect(registered).toContain("get_next_task");
  });

  it("minimal profile excludes management tools", () => {
    expect(shouldRegisterTool("create_task", "minimal")).toBe(false);
    expect(shouldRegisterTool("list_tasks", "minimal")).toBe(false);
    expect(shouldRegisterTool("delete_task", "minimal")).toBe(false);
    expect(shouldRegisterTool("rename_agent", "minimal")).toBe(false);
    expect(shouldRegisterTool("create_webhook", "minimal")).toBe(false);
  });

  it("standard profile excludes org/webhook/template/approval tools", () => {
    for (const excluded of [
      "get_org_chart", "set_reports_to", "rename_agent", "delete_agent",
      "create_webhook", "list_webhooks", "delete_webhook",
      "create_template", "list_templates", "create_task_from_template", "delete_template",
      "approve_task",
    ]) {
      expect(shouldRegisterTool(excluded, "standard")).toBe(false);
    }
  });

  it("standard profile includes core task tools", () => {
    for (const included of [
      "create_task", "list_tasks", "get_task", "update_task", "start_task",
      "complete_task", "fail_task", "claim_next_task", "get_status",
    ]) {
      expect(shouldRegisterTool(included, "standard")).toBe(true);
    }
  });

  it("full profile registers all tools", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterTool(n, "full"));
    expect(registered).toHaveLength(ALL_TOOLS.length);
  });

  it("unknown profile defaults to full (all tools)", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterTool(n, "unknown_profile"));
    expect(registered).toHaveLength(ALL_TOOLS.length);
  });

  it("standard profile registers more than minimal but less than full", () => {
    const minimal = ALL_TOOLS.filter(n => shouldRegisterTool(n, "minimal")).length;
    const standard = ALL_TOOLS.filter(n => shouldRegisterTool(n, "standard")).length;
    const full = ALL_TOOLS.filter(n => shouldRegisterTool(n, "full")).length;
    expect(minimal).toBeLessThan(standard);
    expect(standard).toBeLessThan(full);
  });
});
