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
import { getAuthStatus } from "../server/auth.js";

// Load versions at startup
loadConnectorVersions();

const server = new McpServer({
  name: "connectors",
  version: "0.1.0",
});

// --- Tool: search_connectors ---
server.registerTool(
  "search_connectors",
  {
    title: "Search Connectors",
    description:
      "Search the connector library by name, description, or keyword. " +
      "Use this to discover available API connectors (e.g. 'payment', 'ai', 'email').",
    inputSchema: {
      query: z.string().describe("Search query (name, keyword, or description)"),
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
    description:
      "List all available connectors, optionally filtered by category. " +
      "Returns name, version, category, and description for each connector.",
    inputSchema: {
      category: z
        .string()
        .optional()
        .describe(
          "Filter by category. Available: " + CATEGORIES.join(", ")
        ),
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
    description:
      "Get detailed documentation for a connector including auth method, " +
      "required environment variables, CLI commands, and API capabilities. " +
      "Use this BEFORE installing a connector to understand how to use it.",
    inputSchema: {
      name: z.string().describe("Connector name (e.g. 'stripe', 'anthropic', 'gmail')"),
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
    description:
      "Install one or more API connectors into the current project. " +
      "Connectors are copied to .connectors/ with an auto-generated index.ts for imports.",
    inputSchema: {
      names: z
        .array(z.string())
        .describe("Connector names to install (e.g. ['stripe', 'figma'])"),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite if already installed (default: false)"),
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
    description:
      "List connectors currently installed in the project's .connectors/ directory.",
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
    description:
      "Get metadata about a specific connector including version, category, " +
      "tags, and whether it's currently installed.",
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
    description:
      "Check the authentication status of an installed connector. " +
      "Returns auth type (oauth/apikey/bearer), whether it's configured, " +
      "token expiry for OAuth connectors, and environment variable status.",
    inputSchema: {
      name: z.string().describe("Connector name (e.g. 'gmail', 'stripe', 'anthropic')"),
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
