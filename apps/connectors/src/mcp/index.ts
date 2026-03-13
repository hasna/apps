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
import {
  getConnectorOperations,
  runConnectorCommand,
  getConnectorCommandHelp,
  getConnectorCliPath,
} from "../lib/runner.js";

// Load versions at startup
loadConnectorVersions();

const server = new McpServer({
  name: "connectors",
  version: "1.1.5",
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
        content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
        isError: true,
      };
    }

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
        content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
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
    description: "Save an API key or token for a connector.",
    inputSchema: {
      name: z.string(),
      key: z.string().describe("The API key or token VALUE to save"),
      field: z.string().optional().describe("Config field name to save as (e.g. apiKey, clientId, clientSecret). Defaults to auto-detected field."),
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

// --- Tool: list_connector_operations ---
server.registerTool(
  "list_connector_operations",
  {
    title: "List Connector Operations",
    description:
      "Discover available API operations for a connector. Returns CLI commands the connector supports (e.g. messages, products, customers). Use this before run_connector_operation to know what's available.",
    inputSchema: {
      name: z.string().describe("Connector name (e.g. stripe, gmail, anthropic)"),
      command: z
        .string()
        .optional()
        .describe("Get detailed help for a specific subcommand (e.g. products, messages)"),
    },
  },
  async ({ name, command }) => {
    const meta = getConnector(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
        isError: true,
      };
    }

    if (!getConnectorCliPath(name)) {
      return {
        content: [
          {
            type: "text",
            text: `Connector '${name}' does not have a CLI. It may be API-only. Use connector_docs to see how to use it programmatically.`,
          },
        ],
        isError: true,
      };
    }

    if (command) {
      const help = await getConnectorCommandHelp(name, command);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { connector: name, command, help },
              null,
              2
            ),
          },
        ],
      };
    }

    const ops = await getConnectorOperations(name);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connector: name,
              displayName: meta.displayName,
              commands: ops.commands,
              helpText: ops.helpText,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// --- Tool: run_connector_operation ---
server.registerTool(
  "run_connector_operation",
  {
    title: "Run Connector Operation",
    description:
      "Execute an API operation on a connector. Pass the connector name and CLI arguments. Use list_connector_operations first to discover available commands. Example: name='stripe', args=['products', 'list', '--limit', '5']",
    inputSchema: {
      name: z.string().describe("Connector name (e.g. stripe, gmail, anthropic)"),
      args: z
        .array(z.string())
        .describe(
          "CLI arguments for the connector command (e.g. ['products', 'list', '--limit', '5'])"
        ),
      format: z
        .enum(["json", "pretty"])
        .optional()
        .describe("Output format (default: json for structured parsing)"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: 30000)"),
    },
  },
  async ({ name, args, format, timeout }) => {
    const meta = getConnector(name);
    if (!meta) {
      return {
        content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
        isError: true,
      };
    }

    // Prepend --format json by default for structured output
    const finalArgs = [...args];
    if (format) {
      finalArgs.push("--format", format);
    } else if (!args.includes("--format") && !args.includes("-f")) {
      finalArgs.push("--format", "json");
    }

    const result = await runConnectorCommand(name, finalArgs, timeout ?? 30000);

    // Commander.js writes help to stderr and exits with code 1 for unknown commands,
    // or exits with code 0 for --help but output goes to stdout. Treat help text as success.
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const looksLikeHelp = /Usage:|Commands:|Options:/i.test(combinedOutput);

    if (!result.success && !looksLikeHelp) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connector: name,
                success: false,
                error: result.stderr || result.stdout,
                exitCode: result.exitCode,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connector: name,
              success: true,
              output: looksLikeHelp
                ? (result.stdout || result.stderr).trim()
                : result.stdout,
            },
            null,
            2
          ),
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
        saveApiKey(name, key, field);
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
                  authError: error instanceof Error ? error.message : String(error),
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              connector: name,
              displayName: meta.displayName,
              installed: installStatus.installed,
              path: installStatus.path,
              authType: authStatus.type,
              authConfigured: authStatus.configured,
              tokenExpiry: authStatus.tokenExpiry,
              envVars: authStatus.envVars,
            },
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
      "setup_connector", "list_categories", "list_connector_operations",
      "run_connector_operation", "search_tools", "describe_tools",
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
      setup_connector: "Install + configure auth + verify in one call. Params: name, key?, field?, overwrite?",
      list_categories: "List connector categories with counts.",
      list_connector_operations: "Discover available API operations for a connector. Params: name, command?",
      run_connector_operation: "Execute an API operation on a connector. Params: name, args[], format?, timeout?",
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
