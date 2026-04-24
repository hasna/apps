import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getInstalledConnectors } from "../../lib/installer.js";
import { getConnectorOperations } from "../../lib/runner.js";
import { getConnector } from "../../lib/registry.js";

export function registerSearchTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: search_tools ---
  server.registerTool(
    "search_tools",
    {
      title: "Search Tools",
      description: "Search for available operations across installed connectors.",
      inputSchema: {
        query: z.string(),
        installedOnly: z.boolean().optional(),
      },
    },
    async ({ query, installedOnly }) => {
      const installed = installedOnly ? getInstalledConnectors() : null;
      const results: { connector: string; operation: string; description: string }[] = [];

      const connectors = installed || getInstalledConnectors();
      for (const name of connectors) {
        try {
          const ops = await getConnectorOperations(name);
          const meta = getConnector(name);
          for (const operation of ops.operations || []) {
            const searchable = [
              operation.name,
              operation.aliases.join(" "),
              operation.usage,
              operation.summary,
              ops.helpText,
            ].join("\n").toLowerCase();

            if (searchable.includes(query.toLowerCase())) {
              results.push({
                connector: name,
                operation: operation.name,
                description: operation.summary || ops.helpText || "",
              });
            }
          }
        } catch {
          // Skip connectors that fail
        }
      }

      return stripped(JSON.stringify(results, null, 2));
    }
  );

  // --- Tool: describe_tools ---
  server.registerTool(
    "describe_tools",
    {
      title: "Describe Tools",
      description: "Get detailed documentation for a connector's operations.",
      inputSchema: {
        name: z.string(),
        operation: z.string().optional(),
      },
    },
    async ({ name, operation }) => {
      const meta = getConnector(name);
      if (!meta) {
        return {
          content: [{ type: "text", text: `Connector '${name}' not found.` }],
          isError: true,
        };
      }

      if (operation) {
        const { getConnectorCommandHelp } = await import("../../lib/runner.js");
        const help = await getConnectorCommandHelp(name, operation);
        return {
          content: [{ type: "text", text: JSON.stringify({ connector: name, operation, help }, null, 2) }],
        };
      }

      const ops = await getConnectorOperations(name);
      return stripped(JSON.stringify({ connector: name, displayName: meta.displayName, ...ops }, null, 2));
    }
  );
}
