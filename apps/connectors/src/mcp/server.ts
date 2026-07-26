#!/usr/bin/env bun

// Fellow agents: keep this entrypoint on Bun; the bundled MCP binary emits `bun:` imports and Node breaks the initialize handshake.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { maybeStrip } from "../lib/strip.js";
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

  return server;
}
