import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ReposMcpProfile = "core" | "full";
export const REPOS_MCP_PROFILE_ENV = "HASNA_REPOS_MCP_PROFILE";

const CORE_TOOLS = new Set([
  "search_tools", "describe_tools",
  "list_repos", "get_repo", "search_repos", "list_commits", "search_commits",
  "list_branches", "list_tags", "list_prs", "search_prs", "list_remotes", "search",
  "get_stats", "get_repo_stats", "graph_query", "graph_related", "graph_path", "graph_deps",
  "graph_stats", "fetch_repo_metadata", "register_agent", "heartbeat", "list_agents",
]);

export interface ReposToolCatalogEntry {
  name: string;
  description: string;
  parameters: string[];
}

export class ReposToolCatalog {
  private readonly entries = new Map<string, ReposToolCatalogEntry>();

  record(name: string, description: string, inputSchema: unknown): void {
    const parameters = inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
      ? Object.keys(inputSchema as Record<string, unknown>)
      : [];
    this.entries.set(name, { name, description, parameters });
  }

  search(query = ""): ReposToolCatalogEntry[] {
    const normalized = query.trim().toLowerCase();
    return [...this.entries.values()]
      .filter((entry) => !normalized || entry.name.includes(normalized) || entry.description.toLowerCase().includes(normalized))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  describe(names: string[]) {
    const items: ReposToolCatalogEntry[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const entry = this.entries.get(name);
      if (entry) items.push(entry);
      else missing.push(name);
    }
    return { items, missing };
  }
}

export function resolveReposMcpProfile(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  defaultProfile: ReposMcpProfile = "core",
): ReposMcpProfile {
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
  const value = (cliValue ?? env[REPOS_MCP_PROFILE_ENV] ?? defaultProfile).trim().toLowerCase();
  if (value === "core" || value === "full") return value;
  throw new Error(`Invalid ${REPOS_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected core or full`);
}

export function createProfiledReposServer(
  server: McpServer,
  profile: ReposMcpProfile,
  catalog: ReposToolCatalog,
): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "tool" && property !== "registerTool") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        const description = property === "tool" && typeof args[1] === "string"
          ? args[1]
          : String((args[1] as Record<string, unknown> | undefined)?.description ?? "");
        const inputSchema = property === "tool" ? args[2] : (args[1] as Record<string, unknown> | undefined)?.inputSchema;
        catalog.record(name, description, inputSchema);
        if (profile !== "full" && !CORE_TOOLS.has(name)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
