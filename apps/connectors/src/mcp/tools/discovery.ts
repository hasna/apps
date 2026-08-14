import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONNECTORS, CATEGORIES, getConnector, getConnectorsByCategory, searchConnectors } from "../../lib/registry.js";
import {
  DEFAULT_MCP_LIMIT,
  compactConnector,
  firstNonEmptyLines,
  normalizeLimit,
  pageItems,
  parseCursor,
  truncateText,
} from "../../lib/compact-output.js";

export function registerDiscoveryTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: search_connectors ---
  server.registerTool(
    "search_connectors",
    {
      title: "Search Connectors",
      description: "Search connectors by name or keyword.",
      inputSchema: {
        query: z.string(),
        limit: z.number().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ query, limit, verbose }) => {
      const { getInstalledConnectors } = await import("../../lib/installer.js");
      const { getPromotedConnectors } = await import("../../db/promotions.js");
      const { getUsageMap } = await import("../../db/usage.js");
      const resultLimit = normalizeLimit(limit, DEFAULT_MCP_LIMIT);
      const results = searchConnectors(query, {
        installed: getInstalledConnectors(),
        promoted: getPromotedConnectors(),
        usage: getUsageMap(),
        limit: resultLimit,
      });
      return stripped(JSON.stringify(results.map((c) => ({
        name: c.name,
        displayName: c.displayName,
        version: c.version,
        category: c.category,
        description: verbose ? c.description : truncateText(c.description, 120),
        score: c.score,
        badges: c.badges,
        ...(verbose ? { matchReasons: c.matchReasons } : {}),
      })), null, 2));
    }
  );

  // --- Tool: list_connectors ---
  server.registerTool(
    "list_connectors",
    {
      title: "List Connectors",
      description: "List connectors with compact, paged defaults. Use verbose=true or compact=false for full metadata.",
      inputSchema: {
        category: z.string().optional(),
        compact: z.boolean().optional(),
        limit: z.number().optional(),
        cursor: z.string().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ category, compact, limit, cursor, verbose }) => {
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

      const parsedCursor = parseCursor(cursor);
      if (parsedCursor.error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: parsedCursor.error }) }],
          isError: true,
        };
      }

      const page = pageItems(connectors, {
        offset: parsedCursor.value ?? 0,
        limit: normalizeLimit(limit, DEFAULT_MCP_LIMIT),
      });

      const data = compact === true
        ? page.items.map((c) => c.name)
        : (verbose || compact === false)
          ? page.items.map((c) => ({
              name: c.name,
              displayName: c.displayName,
              version: c.version,
              category: c.category,
              description: c.description,
              tags: c.tags,
            }))
          : page.items.map((c) => compactConnector(c, 120));

      return stripped(JSON.stringify({
        connectors: data,
        total: connectors.length,
        count: data.length,
        nextCursor: page.nextOffset === null ? null : String(page.nextOffset),
        hint: page.nextOffset === null
          ? "Use verbose=true or compact=false for full connector metadata."
          : `Call again with cursor="${page.nextOffset}", or use verbose=true / compact=false for full connector metadata.`,
      }, null, 2));
    }
  );

  // --- Tool: connector_docs ---
  server.registerTool(
    "connector_docs",
    {
      title: "Connector Documentation",
      description: "Get compact connector docs by default. Use verbose=true for full parsed docs or essential=true for auth+env only.",
      inputSchema: {
        name: z.string(),
        essential: z.boolean().optional(),
        verbose: z.boolean().optional(),
      },
    },
    async ({ name, essential, verbose }) => {
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
        : verbose
          ? {
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
          }
          : {
            name: meta.name,
            displayName: meta.displayName,
            version: meta.version,
            category: meta.category,
            description: truncateText(meta.description, 120),
            overview: firstNonEmptyLines(docs.overview, 1, 140)[0] ?? "",
            auth: firstNonEmptyLines(docs.auth, 4, 140),
            envVars: docs.envVars.slice(0, 8),
            envVarCount: docs.envVars.length,
            cliCommands: firstNonEmptyLines(docs.cliCommands, 8, 140),
            dataStorage: firstNonEmptyLines(docs.dataStorage, 2, 140),
            hint: `Use connector_docs({ name: "${name}", verbose: true }) for full parsed docs, or raw CLI docs with connectors docs ${name} --raw.`,
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
