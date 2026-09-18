import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolRegistry } from "./tools/tool-registry.js";

export const MEMENTOS_MCP_PROFILES = [
  "core",
  "search",
  "graph",
  "automation",
  "admin",
  "storage",
  "hooks",
  "full",
] as const;

export type MementosMcpProfile = (typeof MEMENTOS_MCP_PROFILES)[number];

const CORE_TOOLS = [
  "memory_save",
  "memory_recall",
  "memory_get",
  "memory_list",
  "memory_update",
  "memory_search",
  "memory_inject",
  "memory_briefing",
  "memory_pin",
  "memory_archive",
  "memory_forget",
  "memory_stats",
  "register_agent",
  "get_agent",
  "update_agent",
  "register_project",
  "get_project",
  "set_focus",
  "get_focus",
  "heartbeat",
  "search_tools",
  "describe_tools",
  "session_extract",
] as const;

const SEARCH_TOOLS = [
  "memory_context",
  "memory_stats",
  "memory_search_semantic",
  "memory_search_hybrid",
  "memory_search_bm25",
  "memory_recall_deep",
  "memory_versions",
  "memory_diff",
  "memory_chain_get",
  "memory_health",
  "memory_check_contradiction",
  "memory_invalidate",
  "memory_stale",
  "memory_flag",
  "memory_activity",
  "memory_report",
  "memory_audit_trail",
  "memory_audit_export",
  "memory_audit_stats",
] as const;

const GRAPH_TOOLS = [
  "entity_create",
  "entity_get",
  "entity_list",
  "entity_delete",
  "entity_merge",
  "entity_link",
  "entity_update",
  "entity_unlink",
  "entity_disambiguate",
  "relation_get",
  "relation_create",
  "relation_list",
  "relation_delete",
  "graph_query",
  "graph_path",
  "graph_stats",
  "graph_traverse",
  "build_file_dep_graph",
  "memory_tool_insights",
] as const;

const AUTOMATION_TOOLS = [
  "memory_context_layered",
  "clean_expired",
  "memory_profile",
  "memory_synthesize",
  "memory_synthesis_status",
  "memory_synthesis_history",
  "memory_synthesis_rollback",
  "memory_auto_process",
  "memory_auto_status",
  "memory_auto_config",
  "memory_auto_test",
  "memory_autoinject_config",
  "memory_autoinject_status",
  "memory_autoinject_test",
  "memory_ingest_session",
  "memory_session_status",
  "memory_session_list",
  "session_extract",
  "memory_consolidate",
  "memory_reflect",
] as const;

const ADMIN_TOOLS = [
  "unfocus",
  "list_agents",
  "list_agents_by_project",
  "list_projects",
  "register_machine",
  "list_machines",
  "rename_machine",
  "set_primary_machine",
  "bulk_forget",
  "bulk_update",
  "memory_lock",
  "memory_unlock",
  "memory_check_lock",
  "resource_lock",
  "resource_unlock",
  "resource_check_lock",
  "list_agent_locks",
  "clean_expired_locks",
  "memory_export",
  "memory_import",
  "memory_audit",
  "memory_rate",
  "memory_gdpr_erase",
  "memory_acl_set",
  "memory_acl_list",
  "memory_evict",
  "memory_save_image",
  "memory_compress",
] as const;

const STORAGE_TOOLS = [
  "mementos_storage_status",
  "mementos_storage_push",
  "mementos_storage_pull",
  "mementos_storage_sync",
  "mementos_storage_migrate_dry_run",
  "migrate_pg",
] as const;

const HOOK_TOOLS = [
  "hook_list",
  "hook_stats",
  "webhook_create",
  "webhook_list",
  "webhook_delete",
  "webhook_update",
  "memory_subscribe",
  "memory_unsubscribe",
  "memory_save_tool_event",
  "send_feedback",
  "mementos_storage_feedback",
] as const;

export const MEMENTOS_MCP_PROFILE_TOOLS: Record<Exclude<MementosMcpProfile, "full">, readonly string[]> = {
  core: CORE_TOOLS,
  search: SEARCH_TOOLS,
  graph: GRAPH_TOOLS,
  automation: AUTOMATION_TOOLS,
  admin: ADMIN_TOOLS,
  storage: STORAGE_TOOLS,
  hooks: HOOK_TOOLS,
};

const PROFILE_NAMES = new Set<string>(MEMENTOS_MCP_PROFILES);

function isMcpProfile(token: string): token is MementosMcpProfile {
  return PROFILE_NAMES.has(token);
}

export interface McpProfileSelection {
  raw: string;
  profiles: MementosMcpProfile[];
  unknown: string[];
  full: boolean;
  toolNames: ReadonlySet<string>;
}

function splitProfileTokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveMcpProfileValue(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const index = argv.indexOf("--mcp-profile");
  if (index !== -1) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--mcp-profile requires a comma-separated MCP profile list");
    }
    return value;
  }
  const inline = argv.find((arg) => arg.startsWith("--mcp-profile="));
  if (inline) {
    const value = inline.slice("--mcp-profile=".length);
    if (!value) throw new Error("--mcp-profile requires a comma-separated MCP profile list");
    return value;
  }
  return env.HASNA_MEMENTOS_MCP_PROFILE ?? env.MEMENTOS_MCP_PROFILE ?? "core";
}

export function selectMcpProfile(value: string | undefined): McpProfileSelection {
  const tokens = splitProfileTokens(value || "core");
  const normalized = tokens.length > 0 ? tokens : ["core"];
  const unknownTokens = normalized.filter((token) => !isMcpProfile(token));
  const recognized = normalized.filter(isMcpProfile);
  const mixedFull = recognized.includes("full") && normalized.length !== 1;
  const unknown = mixedFull
    ? [...unknownTokens, "full (must be used alone)"]
    : unknownTokens;
  // Profile parsing is privilege-bearing: one unknown token or a mixed `full`
  // selection invalidates the whole request and falls back to core. Only the
  // exact sanctioned `full` token may expose the complete administrative surface.
  const profiles: MementosMcpProfile[] = unknown.length > 0
    ? ["core"]
    : (recognized.length > 0 ? recognized : ["core"]);
  const full = profiles.length === 1 && profiles[0] === "full";
  const toolNames = new Set<string>(CORE_TOOLS);
  if (!full) {
    for (const profile of profiles) {
      if (profile === "core" || profile === "full") continue;
      for (const name of MEMENTOS_MCP_PROFILE_TOOLS[profile]) toolNames.add(name);
    }
  }
  return {
    raw: value || "core",
    profiles,
    unknown,
    full,
    toolNames,
  };
}

export function shouldRegisterMcpTool(name: string, selection: McpProfileSelection): boolean {
  return selection.full || selection.toolNames.has(name);
}

export function toolCategory(name: string): string {
  if (name === "search_tools" || name === "describe_tools") return "meta";
  if (["register_agent", "get_agent", "update_agent", "list_agents", "list_agents_by_project", "heartbeat"].includes(name)) return "agent";
  if (["register_project", "get_project", "list_projects", "set_focus", "get_focus", "unfocus", "register_machine", "list_machines", "rename_machine", "set_primary_machine"].includes(name)) return "project";
  if (name === "session_extract") return "automation";
  if (GRAPH_TOOLS.includes(name as never)) return "graph";
  if (HOOK_TOOLS.includes(name as never)) return "hooks";
  if (STORAGE_TOOLS.includes(name as never)) return "storage";
  if (AUTOMATION_TOOLS.includes(name as never)) return "automation";
  if (ADMIN_TOOLS.includes(name as never)) {
    if (name.includes("agent")) return "agent";
    if (name.includes("project") || name.includes("machine") || name.includes("focus")) return "project";
    if (name.startsWith("bulk_")) return "bulk";
    return "admin";
  }
  if (SEARCH_TOOLS.includes(name as never)) return "search";
  return "memory";
}

function findInputShape(args: unknown[]): Record<string, unknown> | undefined {
  for (let index = 2; index < args.length - 1; index += 1) {
    const candidate = args[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const values = Object.values(candidate as Record<string, unknown>);
    if (values.length === 0 || values.some((value) => value && typeof value === "object" && "_def" in value)) {
      return candidate as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * Registration-only adapter: excluded tools are never added to tools/list, while
 * every included tool is captured in the per-server discovery registry.
 */
export function createProfiledMcpServer(
  server: McpServer,
  selection: McpProfileSelection,
  registry: ToolRegistry,
): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "tool" && property !== "registerTool") {
        return Reflect.get(target, property, receiver);
      }
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        if (!shouldRegisterMcpTool(name, selection)) return undefined;
        const config = property === "registerTool" && args[1] && typeof args[1] === "object"
          ? args[1] as Record<string, unknown>
          : undefined;
        const description = property === "tool"
          ? (typeof args[1] === "string" ? args[1] : "")
          : (typeof config?.["description"] === "string" ? config["description"] : "");
        const inputShape = property === "tool"
          ? findInputShape(args)
          : (config?.["inputSchema"] as Record<string, unknown> | undefined);
        registry.registerDiscoveredTool(name, description, toolCategory(name), inputShape);
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}

export function legacyResourcesEnabled(selection: McpProfileSelection): boolean {
  return selection.full;
}
