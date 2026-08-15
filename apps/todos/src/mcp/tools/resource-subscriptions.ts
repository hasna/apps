import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerResourceSubscriptionTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  const uris = ["todos://tasks", "todos://projects", "todos://plans", "todos://agents", "todos://verification"] as const;

  for (const uri of uris) {
    const name = uri.replace("todos://", "");
    server.resource(
      `${name}-snapshot`,
      `${uri}/snapshot`,
      { description: `Live snapshot of ${name}`, mimeType: "application/json" },
      async () => {
        const { buildResourceSnapshot } = await import("../../lib/resource-snapshots.js");
        const snap = buildResourceSnapshot(uri);
        return {
          contents: [{
            uri: `${uri}/snapshot`,
            mimeType: "application/json",
            text: JSON.stringify(snap, null, 2),
          }],
        };
      },
    );
  }

  if (shouldRegisterTool("subscribe_resource")) {
    server.tool(
      "subscribe_resource",
      "Subscribe to local MCP resource change notifications (poll via get_resource_changes).",
      {
        uri: z.enum(["todos://tasks", "todos://projects", "todos://plans", "todos://agents", "todos://verification"]),
        agent_id: z.string().optional(),
      },
      async ({ uri, agent_id }) => {
        try {
          const { subscribeResource } = await import("../../lib/resource-snapshots.js");
          const sub = subscribeResource(uri, agent_id);
          return { content: [{ type: "text" as const, text: `Subscribed to ${sub.uri} at ${sub.subscribed_at}` }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("unsubscribe_resource")) {
    server.tool(
      "unsubscribe_resource",
      "Unsubscribe from a resource URI.",
      {
        uri: z.enum(["todos://tasks", "todos://projects", "todos://plans", "todos://agents", "todos://verification"]),
        agent_id: z.string().optional(),
      },
      async ({ uri, agent_id }) => {
        try {
          const { unsubscribeResource } = await import("../../lib/resource-snapshots.js");
          const ok = unsubscribeResource(uri, agent_id);
          return { content: [{ type: "text" as const, text: ok ? "Unsubscribed." : "No subscription found." }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_resource_snapshot")) {
    server.tool(
      "get_resource_snapshot",
      "Fetch a fresh local resource snapshot with stale_after metadata.",
      {
        uri: z.enum(["todos://tasks", "todos://projects", "todos://plans", "todos://agents", "todos://verification"]),
        stale_ms: z.number().optional(),
      },
      async ({ uri, stale_ms }) => {
        try {
          const { buildResourceSnapshot } = await import("../../lib/resource-snapshots.js");
          const snap = buildResourceSnapshot(uri, stale_ms);
          return { content: [{ type: "text" as const, text: JSON.stringify(snap, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_resource_changes")) {
    server.tool(
      "get_resource_changes",
      "Poll for resource URIs with task changes since timestamp.",
      { since: z.string().describe("ISO timestamp from last check") },
      async ({ since }) => {
        try {
          const { getChangedResourcesSince, listSubscriptions } = await import("../../lib/resource-snapshots.js");
          const changes = getChangedResourcesSince(since);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({ changes, subscriptions: listSubscriptions() }, null, 2),
            }],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("resource_diagnostics")) {
    server.tool(
      "resource_diagnostics",
      "Show MCP resource subscription diagnostics.",
      {},
      async () => {
        try {
          const { resourceDiagnostics } = await import("../../lib/resource-snapshots.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(resourceDiagnostics(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
