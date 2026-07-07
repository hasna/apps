import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppLifecycleSchema, ReleaseChannelSchema } from "../contracts.js";
import { CatalogStore } from "../store.js";
import type { CatalogStoreLike } from "../types.js";

function textContent(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonContent(value: unknown): CallToolResult {
  return textContent(JSON.stringify(value, null, 2));
}

function errorContent(message: string): CallToolResult {
  return { ...textContent(message), isError: true };
}

export function registerCatalogMcpTools(server: McpServer, storeInput?: CatalogStoreLike): void {
  const store = storeInput ?? new CatalogStore();

  server.tool(
    "catalog_list",
    "List apps in the Hasna app catalog (read model). Optional lifecycle/channel filters and a free-text query.",
    {
      lifecycle: AppLifecycleSchema.optional().describe("Filter by lifecycle (active|stub|deprecated|archived)"),
      channel: ReleaseChannelSchema.optional().describe("Filter by release channel (stable|beta|canary|internal)"),
      query: z.string().min(1).optional().describe("Free-text search over app id, npm name, summary, tags"),
      limit: z.number().int().positive().max(1000).optional().describe("Max apps to return"),
    },
    async (input) => {
      try {
        const apps = input.query
          ? store.searchApps(input.query, { limit: input.limit })
          : store.listApps({ lifecycle: input.lifecycle, channel: input.channel, limit: input.limit });
        const filtered = input.query
          ? apps.filter(
              (app) =>
                (!input.lifecycle || app.lifecycle === input.lifecycle) &&
                (!input.channel || app.releaseChannel === input.channel)
            )
          : apps;
        return jsonContent({ apps: filtered, count: filtered.length });
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.tool(
    "catalog_get",
    "Get one app from the Hasna app catalog by its appId slug (e.g. open-todos).",
    {
      app_id: z.string().min(1).describe("App id slug, e.g. open-todos"),
    },
    async (input) => {
      try {
        const app = store.getApp(input.app_id);
        if (!app) return errorContent(`app not found: ${input.app_id}`);
        return jsonContent({ app });
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
