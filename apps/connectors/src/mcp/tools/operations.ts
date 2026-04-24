import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConnector } from "../../lib/registry.js";
import { getAuthStatus } from "../../server/auth.js";
import {
  getConnectorOperations,
  runConnectorCommand,
  getConnectorCommandHelp,
  hasConnectorCommandSurface,
} from "../../lib/runner.js";

export function registerOperationsTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
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

      if (!hasConnectorCommandSurface(name)) {
        return {
          content: [
            {
              type: "text",
              text: `Connector '${name}' does not expose runnable operations. Use connector_docs to see how to use it programmatically.`,
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
      const auth = getAuthStatus(name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connector: name,
                displayName: meta.displayName,
                auth,
                commands: ops.commands,
                operations: ops.operations,
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

      // Track usage
      try { const { logUsage } = await import("../../db/usage.js"); logUsage(name, "run"); } catch {}

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
}
