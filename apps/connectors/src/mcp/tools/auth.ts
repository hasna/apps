import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getConnector } from "../../lib/registry.js";
import { getAuthStatus, getAuthType, saveApiKey, loadTokens, refreshOAuthToken } from "../../server/auth.js";
import { getConnectorsHome } from "../../db/database.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

export function registerAuthTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
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
      description: "Save an API key or token for a connector. Use 'fields' to save multiple credentials at once (e.g. OAuth clientId + clientSecret).",
      inputSchema: {
        name: z.string(),
        key: z.string().optional().describe("The API key or token VALUE to save (for single-field auth)"),
        field: z.string().optional().describe("Config field name to save as (e.g. apiKey, clientId, clientSecret). Defaults to auto-detected field."),
        fields: z.record(z.string()).optional().describe("Multiple credentials to save at once, e.g. { clientId: '...', clientSecret: '...' }"),
      },
    },
    async ({ name, key, field, fields }) => {
      try {
        if (fields && Object.keys(fields).length > 0) {
          // Multi-field save: iterate over each key-value pair
          for (const [f, v] of Object.entries(fields)) {
            await saveApiKey(name, v, f);
          }
          // Also save single key if provided alongside fields
          if (key) await saveApiKey(name, key, field);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ success: true, connector: name, fields: Object.keys(fields) }, null, 2),
            }],
          };
        }

        if (!key) {
          return {
            content: [{ type: "text", text: "Provide either 'key' or 'fields'" }],
            isError: true,
          };
        }

        await saveApiKey(name, key, field);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, connector: name, field: field || "apiKey" }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: `Failed to save key for '${name}': ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: connector_oauth ---
  server.registerTool(
    "connector_oauth",
    {
      title: "Connector OAuth Flow",
      description: "Start an OAuth authentication flow for a connector. Returns an authorization URL to open in a browser. For non-interactive/agent use, pass noBrowser: true to start a temporary server and wait for tokens automatically.",
      inputSchema: {
        name: z.string(),
        noBrowser: z.boolean().optional().describe("If true, starts a temporary OAuth server and waits for tokens. If false/omitted, returns the URL for browser-based auth."),
        port: z.number().optional().describe("OAuth server port (default: 9876)"),
        refresh: z.boolean().optional().describe("If true, attempt to refresh existing OAuth tokens instead of starting a new flow."),
      },
    },
    async ({ name, noBrowser, port, refresh }) => {
      const meta = getConnector(name);
      if (!meta) {
        return {
          content: [{ type: "text", text: `Connector '${name}' not found. Use search_connectors or list_connectors to find available connectors.` }],
          isError: true,
        };
      }

      const authType = getAuthType(name);
      if (authType !== "oauth") {
        return {
          content: [{ type: "text", text: `${meta.displayName} does not use OAuth. Use configure_auth instead to set an API key.` }],
          isError: true,
        };
      }

      // --refresh: try to auto-refresh tokens
      if (refresh) {
        try {
          const tokens = await refreshOAuthToken(name);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ success: true, connector: name, action: "refreshed", expiresAt: tokens.expiresAt, scope: tokens.scope }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: "text",
              text: `Refresh failed: ${err instanceof Error ? err.message : String(err)}. You may need to re-authenticate with a new OAuth flow.`,
            }],
            isError: true,
          };
        }
      }

      // Check if already authenticated
      const tokens = loadTokens(name);
      if (tokens?.accessToken && tokens?.refreshToken) {
        if (tokens.expiresAt && Date.now() < tokens.expiresAt - 60_000) {
          const mins = Math.floor((tokens.expiresAt - Date.now()) / 60_000);
          const expiresIn = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ connector: name, status: "already_authenticated", expiresIn, message: "Tokens are valid. Use refresh: true to renew or re-authenticate to get new tokens." }, null, 2),
            }],
          };
        }
      }

      const serverPort = port || 9876;
      const oauthUrl = `http://localhost:${serverPort}/oauth/${name}/start`;

      if (noBrowser) {
        // Spawn a detached server process and poll for tokens
        const connectorsHome = getConnectorsHome();
        const connectorDirName = name.startsWith("connect-") ? name : `connect-${name}`;
        const tokensPath = join(connectorsHome, connectorDirName, "profiles", "default", "tokens.json");

        // Check if server is already running
        let serverRunning = false;
        try {
          await fetch(`http://localhost:${serverPort}/api/connectors`);
          serverRunning = true;
        } catch {}

        if (!serverRunning) {
          const scriptPath = process.argv[1];
          const serverProc = spawn("node", [scriptPath, "serve", "--port", String(serverPort)], {
            detached: true,
            stdio: "ignore",
          });
          serverProc.unref();
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        }

        // Poll for tokens
        let attempts = 0;
        const maxAttempts = 120; // 60 seconds
        while (attempts < maxAttempts) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          if (existsSync(tokensPath)) {
            break;
          }
          attempts++;
        }

        if (attempts >= maxAttempts) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                connector: name,
                status: "waiting",
                oauthUrl,
                message: `OAuth server is running on port ${serverPort}. Open the URL to authenticate. Tokens will be saved to ${tokensPath}.`,
              }, null, 2),
            }],
          };
        }

        // Read the tokens to confirm
        try {
          const tokenData = JSON.parse(
            readFileSync(tokensPath, "utf-8")
          );
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                connector: name,
                status: "authenticated",
                tokenType: tokenData.tokenType || "Bearer",
                scope: tokenData.scope,
              }, null, 2),
            }],
          };
        } catch {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                connector: name,
                status: "tokens_file_found",
                message: "Token file was created but could not be parsed.",
              }, null, 2),
            }],
            isError: true,
          };
        }
      } else {
        // Return the OAuth URL for browser-based auth
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              connector: name,
              status: "auth_required",
              authType: "oauth",
              oauthUrl,
              message: `Open this URL in a browser to authenticate. After completing the OAuth flow, tokens will be saved automatically.`,
            }, null, 2),
          }],
        };
      }
    }
  );
}
