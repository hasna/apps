#!/usr/bin/env bun
/**
 * `hooks-mcp` — the stdio MCP server bin (package-surfaces rule: one package,
 * four surfaces; `"command": "hooks-mcp"` in an agent's mcpServers, or
 * `bunx -p @hasna/hooks hooks-mcp`).
 *
 * Fail-closed startup: the registry authority is decided BEFORE the stdio
 * transport connects (src/mcp/authority.ts). With nothing configured the
 * process writes one REMOTE_API_* line naming the credential tiers and the
 * local opt-in to stderr and exits 1 without answering `initialize` and
 * without creating any local file.
 */
import { startStdioServer } from "./server.js";

await startStdioServer();
