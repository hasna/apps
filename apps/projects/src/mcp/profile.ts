import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ProjectsMcpProfile = "core" | "full";
export const PROJECTS_MCP_PROFILE_ENV = "HASNA_PROJECTS_MCP_PROFILE";
export const PROJECTS_RAW_SERVER = Symbol("projects.raw-mcp-server");

/**
 * The default inventory is deliberately limited to the routine project
 * orientation and lifecycle operations an agent needs in most sessions.
 * Specialist tools remain available through search_tools/describe_tools and
 * the explicit full compatibility profile.
 */
export const PROJECTS_CORE_TOOL_NAMES = [
  "search_tools",
  "describe_tools",
  "projects_list",
  "projects_search",
  "projects_show",
  "projects_create",
  "projects_update",
  "projects_start",
  "projects_roots_list",
  "projects_roots_match",
  "projects_recipes_list",
  "projects_agents_list",
  "projects_locations_list",
  "projects_events_list",
  "projects_tmux_status",
  "projects_doctor",
  "projects_context",
  "projects_next",
  "projects_channel",
  "projects_runs_list",
] as const;

const CORE_TOOLS = new Set<string>(PROJECTS_CORE_TOOL_NAMES);

export interface ProjectsToolCatalogEntry {
  name: string;
  description: string;
  parameters: string[];
}

export class ProjectsToolCatalog {
  private readonly entries = new Map<string, ProjectsToolCatalogEntry>();

  record(name: string, description: string, inputSchema: unknown): void {
    const parameters = inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
      ? Object.keys(inputSchema as Record<string, unknown>)
      : [];
    this.entries.set(name, { name, description, parameters });
  }

  all(): ProjectsToolCatalogEntry[] {
    return [...this.entries.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  search(query = ""): ProjectsToolCatalogEntry[] {
    const normalized = query.trim().toLowerCase();
    return this.all().filter((entry) => !normalized
      || entry.name.toLowerCase().includes(normalized)
      || entry.description.toLowerCase().includes(normalized)
      || entry.parameters.some((parameter) => parameter.toLowerCase().includes(normalized)));
  }

  describe(names: string[]): { items: ProjectsToolCatalogEntry[]; missing: string[] } {
    const items: ProjectsToolCatalogEntry[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const entry = this.entries.get(name);
      if (entry) items.push(entry);
      else missing.push(name);
    }
    return { items, missing };
  }
}

export function resolveProjectsMcpProfile(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  defaultProfile: ProjectsMcpProfile = "core",
): ProjectsMcpProfile {
  let cliValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--mcp-profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--mcp-profile requires core or full");
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = value;
      index += 1;
    } else if (arg.startsWith("--mcp-profile=")) {
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = arg.slice("--mcp-profile=".length);
    }
  }
  const value = (cliValue ?? env[PROJECTS_MCP_PROFILE_ENV] ?? defaultProfile).trim().toLowerCase();
  if (value === "core" || value === "full") return value;
  throw new Error(`Invalid ${PROJECTS_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected core or full`);
}

export function canonicalProjectsServer(server: McpServer): McpServer {
  return ((server as McpServer & { [PROJECTS_RAW_SERVER]?: McpServer })[PROJECTS_RAW_SERVER]) ?? server;
}

export function createProfiledProjectsServer(
  server: McpServer,
  profile: ProjectsMcpProfile,
  catalog: ProjectsToolCatalog,
): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property === PROJECTS_RAW_SERVER) return target;
      if (property !== "tool" && property !== "registerTool") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        const description = property === "tool" && typeof args[1] === "string"
          ? args[1]
          : String((args[1] as Record<string, unknown> | undefined)?.description ?? "");
        const inputSchema = property === "tool"
          ? args[2]
          : (args[1] as Record<string, unknown> | undefined)?.inputSchema;
        catalog.record(name, description, inputSchema);
        if (profile !== "full" && !CORE_TOOLS.has(name)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
