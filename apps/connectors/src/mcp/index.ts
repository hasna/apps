#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  CONNECTORS,
  CATEGORIES,
  getConnector,
  getConnectorsByCategory,
  searchConnectors,
  loadConnectorVersions,
} from "../lib/registry.js";
import {
  installConnector,
  getInstalledConnectors,
  removeConnector,
  getConnectorDocs,
} from "../lib/installer.js";
import { getAuthStatus, saveApiKey } from "../server/auth.js";

// Load versions at startup
loadConnectorVersions();

const server = new McpServer({
  name: "connectors",
  version: "0.3.0",
});

// --- Tool: search_connectors ---
server.registerTool(
  "search_connectors",
  {
    title: "Search Connectors",
    description: "Search connectors by name or keyword.",
    inputSchema: { query: z.string() },
  },
  async ({ query }) => {
    const results = searchConnectors(query);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            results.map((c) => ({
              name: c.name,
              displayName: c.displayName,
              version: c.version,
              category: c.category,
              description: c.description,
            })),
            null,
            2
          ),
        },
      ],
    };
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
              text: `Unknown category: "${category}". Available: ${CATEGORIES.join(", ")}`,
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

    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
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
        content: [{ type: "text", text: `Connector '${name}' not found.` }],
        isError: true,
      };
    }

    const docs = getConnectorDocs(name);
    if (!docs) {
      return {
        content: [{ type: "text", text: `No documentation found for '${name}'.` }],
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
    description: "List connectors installed in .connectors/.",
    inputSchema: {},
  },
  async () => {
    const installed = getInstalledConnectors();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ installed, count: installed.length }),
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
    description: "Get connector metadata and installed status.",
    inputSchema: { name: z.string() },
  },
  async ({ name }) => {
    const meta = getConnector(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Connector '${name}' not found.` }],
        isError: true,
      };
    }

    const installed = getInstalledConnectors();
    const isInstalled = installed.includes(meta.name);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...meta, installed: isInstalled, package: `@hasna/connect-${meta.name}` },
            null,
            2
          ),
        },
      ],
    };
  }
);

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
        content: [{ type: "text", text: `Connector '${name}' not found.` }],
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
    description: "Save an API key or token for a connector.",
    inputSchema: {
      name: z.string(),
      key: z.string(),
      field: z.string().optional(),
    },
  },
  async ({ name, key, field }) => {
    try {
      saveApiKey(name, key, field);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: true, connector: name, field: field || "apiKey" },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to save key for '${name}': ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
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

// --- Tool: search_tools ---
server.registerTool(
  "search_tools",
  {
    title: "Search Tools",
    description: "List tool names, optionally filtered by keyword.",
    inputSchema: { query: z.string().optional() },
  },
  async ({ query }) => {
    const all = [
      "search_connectors", "list_connectors", "connector_docs",
      "install_connector", "remove_connector", "list_installed",
      "connector_info", "connector_auth_status", "configure_auth",
      "list_categories", "search_tools", "describe_tools",
    ];
    const matches = query ? all.filter((n) => n.includes(query.toLowerCase())) : all;
    return { content: [{ type: "text" as const, text: matches.join(", ") }] };
  }
);

// --- Tool: describe_tools ---
server.registerTool(
  "describe_tools",
  {
    title: "Describe Tools",
    description: "Get full descriptions for specific tools.",
    inputSchema: { names: z.array(z.string()) },
  },
  async ({ names }) => {
    const descriptions: Record<string, string> = {
      search_connectors: "Search connectors by name/keyword. Params: query",
      list_connectors: "List connectors by category. Params: category, compact",
      connector_docs: "Get auth, env vars, CLI docs. Params: name, essential?",
      install_connector: "Install connector. Params: names, overwrite?",
      remove_connector: "Remove installed connector. Params: name",
      list_installed: "List installed connectors.",
      connector_info: "Get metadata and install status. Params: name",
      connector_auth_status: "Check auth status and env vars. Params: name",
      configure_auth: "Save API key or token. Params: name, key, field?",
      list_categories: "List connector categories with counts.",
    };
    const result = names.map((n: string) => `${n}: ${descriptions[n] || "See tool schema"}`).join("\n");
    return { content: [{ type: "text" as const, text: result }] };
  }
);

// --- Start the server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Use stderr -- stdout is reserved for JSON-RPC
  console.error("Connectors MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
