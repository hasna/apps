#!/usr/bin/env node
// Deprecated alias: same args, stdio, and exit codes as `personalnotes-mcp` in local mode.
// It always runs the LOCAL MCP server — exactly what `hasna-notes-mcp` has always done —
// so exported hosted credentials (PERSONALNOTES_MODE/API_KEY/TOKEN) never silently swap
// the tool surface out from under an old config. Hosted mode requires `personalnotes-mcp`.
process.stderr.write('hasna-notes-mcp is deprecated; use personalnotes-mcp instead (this alias will be removed in the next release).\n');
await import('../mcp/personalnotes-mcp.mjs');
