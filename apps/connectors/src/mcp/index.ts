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
  version: "0.2.8",
});

// --- Tool: search_connectors ---
server.registerTool(
  "search_connectors",
  {
    title: "Search Connectors",
    description: "Search connectors by name, keyword, or description.",
    inputSchema: {
      query: z.string().describe("Search query"),
    },
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
    description: "List connectors, optionally filtered by category.",
    inputSchema: {
      category: z.string().optional().describe("Filter by category (e.g. 'AI & ML', 'Developer Tools')"),
    },
  },
  async ({ category }) => {
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            connectors.map((c) => ({
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

// --- Tool: connector_docs ---
server.registerTool(
  "connector_docs",
  {
    title: "Connector Documentation",
    description: "Get auth, env vars, CLI commands, and API docs for a connector.",
    inputSchema: {
      name: z.string().describe("Connector name"),
    },
  },
  async ({ name }) => {
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
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
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: install_connector ---
server.registerTool(
  "install_connector",
  {
    title: "Install Connector",
    description: "Install connectors into .connectors/ with auto-generated index.ts.",
    inputSchema: {
      names: z.array(z.string()).describe("Connector names to install"),
      overwrite: z.boolean().optional().describe("Overwrite if already installed"),
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
    description: "Remove an installed connector from the project.",
    inputSchema: {
      name: z.string().describe("Connector name to remove"),
    },
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
    description: "Get connector metadata: version, category, tags, installed status.",
    inputSchema: {
      name: z.string().describe("Connector name"),
    },
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
    description: "Check auth status: type (oauth/apikey/bearer), configured, token expiry, env vars.",
    inputSchema: {
      name: z.string().describe("Connector name"),
    },
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
    description: "Save an API key or bearer token for a connector.",
    inputSchema: {
      name: z.string().describe("Connector name"),
      key: z.string().describe("API key or bearer token"),
      field: z.string().optional().describe("Field name (default: 'apiKey')"),
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
