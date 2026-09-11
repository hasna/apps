// `shortlinks-mcp` startup helpers, kept apart from the entry so tests can
// import them without starting a transport.

import { resolveStore } from "../client-store.js";
import type { Env } from "../store-interface.js";

export function mcpUsage(): string {
  return `usage: shortlinks-mcp                       MCP server over stdio (default)
       shortlinks-mcp --http [--port <n>]   Streamable HTTP on 127.0.0.1 (default port 8851; env MCP_HTTP=1, MCP_HTTP_PORT)
       shortlinks-mcp --version             Print the version

options:
  --help, -h          show this help and exit
  --version, -V       print the package version and exit

The server resolves its store exactly as the CLI does: the hosted /v1 API when
the @hasna/contracts chain finds a shortlinks credential (the Keychain item
hasna.credentials.shortlinks.api-key, ~/.hasna/shortlinks/config/credentials,
or HASNA_SHORTLINKS_API_KEY); the on-box SQLite store only under an explicit
HASNA_SHORTLINKS_LOCAL=1. With neither it exits non-zero before serving.
`;
}

/**
 * FAIL CLOSED AT STARTUP (owner ruling 2026-09-04; hasna/apps#1720 acceptance
 * (c)). Resolve the store once through the same seam every tool call uses,
 * then release it. With no shortlinks credential resolvable and no explicit
 * local opt-in this THROWS the fail-closed message naming every credential
 * tier and the opt-in, so the bin exits non-zero before any transport starts —
 * a server whose every tool would refuse must never announce "stdio ready".
 * Hosted resolution touches nothing on disk; only the explicit local opt-in
 * opens the on-box database (announcing the local backend on stderr, once).
 */
export async function assertMcpBackend(env: Env = process.env): Promise<void> {
  const store = await resolveStore(env);
  await store.close();
}
