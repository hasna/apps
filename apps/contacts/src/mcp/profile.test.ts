import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";
import { CONTACTS_FULL_TOOL_COUNT, resolveContactsMcpProfile, shouldRegisterContactsTool } from "./profile.js";

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
    expect(full).toHaveLength(CONTACTS_FULL_TOOL_COUNT);
    expect(full.length).toBeGreaterThan(core.length * 4);
    expect(shouldRegisterContactsTool("contacts_connection_status", "core")).toBe(true);
    const listSchema = ((buildServer("core") as any)._registeredTools.list_contacts.inputSchema ?? {});
    expect(Object.keys(listSchema.shape ?? listSchema)).not.toContain("project_id");
  });
  test("core discovery describes every full-profile tool with its complete schema", async () => {
    const tools = (buildServer("core") as any)._registeredTools;
    const result = await tools.describe_tools.handler({ names: ["vault_unlock", "contacts_connection_status"] });
    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({ count: 2, requested: 2, missing: [], complete: true });
    expect(payload.items.find((item: any) => item.name === "vault_unlock").inputSchema).toBeDefined();
    expect(payload.items.find((item: any) => item.name === "contacts_connection_status").inputSchema).toEqual({ type: "object", properties: {} });
  });

});
