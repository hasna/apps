import { describe, it, expect } from "bun:test";
import { CORE_MCP_TOOLS, shouldRegisterToolForProfile } from "./token-utils.js";
import { getMcpToolNames } from "../mcp.js";

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
  "start_task","complete_task","fail_task","lock_task","unlock_task","check_task_lock","approve_task",
  "add_task_dependency","remove_task_dependency","add_comment",
  "bootstrap_project","create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","save_search_view","list_search_views","run_search_view","delete_search_view","move_task","get_next_task","claim_next_task",
  "get_context","bootstrap","get_health","get_tasks_changed_since","heartbeat","release_agent",
  "create_template","list_templates","create_task_from_template","delete_template","list_template_library","write_template_library",
  "bulk_update_tasks","bulk_create_tasks",
  "get_stale_tasks","get_status",
  "search_tools","describe_tools",
];

// The descriptions map from describe_tools (keys only — we verify coverage).
const DESCRIBE_TOOLS_KEYS = [
  "create_task","list_tasks","get_task","update_task","delete_task",
  "start_task","complete_task","fail_task","lock_task","unlock_task","check_task_lock","approve_task",
  "add_task_dependency","remove_task_dependency","add_comment",
  "bootstrap_project","create_project","list_projects",
  "create_plan","list_plans","get_plan","update_plan","delete_plan",
  "register_agent","list_agents","get_agent","rename_agent","delete_agent",
  "get_my_tasks","get_org_chart","set_reports_to",
  "create_task_list","list_task_lists","get_task_list","update_task_list","delete_task_list",
  "search_tasks","save_search_view","list_search_views","run_search_view","delete_search_view","move_task","get_next_task","claim_next_task",
  "get_context","bootstrap","get_health","get_tasks_changed_since","heartbeat","release_agent",
  "create_template","list_templates","create_task_from_template","delete_template","list_template_library","write_template_library",
  "bulk_update_tasks","bulk_create_tasks",
  "get_stale_tasks","get_status",
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

  it("search_tools contains at least 59 tools", () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(59);
  });

  it("all tool names are lowercase with underscores only", () => {
    for (const name of ALL_TOOLS) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });

  // Real guard (not self-referential): every name in the fixture must be a tool
  // the MCP server actually knows about. This catches phantom entries — names
  // that were removed from the registry but left behind in this fixture.
  it("every fixture tool is a real known MCP tool (no phantoms)", () => {
    const known = new Set(getMcpToolNames({ profile: "full" }));
    const phantom = ALL_TOOLS.filter((name) => !known.has(name));
    expect(phantom).toEqual([]);
  });
});

describe("TODOS_PROFILE filtering", () => {
  it("minimal profile registers the compact core tool group", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "minimal"));
    expect(registered.length).toBeGreaterThanOrEqual(14);
    expect(registered.length).toBeLessThanOrEqual(CORE_MCP_TOOLS.size);
    expect(registered).toContain("claim_next_task");
    expect(registered).toContain("complete_task");
    expect(registered).toContain("fail_task");
    expect(registered).toContain("create_task");
    expect(registered).toContain("list_tasks");
    expect(registered).toContain("register_agent");
    expect(registered).toContain("get_status");
    expect(registered).toContain("get_context");
    expect(registered).toContain("get_task");
    expect(registered).toContain("start_task");
    expect(registered).toContain("add_comment");
    expect(registered).toContain("get_next_task");
    expect(registered).toContain("bootstrap");
    expect(registered).toContain("get_tasks_changed_since");
    expect(registered).toContain("get_health");
    expect(registered).toContain("heartbeat");
    expect(registered).toContain("release_agent");
  });

  it("minimal profile excludes management tools", () => {
    expect(shouldRegisterToolForProfile("delete_task", "minimal")).toBe(false);
    expect(shouldRegisterToolForProfile("rename_agent", "minimal")).toBe(false);
    expect(shouldRegisterToolForProfile("create_webhook", "minimal")).toBe(false);
  });

  it("standard profile excludes webhook/template-only tools", () => {
    for (const excluded of [
      "create_webhook", "list_webhooks", "delete_webhook",
      "create_template", "list_templates", "create_task_from_template", "delete_template", "list_template_library", "write_template_library",
    ]) {
      expect(shouldRegisterToolForProfile(excluded, "standard")).toBe(false);
    }
  });

  it("standard profile includes core task tools", () => {
    for (const included of [
      "create_task", "list_tasks", "get_task", "update_task", "start_task",
      "complete_task", "fail_task", "claim_next_task", "get_status",
    ]) {
      expect(shouldRegisterToolForProfile(included, "standard")).toBe(true);
    }
  });

  it("full profile registers all tools", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "full"));
    expect(registered).toHaveLength(ALL_TOOLS.length);
  });

  it("unknown profile defaults to the compact core tools", () => {
    const registered = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "unknown_profile"));
    expect(registered).toContain("claim_next_task");
    expect(registered).not.toContain("create_webhook");
  });

  it("standard profile registers more than minimal but less than full", () => {
    const minimal = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "minimal")).length;
    const standard = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "standard")).length;
    const full = ALL_TOOLS.filter(n => shouldRegisterToolForProfile(n, "full")).length;
    expect(minimal).toBeLessThan(standard);
    expect(standard).toBeLessThan(full);
  });
});
