#!/usr/bin/env bun
// @bun
// Hasna Notes MCP server entry. The hosted/cloud MCP variant (which spoke to
// the server through the removed sync client) is gone with the sync
// machinery; this entry now always serves the local notes MCP server.
await import("../mcp/notes-mcp.mjs");
