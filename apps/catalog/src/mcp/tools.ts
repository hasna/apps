import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
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
  const catalogListInputSchema = z.object({
    lifecycle: AppLifecycleSchema.optional().describe("Filter by lifecycle (active|stub|deprecated|archived)"),
    channel: ReleaseChannelSchema.optional().describe("Filter by release channel (stable|beta|canary|internal)"),
    query: z.string().min(1).optional().describe("Free-text search over app id, npm name, summary, tags"),
    limit: z.number().int().positive().max(1000).optional().describe("Max apps to return"),
  });
  const catalogGetInputSchema = z.object({
    app_id: z.string().min(1).describe("App id slug, e.g. example-widget"),
  });

  server.registerTool(
    "catalog_list",
    {
      description: "List apps in the Hasna app catalog (read model). Optional lifecycle/channel filters and a free-text query.",
      inputSchema: catalogListInputSchema as unknown as AnySchema,
    },
    async (input: unknown) => {
      try {
        const parsed = catalogListInputSchema.parse(input);
        const apps = parsed.query
          ? store.searchApps(parsed.query, { limit: parsed.limit })
          : store.listApps({ lifecycle: parsed.lifecycle, channel: parsed.channel, limit: parsed.limit });
        const filtered = parsed.query
          ? apps.filter(
              (app) =>
                (!parsed.lifecycle || app.lifecycle === parsed.lifecycle) &&
                (!parsed.channel || app.releaseChannel === parsed.channel)
            )
          : apps;
        return jsonContent({ apps: filtered, count: filtered.length });
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    "catalog_get",
    {
      description: "Get one app from the Hasna app catalog by its appId slug (e.g. example-widget).",
      inputSchema: catalogGetInputSchema as unknown as AnySchema,
    },
    async (input: unknown) => {
      try {
        const parsed = catalogGetInputSchema.parse(input);
        const app = store.getApp(parsed.app_id);
        if (!app) return errorContent(`app not found: ${parsed.app_id}`);
        return jsonContent({ app });
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
