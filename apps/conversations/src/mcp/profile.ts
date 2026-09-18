import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ConversationsMcpProfile = "core" | "full";
export const CONVERSATIONS_MCP_PROFILE_ENV = "HASNA_CONVERSATIONS_MCP_PROFILE";

const CORE_TOOLS = new Set([
  "send_message",
  "send_to_channel",
  "read_messages",
  "read_channel",
  "get_message",
  "read_digest",
  "reply",
  "mark_read",
  "mark_channel_read",
  "search_messages",
  "list_sessions",
  "list_channels",
  "create_channel",
  "join_channel",
  "leave_channel",
  "list_unread_counts",
  "subscribe_channel_notifications",
  "unsubscribe_channel_notifications",
  "list_channel_subscriptions",
  "read_channel_notifications",
  "mark_channel_notifications_read",
  "create_project",
  "list_projects",
  "get_project",
  "set_focus",
  "get_focus",
  "unfocus",
  "register_agent",
  "heartbeat",
  "list_agents",
  "get_blockers",
  "acquire_lock",
  "release_lock",
  "check_lock",
  "list_locks",
  "create_task",
  "get_task",
  "list_tasks",
  "start_task",
  "complete_task",
  "block_task",
  "unblock_task",
  "add_comment",
  "search_tools",
  "describe_tools",
  "send_feedback",
]);

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

export function createProfiledConversationsServer(server: McpServer, profile: ConversationsMcpProfile): McpServer {
  if (profile === "full") return server;
  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "tool" && property !== "registerTool") return Reflect.get(target, property, receiver);
      return (...args: unknown[]) => {
        const name = String(args[0] ?? "");
        if (!shouldRegisterConversationsTool(name, profile)) return undefined;
        const method = target[property] as (...toolArgs: unknown[]) => unknown;
        return method.apply(target, args);
      };
    },
  }) as McpServer;
}
