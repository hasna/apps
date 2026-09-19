import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const CONVERSATIONS_MCP_PROFILES = [
  "core",
  "messaging",
  "channels",
  "projects",
  "agents",
  "tasks",
  "threads",
  "insights",
  "admin",
  "full",
] as const;

export type ConversationsMcpProfile = (typeof CONVERSATIONS_MCP_PROFILES)[number];
export const CONVERSATIONS_MCP_PROFILE_ENV = "HASNA_CONVERSATIONS_MCP_PROFILE";
export const CONVERSATIONS_RAW_SERVER = Symbol("conversations.raw-mcp-server");

export function canonicalConversationsServer(server: McpServer): McpServer {
  return ((server as McpServer & { [CONVERSATIONS_RAW_SERVER]?: McpServer })[CONVERSATIONS_RAW_SERVER]) ?? server;
}

/**
 * The default inventory is deliberately small: routine messaging, search and
 * session context stay immediately callable while specialist administration is
 * discoverable through search_tools/describe_tools and opt-in profiles.
 */
export const CONVERSATIONS_CORE_TOOL_NAMES = [
  "send_message",
  "send_to_channel",
  "send_to_session",
  "reply",
  "read_messages",
  "read_channel",
  "read_digest",
  "get_message",
  "search_messages",
  "mark_read",
  "mark_channel_read",
  "list_unread_counts",
  "list_channels",
  "join_channel",
  "leave_channel",
  "list_sessions",
  "register_agent",
  "heartbeat",
  "list_agents",
  "set_focus",
  "get_focus",
  "get_blockers",
  "get_summary",
  "search_tools",
  "describe_tools",
] as const;

const MESSAGING_TOOLS = [
  "broadcast", "mark_unread", "delete_message", "edit_message", "pin_message", "unpin_message",
  "get_pinned_messages", "export_messages",
] as const;

const CHANNEL_TOOLS = [
  "create_channel", "subscribe_channel_notifications", "unsubscribe_channel_notifications",
  "list_channel_subscriptions", "read_channel_notifications", "mark_channel_notifications_read",
  "update_channel", "rename_channel", "archive_channel", "unarchive_channel", "set_channel_topic",
  "get_channel_topic", "summarize_channel",
] as const;

const PROJECT_TOOLS = [
  "create_project", "list_projects", "get_project", "update_project", "delete_project",
] as const;

const AGENT_TOOLS = [
  "remove_agent", "rename_agent", "unfocus", "get_session_activity",
] as const;

const TASK_TOOLS = [
  "create_task", "get_task", "list_tasks", "start_task", "complete_task", "cancel_task", "block_task",
  "unblock_task", "reopen_task", "assign_task", "set_task_priority", "delete_task", "add_comment",
  "get_comments", "get_subtasks", "get_task_tree", "add_dependency", "remove_dependency",
  "get_dependencies", "get_dependents", "get_task_activity", "get_due_tasks", "get_task_summary", "search_tasks",
] as const;

const THREAD_TOOLS = [
  "list_threads", "expand_thread", "get_thread_unread", "get_thread_replies", "read_thread",
  "close_thread", "reopen_thread",
] as const;

const INSIGHT_TOOLS = [
  "read_receipts", "mark_read_receipt", "react", "unreact", "add_reaction", "remove_reaction",
  "get_reactions", "get_reaction_summary", "get_mentions", "mark_mentions_read", "build_graph",
  "get_related", "get_agent_network", "graph_stats", "get_topics", "trending_topics", "hot_sessions",
] as const;

const ADMIN_TOOLS = [
  "acquire_lock", "release_lock", "check_lock", "list_locks", "bulk_acquire_lock", "clean_expired_locks",
  "tmux_send", "tmux_broadcast", "send_feedback",
] as const;

export const CONVERSATIONS_MCP_PROFILE_TOOLS: Record<Exclude<ConversationsMcpProfile, "full">, readonly string[]> = {
  core: CONVERSATIONS_CORE_TOOL_NAMES,
  messaging: MESSAGING_TOOLS,
  channels: CHANNEL_TOOLS,
  projects: PROJECT_TOOLS,
  agents: AGENT_TOOLS,
  tasks: TASK_TOOLS,
  threads: THREAD_TOOLS,
  insights: INSIGHT_TOOLS,
  admin: ADMIN_TOOLS,
};

const PROFILE_NAMES = new Set<string>(CONVERSATIONS_MCP_PROFILES);

function isMcpProfile(value: string): value is ConversationsMcpProfile {
  return PROFILE_NAMES.has(value);
}

