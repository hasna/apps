import { z } from "zod";
import {
  getStorageStatus,
  parseStorageTables,
  pullStorageChanges,
  pushStorageChanges,
  syncStorageChanges,
} from "../db/storage-sync.js";

type ToolHandler = (params: any) => unknown | Promise<unknown>;
type RegisterTool = (
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  handler: ToolHandler,
) => void;

function ok(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function registerStorageTools(registerTool: RegisterTool): void {
  registerTool("files_storage_status", "Show files local database, remote metadata, and object storage status", {}, async () => {
    try {
      return ok(getStorageStatus());
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_storage_push", "Push local files metadata to PostgreSQL", {
    tables: z.string().optional().describe("Comma-separated table names"),
  }, async ({ tables }) => {
    try {
      return ok(await pushStorageChanges(parseStorageTables(tables)));
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_storage_pull", "Pull PostgreSQL files metadata into the local database", {
    tables: z.string().optional().describe("Comma-separated table names"),
  }, async ({ tables }) => {
    try {
      return ok(await pullStorageChanges(parseStorageTables(tables)));
    } catch (error) {
      return err(error);
    }
  });

  registerTool("files_storage_sync", "Push local metadata, then pull remote metadata", {
    tables: z.string().optional().describe("Comma-separated table names"),
  }, async ({ tables }) => {
    try {
      return ok(await syncStorageChanges(parseStorageTables(tables)));
    } catch (error) {
      return err(error);
    }
  });
}
