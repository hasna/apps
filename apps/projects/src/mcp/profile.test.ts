import { describe, expect, test } from "bun:test";
import { buildServer } from "./index.js";
import {
  PROJECTS_CORE_TOOL_NAMES,
  resolveProjectsMcpProfile,
} from "./profile.js";

type InternalServer = {
  _registeredTools: Record<string, {
    handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }>;
  }>;
  server: {
    _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: Array<{ name: string }> }>>;
  };
};

async function listTools(profile?: "core" | "full") {
  const server = buildServer(profile) as unknown as InternalServer;
  const handler = server.server._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler missing");
  return { server, result: await handler({ method: "tools/list", params: {} }) };
}

describe("Projects MCP profiles", () => {
  test("defaults to core and validates explicit full selection", () => {
    expect(resolveProjectsMcpProfile([], {})).toBe("core");
    expect(resolveProjectsMcpProfile([], { HASNA_PROJECTS_MCP_PROFILE: "full" })).toBe("full");
    expect(resolveProjectsMcpProfile(["--mcp-profile", "full"], {})).toBe("full");
    expect(resolveProjectsMcpProfile(["--mcp-profile=core"], { HASNA_PROJECTS_MCP_PROFILE: "full" })).toBe("core");
    expect(() => resolveProjectsMcpProfile(["--mcp-profile=wide"], {})).toThrow(/expected core or full/);
    expect(() => resolveProjectsMcpProfile(["--mcp-profile"], {})).toThrow(/requires/);
  });

  test("core inventory is ratcheted to twenty essential tools and stays under 19 KiB", async () => {
    const { result } = await listTools();
    const names = result.tools.map((tool) => tool.name);
    expect(names).toHaveLength(20);
    expect([...names].sort()).toEqual([...PROJECTS_CORE_TOOL_NAMES].sort());
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(19 * 1024);
  });

  test("full preserves every existing tool plus bounded discovery", async () => {
    const { result } = await listTools("full");
    const names = new Set(result.tools.map((tool) => tool.name));
    expect(result.tools).toHaveLength(71);
    for (const name of [
      "projects_roots_add",
      "projects_import",
      "projects_import_github",
      "projects_render_list",
      "projects_agent_prompt",
      "projects_delete",
      "search_tools",
      "describe_tools",
    ]) expect(names).toContain(name);
  });

  test("core discovery searches and describes hidden full-profile tools", async () => {
    const { server } = await listTools();
    const searched = JSON.parse((await server._registeredTools.search_tools!.handler({ query: "import", limit: 10 })).content[0]!.text) as {
      items: string[];
      total: number;
      has_more: boolean;
      complete_inventory: boolean;
    };
    expect(searched.items).toContain("projects_import_github");
    expect(searched.complete_inventory).toBe(true);
    expect(searched.total).toBeGreaterThan(searched.items.length - 1);

    const described = JSON.parse((await server._registeredTools.describe_tools!.handler({
      names: ["projects_import_github", "projects_list"],
    })).content[0]!.text) as {
      items: Array<{ name: string; parameters: string[] }>;
      count: number;
      missing: string[];
      complete: boolean;
    };
    expect(described).toMatchObject({ count: 2, missing: [], complete: true });
    expect(described.items.find((item) => item.name === "projects_import_github")?.parameters).toContain("repo");
  });
});
