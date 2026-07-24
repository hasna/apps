import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getInstalledConnectors } from "../../lib/installer.js";
import { getConnectorOperations } from "../../lib/runner.js";
import { getConnector } from "../../lib/registry.js";
import { DEFAULT_MCP_LIMIT, normalizeLimit, truncateText } from "../../lib/compact-output.js";

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
        limit: z.number().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ query, installedOnly, limit, verbose }) => {
      const installed = installedOnly ? getInstalledConnectors() : null;
      const results: { connector: string; operation: string; description: string }[] = [];
      const resultLimit = normalizeLimit(limit, DEFAULT_MCP_LIMIT);

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
                description: verbose
                  ? operation.summary || ops.helpText || ""
                  : truncateText(operation.summary || ops.helpText || "", 160),
              });
              if (results.length >= resultLimit) break;
            }
          }
          if (results.length >= resultLimit) break;
        } catch {
          // Skip connectors that fail
        }
      }

      return stripped(JSON.stringify({
        results,
        count: results.length,
        hint: "Use limit=<n> for more rows and verbose=true for longer descriptions.",
      }, null, 2));
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
        verbose: z.boolean().optional(),
      },
    },
    async ({ name, operation, verbose }) => {
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
      if (verbose) {
        return stripped(JSON.stringify({ connector: name, displayName: meta.displayName, ...ops }, null, 2));
      }
      return stripped(JSON.stringify({
        connector: name,
        displayName: meta.displayName,
        commands: ops.commands,
        operations: ops.operations.map((item) => ({
          name: item.name,
          aliases: item.aliases,
          usage: item.usage,
          summary: truncateText(item.summary || "", 140),
          source: item.source,
        })),
        totalOperations: ops.operations.length,
        hint: `Use describe_tools({ name: "${name}", verbose: true }) for full help text.`,
      }, null, 2));
    }
  );
}
