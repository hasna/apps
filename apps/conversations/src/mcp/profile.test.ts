import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";
import { CONVERSATIONS_CORE_TOOL_NAMES, resolveConversationsMcpProfile } from "./profile.js";

const EXPECTED_CORE = [
  "describe_tools",
  "get_blockers",
  "get_focus",
  "get_message",
  "get_summary",
  "heartbeat",
  "join_channel",
  "leave_channel",
  "list_agents",
  "list_channels",
  "list_sessions",
  "list_unread_counts",
  "mark_channel_read",
  "mark_read",
  "read_channel",
  "read_digest",
  "read_messages",
  "register_agent",
  "reply",
  "search_messages",
  "search_tools",
  "send_message",
  "send_to_channel",
  "send_to_session",
  "set_focus",
];

function inventory(profile: string): string[] {
  return Object.keys((buildServer(true, profile) as any)._registeredTools).sort();
}

describe("Conversations MCP profiles", () => {
  test("defaults to core, composes specialist profiles, and keeps full explicit", () => {
    expect(resolveConversationsMcpProfile([], {})).toBe("core");
    expect(resolveConversationsMcpProfile([], { HASNA_CONVERSATIONS_MCP_PROFILE: "tasks,channels" })).toBe("tasks,channels");
    expect(resolveConversationsMcpProfile(["--mcp-profile=full"], {})).toBe("full");
    expect(() => resolveConversationsMcpProfile(["--mcp-profile", "wide"], {})).toThrow(/comma-separated list/);
    expect(() => resolveConversationsMcpProfile(["--mcp-profile", "core,full"], {})).toThrow(/selected alone/);
  });

  test("core publishes the exact 25-tool messaging/search/context inventory", () => {
    expect([...CONVERSATIONS_CORE_TOOL_NAMES].map(String).sort()).toEqual(EXPECTED_CORE);
    expect(inventory("core")).toEqual(EXPECTED_CORE);
  });

  test("specialist profiles compose on top of core without silently enabling full", () => {
    const core = inventory("core");
    const tasks = inventory("core,tasks");
    const channelsAndProjects = inventory("channels,projects");
    const full = inventory("full");

    expect(tasks).toContain("list_tasks");
    expect(tasks).not.toContain("tmux_broadcast");
    expect(channelsAndProjects).toContain("create_channel");
    expect(channelsAndProjects).toContain("create_project");
    expect(channelsAndProjects).not.toContain("delete_task");
    expect(core).toHaveLength(25);
    expect(tasks.length).toBeGreaterThan(core.length);
    expect(tasks.length).toBeLessThan(full.length);
  });

  test("the composition of every specialist profile covers the exact full inventory", () => {
    const composed = inventory("messaging,channels,projects,agents,tasks,threads,insights,admin");
    const full = inventory("full");
    expect(full).toHaveLength(112);
    expect(composed).toEqual(full);
  });

  test("core discovery dynamically covers the complete 112-tool inventory", async () => {
    const tools = (buildServer(true, "core") as any)._registeredTools;
    const first = JSON.parse((await tools.search_tools.handler({ limit: 100 })).content[0].text);
    expect(first).toMatchObject({ total: 112, count: 100, cursor: 0, next_cursor: 100, has_more: true, complete_inventory: true });
    const second = JSON.parse((await tools.search_tools.handler({ limit: 100, cursor: 100 })).content[0].text);
    expect(second.count).toBe(12);
    const described = JSON.parse((await tools.describe_tools.handler({ names: ["tmux_broadcast", "delete_message"] })).content[0].text);
    expect(described).toMatchObject({ count: 2, requested: 2, missing: [], complete: true });
    expect(described.items.find((item: any) => item.name === "tmux_broadcast").parameters.length).toBeGreaterThan(0);
  });
});
