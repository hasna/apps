import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool, z, json, err } from "./helpers.js";
import {
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
} from "../db/storage-sync.js";

export function registerStorageTools(server: McpServer): void {
  registerTool(server,
    "storage_status",
    "Show browser storage sync configuration and local sync history.",
    {},
    async () => json(getStorageStatus()),
  );

  registerTool(server,
    "storage_push",
    "Push local browser data to storage PostgreSQL.",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => {
      try {
        return json(await storagePush(tables ? { tables } : undefined));
      } catch (e) {
        return err(e);
      }
    },
  );

  registerTool(server,
    "storage_pull",
    "Pull browser data from storage PostgreSQL to local SQLite.",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => {
      try {
        return json(await storagePull(tables ? { tables } : undefined));
      } catch (e) {
        return err(e);
      }
    },
  );

  registerTool(server,
    "storage_sync",
    "Bidirectional browser sync: pull then push.",
    { tables: z.array(z.string()).optional() },
    async ({ tables }) => {
      try {
        return json(await storageSync(tables ? { tables } : undefined));
      } catch (e) {
        return err(e);
      }
    },
  );
}

export const register = registerStorageTools;
