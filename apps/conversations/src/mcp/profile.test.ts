import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";
import { resolveConversationsMcpProfile } from "./profile.js";

describe("Conversations MCP profiles", () => {
  test("defaults to core and accepts the explicit full escape hatch", () => {
    expect(resolveConversationsMcpProfile([], {})).toBe("core");
    expect(resolveConversationsMcpProfile([], { HASNA_CONVERSATIONS_MCP_PROFILE: "full" })).toBe("full");
    expect(resolveConversationsMcpProfile(["--mcp-profile=full"], {})).toBe("full");
    expect(() => resolveConversationsMcpProfile(["--mcp-profile", "wide"], {})).toThrow(/expected core or full/);
  });

  test("core keeps coordination tools and omits specialist administration", () => {
    const core = Object.keys((buildServer(true, "core") as any)._registeredTools);
    const full = Object.keys((buildServer(true, "full") as any)._registeredTools);
    expect(core).toContain("read_messages");
    expect(core).toContain("list_tasks");
    expect(core).toContain("search_tools");
    expect(core).not.toContain("tmux_broadcast");
    expect(full).toContain("tmux_broadcast");
    expect(full.length).toBeGreaterThan(core.length);
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