export interface ConversationsMcpProfileSelection {
  raw: string;
  profiles: ConversationsMcpProfile[];
  full: boolean;
  toolNames: ReadonlySet<string>;
}

function splitProfiles(value: string): string[] {
  return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function selectConversationsMcpProfile(value = "core"): ConversationsMcpProfileSelection {
  const tokens = splitProfiles(value || "core");
  if (tokens.length === 0) throw new Error("MCP profile selection cannot be empty");
  const unknown = tokens.filter((token) => !isMcpProfile(token));
  if (unknown.length > 0) {
    throw new Error(`Invalid ${CONVERSATIONS_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected a comma-separated list of ${CONVERSATIONS_MCP_PROFILES.join(", ")}`);
  }
  const profiles = [...new Set(tokens)] as ConversationsMcpProfile[];
  if (profiles.includes("full") && profiles.length !== 1) {
    throw new Error("The full MCP profile must be selected alone");
  }
  const full = profiles[0] === "full";
  const toolNames = new Set<string>(CONVERSATIONS_CORE_TOOL_NAMES);
  if (!full) {
    for (const profile of profiles) {
      if (profile === "core" || profile === "full") continue;
      for (const name of CONVERSATIONS_MCP_PROFILE_TOOLS[profile]) toolNames.add(name);
    }
  }
  return { raw: value, profiles, full, toolNames };
}

export function resolveConversationsMcpProfile(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  defaultProfile = "core",
): string {
  let cliValue: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--mcp-profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--mcp-profile requires a comma-separated profile list");
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = value;
      index += 1;
    } else if (arg.startsWith("--mcp-profile=")) {
      if (cliValue !== undefined) throw new Error("--mcp-profile may be provided only once");
      cliValue = arg.slice("--mcp-profile=".length);
      if (!cliValue) throw new Error("--mcp-profile requires a comma-separated profile list");
    }
  }
  const value = cliValue ?? env[CONVERSATIONS_MCP_PROFILE_ENV] ?? defaultProfile;
  return selectConversationsMcpProfile(value).profiles.join(",");
}

export function shouldRegisterConversationsTool(name: string, selection: ConversationsMcpProfileSelection): boolean {
  return selection.full || selection.toolNames.has(name);
}

export interface ConversationsToolCatalogEntry {
  name: string;
  description: string;
  parameters: string[];
}

export class ConversationsToolCatalog {
  private readonly entries = new Map<string, ConversationsToolCatalogEntry>();

  record(name: string, description: string, inputSchema: unknown): void {
    const parameters = inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
      ? Object.keys(inputSchema as Record<string, unknown>)
      : [];
    this.entries.set(name, { name, description, parameters });
  }

  all(): ConversationsToolCatalogEntry[] {
    return [...this.entries.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  search(query = ""): ConversationsToolCatalogEntry[] {
    const normalized = query.trim().toLowerCase();
    return this.all().filter((entry) => !normalized
      || entry.name.toLowerCase().includes(normalized)
      || entry.description.toLowerCase().includes(normalized));
  }

  describe(names: string[]): { items: ConversationsToolCatalogEntry[]; missing: string[] } {
    const items: ConversationsToolCatalogEntry[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const entry = this.entries.get(name);
      if (entry) items.push(entry);
      else missing.push(name);
    }
    return { items, missing };
  }
}

function registrationMetadata(property: string | symbol, args: unknown[]) {
  if (property === "registerTool") {
    const config = args[1] && typeof args[1] === "object" ? args[1] as Record<string, unknown> : {};
    return {
      description: typeof config.description === "string" ? config.description : "",
      inputSchema: config.inputSchema,
    };
  }
  const description = typeof args[1] === "string" ? args[1] : "";
  const inputSchema = args.find((candidate, index) => index >= 2 && candidate && typeof candidate === "object" && !Array.isArray(candidate));
  return { description, inputSchema };
}

export function createProfiledConversationsServer(
  server: McpServer,
  profile: ConversationsMcpProfileSelection | string,
  catalog: ConversationsToolCatalog,
): McpServer {
  const selection = typeof profile === "string" ? selectConversationsMcpProfile(profile) : profile;
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property === CONVERSATIONS_RAW_SERVER) return target;
      if (property !== "tool" && property !== "registerTool") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        const metadata = registrationMetadata(property, args);
        catalog.record(name, metadata.description, metadata.inputSchema);
        if (!shouldRegisterConversationsTool(name, selection)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
