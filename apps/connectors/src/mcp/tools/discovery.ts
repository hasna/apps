import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONNECTORS, CATEGORIES, getConnector, getConnectorsByCategory, searchConnectors } from "../../lib/registry.js";

export function registerDiscoveryTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: search_connectors ---
  server.registerTool(
    "search_connectors",
    {
      title: "Search Connectors",
      description: "Search connectors by name or keyword.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const { getInstalledConnectors } = await import("../../lib/installer.js");
      const { getPromotedConnectors } = await import("../../db/promotions.js");
      const { getUsageMap } = await import("../../db/usage.js");
      const results = searchConnectors(query, {
        installed: getInstalledConnectors(),
        promoted: getPromotedConnectors(),
        usage: getUsageMap(),
      });
      return stripped(JSON.stringify(results.map((c) => ({ name: c.name, displayName: c.displayName, version: c.version, category: c.category, description: c.description, score: c.score, badges: c.badges })), null, 2));
    }
  );

  // --- Tool: list_connectors ---
  server.registerTool(
    "list_connectors",
    {
      title: "List Connectors",
      description: "List connectors. category filters; compact=true returns names only.",
      inputSchema: {
        category: z.string().optional(),
        compact: z.boolean().optional(),
      },
    },
    async ({ category, compact }) => {
      let connectors = CONNECTORS;

      if (category) {
        const matched = CATEGORIES.find(
          (c) => c.toLowerCase() === category.toLowerCase()
        );
        if (!matched) {
          return {
            content: [
              {
                type: "text",
                text: `Unknown category: "${category}". Use list_categories to see available categories: ${CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }
        connectors = getConnectorsByCategory(matched);
      }

      const data = compact
        ? connectors.map((c) => c.name)
        : connectors.map((c) => ({
            name: c.name,
            displayName: c.displayName,
            version: c.version,
            category: c.category,
            description: c.description,
          }));

      return stripped(JSON.stringify(data, null, 2));
    }
  );

  // --- Tool: connector_docs ---
  server.registerTool(
    "connector_docs",
    {
      title: "Connector Documentation",
      description: "Get connector docs. essential=true returns auth+envVars only.",
      inputSchema: {
        name: z.string(),
        essential: z.boolean().optional(),
      },
    },
    async ({ name, essential }) => {
      const meta = getConnector(name);
      if (!meta) {
        return {
          content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
          isError: true,
        };
      }

      const { getConnectorDocs } = await import("../../lib/installer.js");
      const docs = getConnectorDocs(name);
      if (!docs) {
        return {
          content: [{ type: "text", text: `No documentation found for '${name}'. Use install_connector to install it first.` }],
          isError: true,
        };
      }

      const data = essential
        ? { name: meta.name, auth: docs.auth, envVars: docs.envVars }
        : {
            name: meta.name,
            displayName: meta.displayName,
            version: meta.version,
            category: meta.category,
            description: meta.description,
            overview: docs.overview,
            auth: docs.auth,
            envVars: docs.envVars,
            cliCommands: docs.cliCommands,
            dataStorage: docs.dataStorage,
          };

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // --- Tool: list_categories ---
  server.registerTool(
    "list_categories",
    {
      title: "List Categories",
      description: "List connector categories with counts.",
      inputSchema: {},
    },
    async () => {
      const categoryCounts = CATEGORIES.map((category) => ({
        category,
        count: getConnectorsByCategory(category).length,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { categories: categoryCounts, total: CONNECTORS.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- Tool: connector_info ---
  server.registerTool(
    "connector_info",
    {
      title: "Connector Info",
      description: "Get connector metadata and install status.",
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

      const { getInstalledConnectors } = await import("../../lib/installer.js");
      const { getPromotedConnectors } = await import("../../db/promotions.js");
      const installed = getInstalledConnectors();
      const promoted = getPromotedConnectors();

      return stripped(JSON.stringify({
        ...meta,
        installed: installed.includes(name),
        package: `@hasna/connect-${meta.name}`,
        isPromoted: promoted.includes(name),
      }, null, 2));
    }
  );
}
