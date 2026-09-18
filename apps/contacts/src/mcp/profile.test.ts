import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";
import { resolveContactsMcpProfile, shouldRegisterContactsTool } from "./profile.js";

describe("Contacts MCP profiles", () => {
  test("defaults to core and validates explicit full escape hatch", () => {
    expect(resolveContactsMcpProfile([], {})).toBe("core");
    expect(resolveContactsMcpProfile([], { HASNA_CONTACTS_MCP_PROFILE: "full" })).toBe("full");
    expect(resolveContactsMcpProfile(["--mcp-profile", "full"], {})).toBe("full");
    expect(() => resolveContactsMcpProfile(["--mcp-profile", "wide"], {})).toThrow(/expected core or full/);
  });

  test("core advertises discovery plus routine contact tools while full preserves all tools", () => {
    const core = Object.keys((buildServer("core") as any)._registeredTools);
    const full = Object.keys((buildServer("full") as any)._registeredTools);
    expect(core).toContain("list_contacts");
    expect(core).toContain("search_tools");
    expect(core).not.toContain("vault_unlock");
    expect(full).toContain("vault_unlock");
    expect(full.length).toBeGreaterThan(core.length * 4);
    expect(shouldRegisterContactsTool("contacts_connection_status", "core")).toBe(true);
  });
});
