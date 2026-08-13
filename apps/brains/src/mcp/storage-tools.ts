import {
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../db/storage-sync.js";

type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export const BRAINS_STORAGE_TOOLS = [
  {
    name: "brains_storage_status",
    description: "Show brains local database and remote storage sync status",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "brains_storage_push",
    description: "Push local brains data to remote PostgreSQL storage",
    inputSchema: {
      type: "object",
      properties: { tables: { type: "string", description: "Comma-separated table names" } },
      required: [],
    },
  },
  {
    name: "brains_storage_pull",
    description: "Pull remote PostgreSQL storage data into the local database",
    inputSchema: {
      type: "object",
      properties: { tables: { type: "string", description: "Comma-separated table names" } },
      required: [],
    },
  },
  {
    name: "brains_storage_sync",
    description: "Push local changes, then pull remote changes",
    inputSchema: {
      type: "object",
      properties: { tables: { type: "string", description: "Comma-separated table names" } },
      required: [],
    },
  },
] as const;

export async function handleBrainsStorageTool(name: string, args: unknown): Promise<McpToolResult | null> {
  const tables = parseStorageTables((args as { tables?: string } | undefined)?.tables);

  try {
    switch (name) {
      case "brains_storage_status":
        return ok(getStorageStatus());
      case "brains_storage_push":
        return ok(await pushStorageChanges(tables));
      case "brains_storage_pull":
        return ok(await pullStorageChanges(tables));
      case "brains_storage_sync":
        return ok(await syncStorageChanges(tables));
      default:
        return null;
    }
  } catch (error) {
    return err(error);
  }
}
