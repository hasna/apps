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
      inputSchema: {},
    },
    async () => json({ configured: Boolean(getStorageDatabaseUrl()), mode: getStorageMode(), service: "domains", tables: STORAGE_TABLES, sync: getStorageSyncMetaAll() })
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
