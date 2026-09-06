#!/usr/bin/env bun
// @bun
// Hasna Notes MCP server entry. The MCP server is a stdio process speaking to
// the authenticated HTTPS notes API; its credential is resolved through the
// @hasna/contracts chain per request (hasna/apps#1720).
await import("../mcp/notes-mcp.mjs");
