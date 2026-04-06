import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConnector } from "../../lib/registry.js";
import { getAuthStatus, saveApiKey } from "../../server/auth.js";

export function registerAuthTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: connector_auth_status ---
  server.registerTool(
    "connector_auth_status",
    {
      title: "Connector Auth Status",
      description: "Check auth status, token expiry, and env vars.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const meta = getConnector(name);
      if (!meta) {
        return {
          content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
          isError: true,
        };
      }

      const status = getAuthStatus(name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                name: meta.name,
                displayName: meta.displayName,
                ...status,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- Tool: configure_auth ---
  server.registerTool(
    "configure_auth",
    {
      title: "Configure Auth",
      description: "Save an API key or token for a connector. Use 'fields' to save multiple credentials at once (e.g. OAuth clientId + clientSecret).",
      inputSchema: {
        name: z.string(),
        key: z.string().optional().describe("The API key or token VALUE to save (for single-field auth)"),
        field: z.string().optional().describe("Config field name to save as (e.g. apiKey, clientId, clientSecret). Defaults to auto-detected field."),
        fields: z.record(z.string()).optional().describe("Multiple credentials to save at once, e.g. { clientId: '...', clientSecret: '...' }"),
      },
    },
    async ({ name, key, field, fields }) => {
      try {
        if (fields && Object.keys(fields).length > 0) {
          // Multi-field save: iterate over each key-value pair
          for (const [f, v] of Object.entries(fields)) {
            await saveApiKey(name, v, f);
          }
          // Also save single key if provided alongside fields
          if (key) await saveApiKey(name, key, field);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ success: true, connector: name, fields: Object.keys(fields) }, null, 2),
            }],
          };
        }

        if (!key) {
          return {
            content: [{ type: "text", text: "Provide either 'key' or 'fields'" }],
            isError: true,
          };
        }

        await saveApiKey(name, key, field);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, connector: name, field: field || "apiKey" }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to save key for '${name}': ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );
}
