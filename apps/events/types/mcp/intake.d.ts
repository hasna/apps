#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/** Intake-only MCP. Legacy local channel/spool operations are not exposed. */
export declare function createIntakeMcpServer(env?: Record<string, string | undefined>): McpServer;
export declare function main(args?: string[]): Promise<void>;
