#!/usr/bin/env bun

// Fellow agents: keep this entrypoint on Bun; the bundled MCP binary emits `bun:` imports and Node breaks the initialize handshake.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { maybeStrip } from "../lib/strip.js";
import { z } from "zod";
import { getRemoteDatabaseUrl, getSyncMetaAll, remotePull, remotePush } from "../lib/remote-sync.js";
import pkg from "../../package.json" with { type: "json" };
import {
  registerDiscoveryTools,
  registerManagementTools,
  registerAuthTools,
  registerOperationsTools,
  registerSearchTools,
  registerRankingTools,
  registerJobsTools,
  registerLlmTools,
  registerAgentTools,
  registerRateTools,
  registerFeedbackTools,
} from "./tools/index.js";

/** Wrap MCP tool text output through optional LLM stripping */
async function stripped(text: string) {
  return { content: [{ type: "text" as const, text: await maybeStrip(text) }] };
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "connectors",
    version: pkg.version,
  });

// Register all tool modules
registerDiscoveryTools(server, stripped);
registerManagementTools(server, stripped);
registerAuthTools(server, stripped);
registerOperationsTools(server, stripped);
registerSearchTools(server, stripped);
registerRankingTools(server, stripped);
registerJobsTools(server, stripped);
registerLlmTools(server, stripped);
registerAgentTools(server, stripped);
registerRateTools(server, stripped);
  registerFeedbackTools(server, stripped);

  server.tool("storage_status", "Show connectors remote storage configuration and sync history", {}, async () => {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          database_configured: Boolean(getRemoteDatabaseUrl()),
          sync: getSyncMetaAll(),
        }, null, 2),
      }],
    };
  });

  server.tool("storage_push", "Push local connectors SQLite data to remote PostgreSQL", {
    tables: z.array(z.string()).optional(),
  }, async ({ tables }) => {
    const results = await remotePush({ tables });
    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("storage_pull", "Pull remote PostgreSQL data into local connectors SQLite", {
    tables: z.array(z.string()).optional(),
  }, async ({ tables }) => {
    const results = await remotePull({ tables });
    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  });

  return server;
}
