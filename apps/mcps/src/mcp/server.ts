import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { STORAGE_TABLES, getStorageStatus, storagePull, storagePush, storageSync } from "../lib/storage-sync.js";
import { compactSyncResult } from "../lib/compact-output.js";
import { readPackageVersion } from "../lib/version.js";
import {
  registerMcpTools,
  type McpsMcpToolDefinition,
} from "./tools.js";

export const VERSION = readPackageVersion(import.meta.url);

export interface CreateMcpServerOptions {
  name?: string;
  version?: string;
  storageTools?: boolean;
  tools?: McpsMcpToolDefinition[];
}

export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "mcps",
    version: options.version ?? VERSION,
  });

  registerMcpTools(server, options.tools);

  if (options.storageTools !== false) {
    registerMcpsStorageTools(server);
  }

  return server;
}

function registerMcpsStorageTools(server: McpServer): void {
  const tableSchema = z.enum(STORAGE_TABLES);

  server.tool(
    "storage_status",
    "Show open-mcps remote storage configuration and local sync metadata. Defaults to a compact summary.",
    { verbose: z.boolean().optional().describe("Return full table and sync metadata") },
    async ({ verbose }) => {
      const status = getStorageStatus();
      const payload = verbose === true
        ? status
        : {
            configured: status.configured,
            mode: status.mode,
            activeEnv: status.activeEnv,
            tableCount: status.tables.length,
            syncMetaCount: status.sync.length,
            hint: "Use storage_status({verbose:true}) for table names and sync timestamps.",
          };
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(payload, null, 2),
        }],
      };
    },
  );

  server.tool(
    "storage_push",
    "Push local open-mcps tables to the configured remote Postgres storage. Defaults to compact table summaries.",
    {
      tables: z.array(tableSchema).optional().describe("Tables to push"),
      verbose: z.boolean().optional().describe("Return full per-table sync results"),
    },
    async ({ tables, verbose }) => {
      const results = await storagePush({ tables });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(verbose === true ? results : summarizeStorageResults(results), null, 2) }],
      };
    },
  );

  server.tool(
    "storage_pull",
    "Pull open-mcps tables from the configured remote Postgres storage. Defaults to compact table summaries.",
    {
      tables: z.array(tableSchema).optional().describe("Tables to pull"),
      verbose: z.boolean().optional().describe("Return full per-table sync results"),
    },
    async ({ tables, verbose }) => {
      const results = await storagePull({ tables });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(verbose === true ? results : summarizeStorageResults(results), null, 2) }],
      };
    },
  );

  server.tool(
    "storage_sync",
    "Push then pull open-mcps tables with the configured remote Postgres storage. Defaults to compact table summaries.",
    {
      tables: z.array(tableSchema).optional().describe("Tables to sync"),
      verbose: z.boolean().optional().describe("Return full per-table sync results"),
    },
    async ({ tables, verbose }) => {
      const results = await storageSync({ tables });
      const payload = verbose === true
        ? results
        : {
            push: summarizeStorageResults(results.push),
            pull: summarizeStorageResults(results.pull),
          };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

function summarizeStorageResults(results: Awaited<ReturnType<typeof storagePush>>) {
  return {
    items: results.map(compactSyncResult),
    tableCount: results.length,
    rowsRead: results.reduce((sum, result) => sum + result.rowsRead, 0),
    rowsWritten: results.reduce((sum, result) => sum + result.rowsWritten, 0),
    errorCount: results.reduce((sum, result) => sum + result.errors.length, 0),
    hint: "Pass verbose:true for full per-table error arrays.",
  };
}
