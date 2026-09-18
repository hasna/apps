process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildServer } from "./index.js";
import {
  MEMENTOS_MCP_PROFILES,
  MEMENTOS_MCP_PROFILE_TOOLS,
  createProfiledMcpServer,
  resolveMcpProfileValue,
  selectMcpProfile,
} from "./profile.js";
import { ToolRegistry } from "./tools/tool-registry.js";

type InternalServer = ReturnType<typeof buildServer> & {
  _registeredResources: Record<string, unknown>;
  _registeredTools: Record<string, {
    inputSchema: { safeParse(value: unknown): { success: boolean } };
    handler(args: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }>;
  }>;
  server: {
    _requestHandlers: Map<string, (request: unknown) => Promise<{ tools: Array<{ name: string }> }>>;
  };
};

async function listTools(profile: string) {
  const server = buildServer(profile) as InternalServer;
  const handler = server.server._requestHandlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler missing");
  return { server, result: await handler({ method: "tools/list", params: {} }) };
}

describe("Mementos MCP profiles", () => {
  test("defines every sanctioned profile and defaults new agents to core", () => {
    expect(MEMENTOS_MCP_PROFILES).toEqual([
      "core",
      "search",
      "graph",
      "automation",
      "admin",
      "storage",
      "hooks",
      "full",
    ]);
    const selection = selectMcpProfile(undefined);
    expect(selection.profiles).toEqual(["core"]);
    expect(selection.full).toBe(false);
  });

  test("CLI profile wins over canonical and compatibility env names", () => {
    expect(resolveMcpProfileValue(
      ["bun", "mementos-mcp", "--mcp-profile", "graph"],
      { HASNA_MEMENTOS_MCP_PROFILE: "search", MEMENTOS_MCP_PROFILE: "full" },
    )).toBe("graph");
    expect(resolveMcpProfileValue([], { HASNA_MEMENTOS_MCP_PROFILE: "search", MEMENTOS_MCP_PROFILE: "full" })).toBe("search");
    expect(resolveMcpProfileValue([], { MEMENTOS_MCP_PROFILE: "hooks" })).toBe("hooks");
  });

  test("any unknown token fails the whole selection safely to bounded core", () => {
    for (const value of ["does-not-exist", "all", "admin,typo", "full,typo", "full,core", "full,full"]) {
      const selection = selectMcpProfile(value);
      expect(selection.profiles).toEqual(["core"]);
      expect(selection.full).toBe(false);
      expect(selection.unknown.length).toBeGreaterThan(0);
    }
  });

  test("rejects a missing explicit profile value", () => {
    expect(() => resolveMcpProfileValue(["bun", "mementos-mcp", "--mcp-profile"], {})).toThrow("--mcp-profile requires");
    expect(() => resolveMcpProfileValue(["bun", "mementos-mcp", "--mcp-profile="], {})).toThrow("--mcp-profile requires");
  });

  test("filters both legacy tool() and SDK registerTool() registration APIs", () => {
    const server = new McpServer({ name: "profile-proxy-test", version: "0.0.0" });
    const profiled = createProfiledMcpServer(server, selectMcpProfile("core"), new ToolRegistry()) as McpServer & {
      _registeredTools: Record<string, unknown>;
    };
    profiled.registerTool("migrate_pg", { description: "hidden", inputSchema: {} }, async () => ({ content: [] }));
    profiled.registerTool("memory_save", { description: "visible", inputSchema: {} }, async () => ({ content: [] }));
    expect(profiled._registeredTools["migrate_pg"]).toBeUndefined();
    expect(profiled._registeredTools["memory_save"]).toBeDefined();
  });

  test("core is bounded and full preserves the complete catalog", async () => {
    const core = await listTools("core");
    const full = await listTools("full");
    const coreNames = core.result.tools.map((tool) => tool.name);

    expect(coreNames).toContain("memory_save");
    expect(coreNames).toContain("memory_list");
    expect(coreNames).toContain("memory_inject");
    expect(coreNames).toContain("search_tools");
    expect(coreNames).toContain("describe_tools");
    expect(coreNames).not.toContain("migrate_pg");
    expect(coreNames).not.toContain("memory_gdpr_erase");
    expect(coreNames).not.toContain("register_machine");
    expect(coreNames).not.toContain("list_machines");
    expect(coreNames).not.toContain("rename_machine");
    expect(coreNames).not.toContain("set_primary_machine");
    expect(core.result.tools).toHaveLength(23);
    expect(Buffer.byteLength(JSON.stringify(core.result))).toBeLessThanOrEqual(16 * 1024);

    expect(full.result.tools).toHaveLength(124);
    const fullNames = new Set(full.result.tools.map((tool) => tool.name));
    expect(fullNames).toContain("migrate_pg");
    const categorizedNames = new Set(Object.values(MEMENTOS_MCP_PROFILE_TOOLS).flat());
    for (const name of categorizedNames) expect(fullNames).toContain(name);
    expect(Array.from(categorizedNames).sort()).toEqual(Array.from(fullNames).sort());
  });

  test("specialized profiles add their tools to core", async () => {
    const cases: Array<[string, string]> = [
      ["search", "memory_search_semantic"],
      ["search", "memory_audit_stats"],
      ["graph", "graph_query"],
      ["automation", "memory_auto_process"],
      ["admin", "memory_gdpr_erase"],
      ["admin", "register_machine"],
      ["storage", "mementos_storage_status"],
      ["hooks", "webhook_create"],
    ];
    for (const [profile, expectedTool] of cases) {
      const { result } = await listTools(profile);
      const names = result.tools.map((tool) => tool.name);
      expect(names).toContain("memory_save");
      expect(names).toContain(expectedTool);
      expect(names.length).toBeLessThan(124);
    }
  });

  test("machine tools remain exclusive to admin and exact full profiles", async () => {
    const machineTools = ["register_machine", "list_machines", "rename_machine", "set_primary_machine"];
    expect(MEMENTOS_MCP_PROFILE_TOOLS.admin.filter((name) => machineTools.includes(name))).toEqual(machineTools);
    for (const [profile, tools] of Object.entries(MEMENTOS_MCP_PROFILE_TOOLS)) {
      if (profile === "admin") continue;
      expect(tools.filter((name) => machineTools.includes(name))).toEqual([]);
    }
    for (const profile of ["core", "search", "graph", "automation", "storage", "hooks", "search,graph"]) {
      const names = (await listTools(profile)).result.tools.map((tool) => tool.name);
      expect(names.filter((name) => machineTools.includes(name))).toEqual([]);
    }
    for (const profile of ["admin", "full"]) {
      const names = (await listTools(profile)).result.tools.map((tool) => tool.name);
      expect(names.filter((name) => machineTools.includes(name)).sort()).toEqual([...machineTools].sort());
    }
    for (const profile of MEMENTOS_MCP_PROFILES.filter((profile) => profile !== "full")) {
      expect(Object.keys((buildServer(profile) as InternalServer)._registeredResources)).toEqual([]);
    }
  });

  test("comma-separated profiles compose without enabling full", async () => {
    const { result } = await listTools("search,graph");
    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain("memory_search_semantic");
    expect(names).toContain("graph_query");
    expect(names).not.toContain("migrate_pg");
    expect(names).not.toContain("register_machine");
  });

  test("reduced profiles omit legacy unpaged resources", () => {
    const core = buildServer("core") as InternalServer;
    const full = buildServer("full") as InternalServer;
    expect(Object.keys(core._registeredResources)).toEqual([]);
    expect(Object.keys(full._registeredResources).sort()).toEqual([
      "mementos://agents",
      "mementos://memories",
      "mementos://projects",
    ]);
  });
});

