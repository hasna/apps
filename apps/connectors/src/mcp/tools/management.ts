import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { installConnector, getInstalledConnectors, removeConnector, getConnectorDocs } from "../../lib/installer.js";
import { getConnector } from "../../lib/registry.js";
import { getAuthStatus, saveApiKey } from "../../server/auth.js";

export function registerManagementTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: install_connector ---
  server.registerTool(
    "install_connector",
    {
      title: "Install Connector",
      description: "Install connectors into .connectors/.",
      inputSchema: {
        names: z.array(z.string()),
        overwrite: z.boolean().optional(),
      },
    },
    async ({ names, overwrite }) => {
      const results = names.map((name) =>
        installConnector(name, { overwrite: overwrite ?? false })
      );

      const summary = results.map((r) =>
        r.success
          ? `✓ ${r.connector} → ${r.path}`
          : `✗ ${r.connector}: ${r.error}`
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                results,
                summary: summary.join("\n"),
                usage: results.some((r) => r.success)
                  ? "Import from './.connectors': import { " +
                    results
                      .filter((r) => r.success)
                      .map((r) => r.connector)
                      .join(", ") +
                    " } from './.connectors'"
                  : undefined,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- Tool: remove_connector ---
  server.registerTool(
    "remove_connector",
    {
      title: "Remove Connector",
      description: "Remove an installed connector.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const removed = removeConnector(name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ name, removed }),
          },
        ],
      };
    }
  );

  // --- Tool: list_installed ---
  server.registerTool(
    "list_installed",
    {
      title: "List Installed Connectors",
      description: "List all installed connectors.",
      inputSchema: {},
    },
    async () => {
      const installed = getInstalledConnectors();
      return stripped(JSON.stringify({ installed, count: installed.length }, null, 2));
    }
  );

  // --- Tool: update_connector ---
  server.registerTool(
    "update_connector",
    {
      title: "Update Connector",
      description: "Re-install a connector to get the latest version.",
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

      const result = installConnector(name, { overwrite: true });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // --- Tool: setup_connector ---
  server.registerTool(
    "setup_connector",
    {
      title: "Setup Connector",
      description:
        "Install a connector and configure auth in one step. Installs if not already present, saves API key if provided, and returns install + auth status.",
      inputSchema: {
        name: z.string().describe("Connector name (e.g. stripe, gmail, anthropic)"),
        key: z.string().optional().describe("The API key or token VALUE to save"),
        field: z
          .string()
          .optional()
          .describe("Config field name to save as (e.g. apiKey, clientId, clientSecret). Defaults to auto-detected field."),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite existing installation (default: false)"),
      },
    },
    async ({ name, key, field, overwrite }) => {
      const meta = getConnector(name);
      if (!meta) {
        return {
          content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
          isError: true,
        };
      }

      // Step 1: Install
      const installed = getInstalledConnectors();
      const alreadyInstalled = installed.includes(meta.name);
      let installStatus: { installed: boolean; path?: string; error?: string };

      if (alreadyInstalled && !overwrite) {
        installStatus = { installed: true, path: `.connectors/connect-${meta.name}` };
      } else {
        const result = installConnector(name, { overwrite: overwrite ?? false });
        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connector: name,
                    installed: false,
                    error: result.error,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
        installStatus = { installed: true, path: result.path };
      }

      // Step 2: Configure auth (if key provided)
      if (key) {
        try {
          await saveApiKey(name, key, field);
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connector: name,
                    installed: installStatus.installed,
                    path: installStatus.path,
                    auth: { success: false, error: String(error) },
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      // Step 3: Return combined status
      const authStatus = getAuthStatus(name);
      return stripped(
        JSON.stringify(
          {
            connector: name,
            installed: installStatus.installed,
            path: installStatus.path,
            auth: key ? { success: true, ...authStatus } : authStatus,
          },
          null,
          2
        )
      );
    }
  );
}
