// Vendored from @hasna/mcp-harness@0.1.0 — the MCP health/mode primitives and
// Bun request handler emails' MCP transport uses. The source repo ("open-mcp")
// is retired and the public package was deleted per the owner directive
// 2026-09-03 (hasna/apps#1528), so the needed surface is inlined here — same
// pattern as apps/telephony/src/generated/mcp-harness.ts. Ported from the
// published npm tarball (dist/); semantics unchanged.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export function isStdioMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--stdio") || env.MCP_STDIO === "1";
}

export function isHttpMode(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--http") || env.MCP_HTTP === "1";
}

export function healthPayload(name: string): { status: string; name: string } {
  return { status: "ok", name };
}

/** Minimal structural shape the HTTP adapters need from a built MCP server. */
export interface ConnectableMcpServer {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
}

export type BuildServer = () => ConnectableMcpServer | Promise<ConnectableMcpServer>;

/**
 * Handle one MCP request using Web-standard `Request` / `Response`. Emits a
 * JSON-RPC `-32603` 500 on failure.
 */
export async function handleMcpHttpRequest(
  req: Request,
  buildServer: BuildServer,
  options?: { enableJsonResponse?: boolean },
): Promise<Response> {
  try {
    const server = await buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options?.enableJsonResponse,
    });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("[mcp] HTTP error:", error);
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
      { status: 500 },
    );
  }
}