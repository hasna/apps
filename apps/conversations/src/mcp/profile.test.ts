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
    expect(full.length).toBeGreaterThan(core.length * 2);
  });
});
