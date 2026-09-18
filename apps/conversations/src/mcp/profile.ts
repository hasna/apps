import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ConversationsMcpProfile = "core" | "full";
export const CONVERSATIONS_MCP_PROFILE_ENV = "HASNA_CONVERSATIONS_MCP_PROFILE";
export const CONVERSATIONS_RAW_SERVER = Symbol("conversations.raw-mcp-server");

export function canonicalConversationsServer(server: McpServer): McpServer {
  return ((server as McpServer & { [CONVERSATIONS_RAW_SERVER]?: McpServer })[CONVERSATIONS_RAW_SERVER]) ?? server;
}

/** Routine collaboration reads and writes. Specialist graph/analytics/tmux tools stay discoverable on demand. */
export const CONVERSATIONS_CORE_TOOL_NAMES = [
  "send_message", "send_to_channel", "send_to_session", "broadcast", "reply",
  "read_messages", "read_channel", "read_digest", "get_message", "search_messages",
  "mark_read", "mark_channel_read", "delete_message", "edit_message", "pin_message", "unpin_message",
  "react", "unreact", "get_pinned_messages", "list_sessions", "list_unread_counts",
  "create_channel", "list_channels", "join_channel", "leave_channel", "update_channel", "rename_channel",
  "archive_channel", "unarchive_channel", "subscribe_channel_notifications", "unsubscribe_channel_notifications",
  "list_channel_subscriptions", "read_channel_notifications", "mark_channel_notifications_read",
  "create_project", "list_projects", "get_project", "update_project", "delete_project",
  "set_focus", "get_focus", "unfocus", "register_agent", "heartbeat", "list_agents", "get_blockers",
  "remove_agent", "rename_agent", "acquire_lock", "bulk_acquire_lock", "release_lock", "check_lock", "list_locks",
  "create_task", "get_task", "list_tasks", "start_task", "complete_task", "cancel_task", "block_task",
  "unblock_task", "reopen_task", "assign_task", "delete_task", "add_comment", "get_comments",
  "add_dependency", "remove_dependency", "get_dependencies", "get_dependents", "close_thread", "reopen_thread",
  "search_tools", "describe_tools", "send_feedback",
] as const;

const CORE_TOOLS = new Set<string>(CONVERSATIONS_CORE_TOOL_NAMES);

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

export function resolveConversationsMcpProfile(
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = process.env,
  defaultProfile: ConversationsMcpProfile = "core",
): ConversationsMcpProfile {
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
  const value = (cliValue ?? env[CONVERSATIONS_MCP_PROFILE_ENV] ?? defaultProfile).trim().toLowerCase();
  if (value === "core" || value === "full") return value;
  throw new Error(`Invalid ${CONVERSATIONS_MCP_PROFILE_ENV} value ${JSON.stringify(value)}: expected core or full`);
}

export function shouldRegisterConversationsTool(name: string, profile: ConversationsMcpProfile): boolean {
  return profile === "full" || CORE_TOOLS.has(name);
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
  const inputSchema = args.find((value, index) => index >= 2 && value && typeof value === "object" && !Array.isArray(value));
  return { description, inputSchema };
}

export function createProfiledConversationsServer(
  server: McpServer,
  profile: ConversationsMcpProfile,
  catalog: ConversationsToolCatalog,
): McpServer {
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property === CONVERSATIONS_RAW_SERVER) return target;
      if (property !== "tool" && property !== "registerTool") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        const metadata = registrationMetadata(property, args);
        catalog.record(name, metadata.description, metadata.inputSchema);
        if (!shouldRegisterConversationsTool(name, profile)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
