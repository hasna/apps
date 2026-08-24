/**
 * Thread collection tools (task bf381fad): list_threads, expand_thread,
 * close_thread, reopen_thread, get_thread_unread.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import { getStore } from "../../lib/store/index.js";
import { identityFor } from "../identity.js";

export function registerThreadTools(server: McpServer): void {
  const resolveIdentity = identityFor(server);

  registerMcpTool(server, "list_threads", {
    description: "List reply threads in a channel: each thread root with its full descendant reply count, last activity, open/closed status, and (with `from`) the reader's unread count derived from per-message read receipts.",
    inputSchema: {
      channel: z.string(),
      from: z.string().optional().describe("Reader identity — enables the per-thread unread count"),
      limit: z.number().optional(),
      offset: z.number().optional(),
    },
  }, async (args: Record<string, any>) => {
    try {
      const result = await getStore().listThreads({
        channel: args.channel,
        from: args.from ? resolveIdentity(args.from) : undefined,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  registerMcpTool(server, "expand_thread", {
    description: "Expand one thread: the root message plus every descendant reply ordered by creation, each annotated with its nesting depth (0 = direct reply to the root). Any thread member resolves to its root.",
    inputSchema: {
      root: z.union([z.number(), z.string()]).describe("Thread root message ID or UUID (any thread member resolves to its root)"),
    },
  }, async (args: Record<string, any>) => {
    try {
      const root = Number(args.root);
      if (!Number.isSafeInteger(root) || root <= 0) {
        return { content: [{ type: "text" as const, text: "root must be a positive message id" }], isError: true };
      }
      const expanded = await getStore().getThreadExpand(root);
      return { content: [{ type: "text" as const, text: JSON.stringify(expanded) }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  const registerStatusTool = (name: "close_thread" | "reopen_thread", status: "closed" | "open"): void => {
    registerMcpTool(server, name, {
      description: name === "close_thread"
        ? "Close a reply thread by its root message id — no further replies are expected."
        : "Reopen a closed reply thread by its root message id.",
      inputSchema: {
        root: z.union([z.number(), z.string()]).describe("Thread root message ID or UUID (any thread member resolves to its root)"),
      },
    }, async (args: Record<string, any>) => {
      try {
        const root = Number(args.root);
        if (!Number.isSafeInteger(root) || root <= 0) {
          return { content: [{ type: "text" as const, text: "root must be a positive message id" }], isError: true };
        }
        const updated = await getStore().setThreadStatus(root, status);
        return { content: [{ type: "text" as const, text: JSON.stringify({ thread_id: updated.id, thread_status: updated.thread_status ?? status }) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    });
  };
  registerStatusTool("close_thread", "closed");
  registerStatusTool("reopen_thread", "open");

  registerMcpTool(server, "get_thread_unread", {
    description: "Per-agent unread count for one thread: foreign replies with no read receipt for the given agent.",
    inputSchema: {
      root: z.union([z.number(), z.string()]).describe("Thread root message ID or UUID"),
      agent: z.string().optional().describe("Reader identity (defaults to the connected identity)"),
    },
  }, async (args: Record<string, any>) => {
    try {
      const root = Number(args.root);
      if (!Number.isSafeInteger(root) || root <= 0) {
        return { content: [{ type: "text" as const, text: "root must be a positive message id" }], isError: true };
      }
      const agent = args.agent ? resolveIdentity(args.agent) : resolveIdentity(undefined);
      const unread = await getStore().getThreadUnreadCount(root, agent);
      return { content: [{ type: "text" as const, text: JSON.stringify({ thread_id: root, unread_count: unread, agent }) }] };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });
}