describe("bounded discovery tools", () => {
  test("search_tools returns only names plus truthful bounded page metadata", async () => {
    const server = buildServer("full") as InternalServer;
    const response = await server._registeredTools.search_tools!.handler({ query: "memory", limit: 2, offset: 0 });
    const payload = JSON.parse(response.content[0]!.text) as {
      names: string[];
      count: number;
      limit: number;
      offset: number;
      has_more: boolean;
      next_offset: number | null;
    };
    expect(payload.names).toHaveLength(2);
    expect(payload.count).toBe(2);
    expect(payload.limit).toBe(2);
    expect(payload.offset).toBe(0);
    expect(payload.has_more).toBe(true);
    expect(payload.next_offset).toBe(2);
    expect(Object.keys(payload).sort()).toEqual([
      "count",
      "has_more",
      "limit",
      "names",
      "next_offset",
      "offset",
    ]);
    expect(payload.names.every((name) => typeof name === "string" && !name.includes(":"))).toBe(true);
  });

  test("describe_tools requires one to ten explicit active names", async () => {
    const server = buildServer("core") as InternalServer;
    const schema = server._registeredTools.describe_tools!.inputSchema;
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ names: [] }).success).toBe(false);
    expect(schema.safeParse({ names: Array.from({ length: 11 }, (_, index) => `tool-${index}`) }).success).toBe(false);
    expect(schema.safeParse({ names: ["memory_list"] }).success).toBe(true);

    const response = await server._registeredTools.describe_tools!.handler({ names: ["memory_list"] });
    expect(response.content[0]!.text).toContain("### memory_list [memory]");
    expect(response.content[0]!.text).toContain("List memories");
    expect(response.content[0]!.text).not.toContain("memory_gdpr_erase");

    const saveDescription = await server._registeredTools.describe_tools!.handler({ names: ["memory_save"] });
    expect(saveDescription.content[0]!.text).toContain("key [required]: string");
    expect(saveDescription.content[0]!.text).toContain("scope: enum");

    for (const hiddenName of ["memory_gdpr_erase", "memory_profile", "clean_expired"]) {
      const hidden = await server._registeredTools.describe_tools!.handler({ names: [hiddenName] });
      expect(hidden.content[0]!.text).toContain("Unknown active-profile tool");
    }
  });
});
