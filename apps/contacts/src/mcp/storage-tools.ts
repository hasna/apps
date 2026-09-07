import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { displayIssue, resolveContactsClientTransport } from "../cloud/http-storage.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function connectionStatus() {
  const resolution = resolveContactsClientTransport("contacts");
  return {
    transport: resolution.transport,
    configured: resolution.configured,
    api_url_source: resolution.apiUrlSource,
    api_key_present: resolution.apiKeyPresent,
    api_key_source: resolution.apiKeySource,
    api_key_tier: resolution.apiKeyTier,
    misconfigured: resolution.misconfigured,
    issue: displayIssue(resolution.issue),
    warning: resolution.warning,
    // The transport the client actually uses: the hosted /v1 API when
    // configured, otherwise the local SQLite store. Nothing is gated.
    active_transport: resolution.configured ? "api" : "local",
  };
}

export function registerContactsStorageTools(server: McpServer): void {
  server.tool(
    "contacts_connection_status",
    "Inspect the active contacts client transport and API configuration without exposing credential values",
    {},
    async () => {
      try {
        return ok(connectionStatus());
      } catch (error) {
        return err(error);
      }
    },
  );
}