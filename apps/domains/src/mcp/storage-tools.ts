import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  STORAGE_TABLES,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageSyncMetaAll,
  storagePull,
  storagePush,
  storageSync,
} from "../db/storage-sync.js";
import { compactHint, pageItems } from "../lib/compact-output.js";

const listControls = {
  limit: z.number().int().nonnegative().optional().describe("Maximum number of sync entries to return."),
  offset: z.number().int().nonnegative().optional().describe("Number of sync entries to skip."),
  all: z.boolean().optional().describe("Return all sync entries instead of the compact default page."),
};

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}

export function registerDomainsStorageTools(server: McpServer): void {
  server.registerTool(
    "storage_status",
    {
      title: "Storage Status",
      description: "Show domains remote storage configuration and local sync history.",
      inputSchema: { ...listControls },
    },
    async (args) => {
      const sync = getStorageSyncMetaAll();
      const page = pageItems(sync, { limit: args.limit, offset: args.offset, all: args.all });
      return json({
        configured: Boolean(getStorageDatabaseUrl()),
        mode: getStorageMode(),
        service: "domains",
        tables: STORAGE_TABLES,
        sync: page.items,
        count: page.shown,
        total: page.total,
        limit: page.limit,
        offset: page.offset,
        has_more: page.hasMore,
        next_offset: page.hasMore ? page.offset + page.shown : null,
        hint: compactHint(page, "sync entry(s)", "Set all=true for every sync entry."),
      });
    }
  );

  server.registerTool(
    "storage_push",
    {
      title: "Storage Push",
      description: "Push local domains data to remote PostgreSQL storage.",
      inputSchema: { tables: z.array(z.string()).optional() },
    },
    async (args) => {
      try {
        return json(await storagePush({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "storage_pull",
    {
      title: "Storage Pull",
      description: "Pull domains data from remote PostgreSQL storage to local SQLite.",
      inputSchema: { tables: z.array(z.string()).optional() },
    },
    async (args) => {
      try {
        return json(await storagePull({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "storage_sync",
    {
      title: "Storage Sync",
      description: "Bidirectional domains sync: pull then push.",
      inputSchema: { tables: z.array(z.string()).optional() },
    },
    async (args) => {
      try {
        return json(await storageSync({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
