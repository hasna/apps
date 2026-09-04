import { Command } from "commander";
import chalk from "chalk";
import { CONNECTORS } from "../../lib/registry.js";
import { getConnector } from "../../lib/registry.js";
import { getInstalledConnectors, getConnectorDocs } from "../../lib/installer.js";
import { getAuthStatus, getAuthType, saveApiKey, getEnvVars, refreshOAuthToken, loadTokens, getTokenExpiry } from "../../server/auth.js";
import { getConnectorsHome } from "../../db/database.js";
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { isTTY, listFilesRecursive } from "./install.js";
import {
  getConnectorConfigDir,
  getConnectorConfigReadDirs,
  listConfiguredConnectorNames,
} from "../../lib/connector-resolver.js";

const SENSITIVE_FIELDS = new Set([
  "clientsecret", "client_secret",
  "accesstoken", "access_token",
  "refreshtoken", "refresh_token",
  "apikey", "api_key",
  "apitoken", "api_token",
  "secret", "secretkey", "secret_key",
  "bearertoken", "bearer_token",
  "token", "password", "passwd",
  "private_key", "privatekey",
]);

function redactValue(value: string): string {
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 4) + "••••" + value.slice(-4);
}

function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase()) && typeof value === "string") {
        result[key] = redactValue(value);
      } else if (typeof value === "object" && value !== null) {
        result[key] = redactSecrets(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

/** Check if an OAuth connector has valid (non-expired) tokens */
function getOAuthTokenState(name: string): { hasTokens: boolean; expired: boolean; expiresIn?: string } {
  const tokens = loadTokens(name);
  if (!tokens?.accessToken && !tokens?.refreshToken) {
    return { hasTokens: false, expired: false };
  }
  if (!tokens.expiresAt) {
    return { hasTokens: true, expired: false };
  }
  const now = Date.now();
  // Consider expired if within 60 seconds of expiry
  const isExpired = now >= tokens.expiresAt - 60_000;
  const expiresIn = isExpired ? undefined : (() => {
    const ms = tokens.expiresAt - now;
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return "less than a minute";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  })();
  return { hasTokens: true, expired: isExpired, expiresIn };
}

export function getCurrentOAuthProfile(name: string, connectorsHome = getConnectorsHome()): string {
  for (const dir of getConnectorConfigReadDirs(name, connectorsHome)) {
    const currentProfilePath = join(dir, "current_profile");
    if (!existsSync(currentProfilePath)) continue;

    const profile = readFileSync(currentProfilePath, "utf8").trim();
    if (profile) return profile;
  }

  return "default";
}

export function getOAuthTokenPathsForProfile(
  name: string,
  connectorsHome = getConnectorsHome(),
  profile = getCurrentOAuthProfile(name, connectorsHome)
): string[] {
  return getConnectorConfigReadDirs(name, connectorsHome)
    .map((dir) => join(dir, "profiles", profile, "tokens.json"));
}

export function hasOAuthTokenFileUpdatedSince(tokenPaths: string[], sinceMs: number): boolean {
  return tokenPaths.some((tokensPath) => {
    if (!existsSync(tokensPath)) return false;
    return statSync(tokensPath).mtimeMs >= sinceMs;
  });
}

export function registerCommands(program: Command): void {
  // Auth command — configure connector authentication from CLI
  program
    .command("auth")
    .argument("<connector>", "Connector name to configure auth for")
    .option("-k, --key <value>", "API key or bearer token value (non-interactive)")
    .option("-f, --field <field>", "Which field to set (for multi-field connectors)")
    .option("--json", "Output as JSON", false)
    .option("--no-browser", "Print OAuth URL without opening a browser (agent-friendly)", false)
    .option("--refresh", "Refresh expired OAuth tokens", false)
    .option("--port <port>", "OAuth server port (default: 9876)", "9876")
    .description("Configure authentication for a connector")
    .action(async (connector: string, options: { key?: string; field?: string; json: boolean; browser: boolean; refresh: boolean; port: string }) => {
      const meta = getConnector(connector);
      if (!meta) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` }));
        } else {
          console.log(chalk.red(`Connector '${connector}' not found`));
          console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
        }
        process.exit(1);
        return;
      }

      const authType = getAuthType(connector);
      const statusBefore = getAuthStatus(connector);

      // --refresh: try to auto-refresh OAuth tokens
      if (options.refresh) {
        if (authType !== "oauth") {
          if (options.json) {
            console.log(JSON.stringify({ error: `${connector} does not use OAuth. Refresh is only available for OAuth connectors.` }));
          } else {
            console.log(chalk.red(`${meta.displayName} does not use OAuth. Refresh is only available for OAuth connectors.`));
          }
          process.exit(1);
          return;
        }
        try {
          const tokens = await refreshOAuthToken(connector);
          if (options.json) {
            console.log(JSON.stringify({ success: true, connector, tokenType: tokens.tokenType, scope: tokens.scope, expiresAt: tokens.expiresAt }));
          } else {
            console.log(chalk.green(`\n✓ Refreshed ${meta.displayName} tokens.`));
            console.log(chalk.dim(`  Expires: ${new Date(tokens.expiresAt).toLocaleString()}`));
          }
          process.exit(0);
          return;
        } catch (err) {
          if (options.json) {
            console.log(JSON.stringify({ error: `Refresh failed: ${err instanceof Error ? err.message : String(err)}` }));
          } else {
            console.log(chalk.red(`\n✗ Refresh failed: ${err instanceof Error ? err.message : String(err)}`));
            console.log(chalk.dim("You may need to re-authenticate."));
          }
          process.exit(1);
          return;
        }
      }

      // Show current status
      if (!options.json) {
        const statusLabel = statusBefore.configured
          ? chalk.green("configured")
          : chalk.red("not configured");
        console.log(chalk.bold(`\n${meta.displayName} — Auth Configuration\n`));
        console.log(`  Auth type: ${authType === "oauth" ? "OAuth" : authType === "apikey" ? "API Key" : "Bearer Token"}`);
        console.log(`  Status:    ${statusLabel}`);

        // Show token state for OAuth connectors
        if (authType === "oauth" && statusBefore.configured) {
          const tokenState = getOAuthTokenState(connector);
          if (tokenState.hasTokens && !tokenState.expired) {
            console.log(`  Token:     ${chalk.green("valid")} (expires in ${tokenState.expiresIn})`);
          } else if (tokenState.hasTokens && tokenState.expired) {
            console.log(`  Token:     ${chalk.yellow("expired")} (run 'connectors auth ${connector} --refresh' or re-authenticate)`);
          }
        }

        const envVars = getEnvVars(connector);
        if (envVars.length > 0) {
          console.log(`  Fields:    ${envVars.map((v) => v.variable).join(", ")}`);
        }
        console.log();
      }

      // Handle OAuth connectors
      if (authType === "oauth") {
        // Check if already authenticated with valid tokens
        const tokenState = getOAuthTokenState(connector);
        if (tokenState.hasTokens && !tokenState.expired) {
          if (options.json) {
            console.log(JSON.stringify({ connector, authType: "oauth", status: "authenticated", message: `Tokens are valid and not expired.` }));
          } else {
            console.log(chalk.green(`\n✓ ${meta.displayName} is already authenticated (tokens valid, expires in ${tokenState.expiresIn}).`));
            console.log(chalk.dim(`Use --refresh to renew tokens, or re-run auth to re-authenticate.`));
          }
          process.exit(0);
          return;
        }

        // If tokens are expired, try auto-refresh
        if (tokenState.hasTokens && tokenState.expired) {
          if (!options.json) {
            console.log(chalk.dim("Tokens expired — attempting auto-refresh..."));
          }
          try {
            const tokens = await refreshOAuthToken(connector);
            if (options.json) {
              console.log(JSON.stringify({ connector, authType: "oauth", status: "refreshed", expiresAt: tokens.expiresAt }));
            } else {
              console.log(chalk.green(`\n✓ Refreshed ${meta.displayName} tokens.`));
              console.log(chalk.dim(`  Expires: ${new Date(tokens.expiresAt).toLocaleString()}`));
            }
            process.exit(0);
            return;
          } catch {
            if (!options.json) {
              console.log(chalk.yellow("Auto-refresh failed. Proceeding with OAuth flow..."));
              console.log();
            }
          }
        }

        if (options.json) {
          const port = parseInt(options.port, 10) || 9876;
          const oauthUrl = `http://localhost:${port}/oauth/${connector}/start`;
          console.log(JSON.stringify({
            connector,
            authType: "oauth",
            message: "OAuth connectors require browser-based authentication. Use 'connectors serve' or pass --key to set tokens manually.",
            oauthUrl,
          }));
          process.exit(0);
          return;
        }

        // Start a temporary local server and open the OAuth URL
        console.log(chalk.yellow("OAuth connectors require browser-based authentication."));
        console.log();

        const port = parseInt(options.port, 10) || 9876;
        const oauthUrl = `http://localhost:${port}/oauth/${connector}/start`;

        try {
          if (!options.browser) {
            // --no-browser: spawn a detached server process, print URL, wait for tokens
            console.log(chalk.dim(`Starting OAuth server on port ${port}...`));
            const { spawn } = await import("child_process");

            // Resolve the path to the connectors CLI
            const scriptPath = process.argv[1];
            const serverProc = spawn(process.execPath, [scriptPath, "serve", "--port", String(port)], {
              detached: true,
              stdio: "ignore",
            });
            const startedAt = Date.now();

            // Unref so we don't wait on the child if the parent exits
            serverProc.unref();

            // Give the server a moment to start
            await new Promise<void>((resolve) => setTimeout(resolve, 2000));

            // Verify the server is up
            try {
              await fetch(`http://localhost:${port}/api/connectors`);
            } catch {
              console.log(chalk.red(`OAuth server failed to start on port ${port}. Is the port already in use?`));
              console.log(chalk.dim("Free the port and try again, or use 'connectors serve' for the OAuth flow."));
              process.exit(1);
              return;
            }

            console.log(chalk.bold("Open this URL to authenticate:\n"));
            console.log(`  ${chalk.cyan(oauthUrl)}\n`);
            console.log(chalk.dim("Waiting for authentication to complete..."));

            // Poll for the tokens file with progress dots
            const connectorsHome = getConnectorsHome();
            const activeProfile = getCurrentOAuthProfile(connector, connectorsHome);
            const tokenPaths = getOAuthTokenPathsForProfile(connector, connectorsHome, activeProfile);

            let attempts = 0;
            const maxAttempts = 360; // 3 minutes at 500ms intervals
            while (attempts < maxAttempts) {
              await new Promise<void>((resolve) => setTimeout(resolve, 500));
              if (hasOAuthTokenFileUpdatedSince(tokenPaths, startedAt)) {
                break;
              }
              attempts++;
              // Print progress dot every 6 intervals (~3 seconds) to keep output clean
              if (attempts % 6 === 0) {
                process.stdout.write(".");
              }
            }

            // Kill the server
            try {
              serverProc.kill("SIGTERM");
            } catch {}

            if (attempts >= maxAttempts) {
              console.log();
              console.log(chalk.yellow("Timed out waiting for OAuth callback. The auth may still be in progress."));
              console.log(chalk.dim(`Check ${tokenPaths[0]} for tokens.`));
              console.log(chalk.dim("You can stop the server manually: lsof -ti :${port} | xargs kill"));
              process.exit(1);
              return;
            }

            console.log();
            console.log(chalk.green(`\n✓ Connected! ${meta.displayName} is now authenticated.`));
            process.exit(0);
            return;
          }

          // Default: run server in-process and auto-open browser
          const { startServer } = await import("../../server/serve.js");

          console.log(chalk.dim(`Starting temporary server on port ${port}...`));
          // startServer registers its own SIGINT handler and calls process.exit
          // strict: true ensures we fail if port is busy (OAuth requires exact port match)
          await startServer(port, { strict: true });

          console.log(chalk.bold(`\nOpen this URL to authenticate:\n`));
          console.log(`  ${chalk.cyan(oauthUrl)}\n`);

          // Try to open the browser
          const { openBrowser } = await import("../../lib/open-browser.js");
          const opened = await openBrowser(oauthUrl);
          if (opened.ok) {
            console.log(chalk.dim("Browser opened. Complete the OAuth flow, then press Ctrl+C to stop the server."));
          } else {
            console.log(chalk.dim("Open the URL above in your browser to complete authentication."));
          }

          console.log(chalk.dim("Press Ctrl+C when done.\n"));

          // Keep the process alive — startServer's SIGINT handler will exit
          await new Promise<void>(() => {});
        } catch (err) {
          console.log(chalk.red(`Failed to start OAuth flow: ${err}`));
          console.log(chalk.dim("Try 'connectors serve' for the OAuth flow instead."));
          process.exit(1);
        }
        return;
      }

      // Handle API key / Bearer token connectors
      if (options.key) {
        // Non-interactive: save directly
        await saveApiKey(connector, options.key, options.field || undefined);
        const statusAfter = getAuthStatus(connector);

        if (options.json) {
          console.log(JSON.stringify({
            connector,
            authType,
            configured: statusAfter.configured,
            field: options.field || "apiKey",
          }));
        } else {
          console.log(chalk.green(`✓ Saved ${options.field || "apiKey"} for ${meta.displayName}`));
        }
        process.exit(0);
        return;
      }

      // Interactive: prompt for the key
      if (!isTTY) {
        if (options.json) {
          console.log(JSON.stringify({ error: "Interactive mode requires a TTY. Use --key flag." }));
        } else {
          console.log(chalk.red("Interactive mode requires a TTY. Use --key <value> to set non-interactively."));
        }
        process.exit(1);
        return;
      }

      const envVars = getEnvVars(connector);
      const fieldLabel = options.field
        ? options.field
        : envVars.length > 0
          ? envVars[0].variable
          : "API Key";

      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Mask input with asterisks
      const key = await new Promise<string>((resolve) => {
        let input = "";
        process.stdout.write(`  Enter ${fieldLabel}: `);

        // Switch to raw mode for masking
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
        }
        process.stdin.resume();
        process.stdin.setEncoding("utf-8");

        const onData = (ch: string) => {
          const c = ch.toString();
          if (c === "\n" || c === "\r" || c === "\u0004") {
            // Enter or Ctrl+D
            process.stdout.write("\n");
            process.stdin.removeListener("data", onData);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(false);
            }
            process.stdin.pause();
            rl.close();
            resolve(input);
          } else if (c === "\u0003") {
            // Ctrl+C
            process.stdout.write("\n");
            rl.close();
            process.exit(0);
          } else if (c === "\u007f" || c === "\b") {
            // Backspace
            if (input.length > 0) {
              input = input.slice(0, -1);
              process.stdout.write("\b \b");
            }
          } else {
            input += c;
            process.stdout.write("*");
          }
        };

        process.stdin.on("data", onData);
      });

      if (!key.trim()) {
        console.log(chalk.red("\n  No key provided. Aborting."));
        process.exit(1);
        return;
      }

      await saveApiKey(connector, key.trim(), options.field || undefined);
      const statusAfter = getAuthStatus(connector);

      console.log(chalk.green(`\n✓ API key saved for ${meta.displayName}`));
      if (statusAfter.configured) {
        console.log(chalk.green(`  Status: configured`));
      }
      process.exit(0);
    });

  // Init command — polished first-run experience with quick suggestions
  program
    .command("init")
    .option("--json", "Output presets and suggestions as JSON (non-interactive)", false)
    .description("Get started with Connectors — see suggestions, presets, and next steps")
    .action(async (options: { json: boolean }) => {
      // Preset categories with emoji labels and example connectors
      const initPresets = [
        { key: "ai", emoji: "🤖", label: "AI & ML", connectors: ["anthropic", "openai", "groq", "mistral", "googlegemini", "elevenlabs"], description: "AI and ML models" },
        { key: "communication", emoji: "💬", label: "Communication", connectors: ["gmail", "slack", "discord", "resend", "twilio"], description: "Messaging and communication" },
        { key: "devtools", emoji: "🛠", label: "Developer Tools", connectors: ["github", "vercel", "sentry", "docker", "cloudflare", "firecrawl"], description: "Developer tooling" },
        { key: "commerce", emoji: "💳", label: "Commerce", connectors: ["stripe", "shopify", "paypal", "revolut", "mercury"], description: "Commerce and finance" },
        { key: "google", emoji: "📁", label: "Google Workspace", connectors: ["gmail", "googledrive", "googlecalendar", "googledocs", "googlesheets"], description: "Google Workspace suite" },
      ];

      // Auto-detect existing auth from the shared connector home.
      const connectorsHome = getConnectorsHome();
      let configuredCount = 0;
      const configuredNames: string[] = [];
      try {
        if (existsSync(connectorsHome)) {
          for (const name of listConfiguredConnectorNames(connectorsHome)) {
            const hasProfiles = getConnectorConfigReadDirs(name, connectorsHome)
              .some((dir) => existsSync(join(dir, "profiles")));
            if (hasProfiles) {
              configuredCount++;
              configuredNames.push(name);
            }
          }
        }
      } catch {
        // Ignore errors scanning home directory
      }

      // Build JSON data (used by both --json and non-TTY modes)
      const jsonData = {
        total: CONNECTORS.length,
        configured: configuredCount,
        configuredConnectors: configuredNames,
        presets: initPresets.map((p) => ({
          key: p.key,
          label: p.label,
          description: p.description,
          connectors: p.connectors,
        })),
      };

      // JSON mode or non-TTY: output presets as JSON and exit
      if (options.json || !isTTY) {
        console.log(JSON.stringify(jsonData, null, 2));
        process.exit(0);
        return;
      }

      // TTY mode: polished first-run experience

      // Welcome message
      console.log();
      console.log(chalk.bold(`Welcome to Connectors! ${CONNECTORS.length} API connectors ready to use.`));
      console.log();

      // Auto-detect existing auth
      if (configuredCount > 0) {
        console.log(chalk.green(`  You already have ${configuredCount} connector${configuredCount === 1 ? "" : "s"} configured`) + chalk.dim(` (${configuredNames.slice(0, 5).join(", ")}${configuredNames.length > 5 ? ", ..." : ""})`));
        console.log();
      }

      // Quick suggestions — preset categories
      console.log(chalk.bold("Quick start bundles:\n"));
      for (const preset of initPresets) {
        console.log(`  ${preset.emoji}  ${chalk.bold(preset.label)} ${chalk.dim(`(${preset.connectors.length} connectors)`)}`);
        console.log(`     ${chalk.dim(preset.connectors.slice(0, 5).join(", ") + (preset.connectors.length > 5 ? ", ..." : ""))}`);
      }
      console.log();

      // Suggestion
      console.log(
        `Run ${chalk.cyan("connectors install --preset ai")} to install a bundle, or ${chalk.cyan("connectors setup <name> --key <key>")} to set up a specific connector.`
      );
      console.log();

      // Next steps
      console.log(chalk.bold("Next steps:\n"));
      console.log(`  ${chalk.cyan("connectors list")}              ${chalk.dim(`— browse all ${CONNECTORS.length} connectors`)}`);
      console.log(`  ${chalk.cyan("connectors setup <name> --key <key>")}  ${chalk.dim("— set up a connector")}`);
      console.log(`  ${chalk.cyan("connectors ops <name>")}         ${chalk.dim("— see what a connector can do")}`);
      console.log(`  ${chalk.cyan("connectors serve")}              ${chalk.dim("— run the local API + OAuth server")}`);
      console.log();

      process.exit(0);
    });

  // Export command — backup all connector credentials
  program
    .command("export")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .option("--include-secrets", "Include secrets in plaintext (dangerous — use only for backup/restore)")
    .description("Export all connector credentials as JSON backup")
    .action((options: { output?: string; includeSecrets?: boolean }) => {
      const connectDir = getConnectorsHome();
      const result: Record<string, { credentials?: unknown; profiles: Record<string, unknown> }> = {};

      if (existsSync(connectDir)) {
        for (const connectorName of listConfiguredConnectorNames(connectDir)) {
          const connectorDirs = [...getConnectorConfigReadDirs(connectorName, connectDir)].reverse();

          // Read root-level credentials.json (OAuth client credentials shared across profiles)
          let credentials: unknown = undefined;
          for (const connectorDir of connectorDirs) {
            const credentialsPath = join(connectorDir, "credentials.json");
            if (existsSync(credentialsPath)) {
              try { credentials = JSON.parse(readFileSync(credentialsPath, "utf-8")); } catch {}
            }
          }

          const profiles: Record<string, unknown> = {};
          for (const connectorDir of connectorDirs) {
            const profilesDir = join(connectorDir, "profiles");
            if (existsSync(profilesDir)) {
              for (const pEntry of readdirSync(profilesDir)) {
                const pPath = join(profilesDir, pEntry);
                if (statSync(pPath).isFile() && pEntry.endsWith(".json")) {
                  try { profiles[pEntry.replace(/\.json$/, "")] = JSON.parse(readFileSync(pPath, "utf-8")); } catch {}
                } else if (statSync(pPath).isDirectory()) {
                  const configPath = join(pPath, "config.json");
                  const tokensPath = join(pPath, "tokens.json");
                  let merged: Record<string, unknown> = {};
                  if (existsSync(configPath)) {
                    try { merged = { ...merged, ...JSON.parse(readFileSync(configPath, "utf-8")) }; } catch {}
                  }
                  if (existsSync(tokensPath)) {
                    try { merged = { ...merged, ...JSON.parse(readFileSync(tokensPath, "utf-8")) }; } catch {}
                  }
                  if (Object.keys(merged).length > 0) profiles[pEntry] = merged;
                }
              }
            }
          }

          const connectorData: { credentials?: unknown; profiles: Record<string, unknown> } = { profiles };
          if (credentials) connectorData.credentials = credentials;
          if (Object.keys(profiles).length > 0 || credentials) result[connectorName] = connectorData;
        }
      }

      const exportPayload = options.includeSecrets
        ? { connectors: result, exportedAt: new Date().toISOString() }
        : { connectors: redactSecrets(result) as typeof result, exportedAt: new Date().toISOString(), redacted: true };

      if (!options.includeSecrets) {
        console.error(chalk.yellow("⚠ Secrets are redacted by default. Use --include-secrets for a full backup (e.g., for restore)."));
      }

      const exportData = JSON.stringify(exportPayload, null, 2);

      if (options.output) {
        writeFileSync(options.output, exportData);
        console.log(chalk.green(`✓ Exported to ${options.output}`));
      } else {
        console.log(exportData);
      }
    });

  // Import command — restore connector credentials from backup
  program
    .command("import")
    .argument("<file>", "JSON backup file to import (use - for stdin)")
    .option("--json", "Output as JSON", false)
    .description("Import connector credentials from a JSON backup")
    .action(async (file: string, options: { json: boolean }) => {
      let raw: string;
      if (file === "-") {
        // Read from stdin
        const chunks: string[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk.toString());
        raw = chunks.join("");
      } else {
        if (!existsSync(file)) {
          if (options.json) { console.log(JSON.stringify({ error: `File not found: ${file}` })); }
          else { console.log(chalk.red(`File not found: ${file}`)); }
          process.exit(1);
          return;
        }
        raw = readFileSync(file, "utf-8");
      }

      let data: { connectors: Record<string, { credentials?: unknown; profiles: Record<string, unknown> }> };
      try { data = JSON.parse(raw); } catch {
        if (options.json) { console.log(JSON.stringify({ error: "Invalid JSON" })); }
        else { console.log(chalk.red("Invalid JSON in import file")); }
        process.exit(1);
        return;
      }

      if (!data.connectors || typeof data.connectors !== "object") {
        if (options.json) { console.log(JSON.stringify({ error: "Invalid format: missing 'connectors' object" })); }
        else { console.log(chalk.red("Invalid format: missing 'connectors' object")); }
        process.exit(1);
        return;
      }

      const connectDir = getConnectorsHome();
      let imported = 0;

      for (const [connectorName, connData] of Object.entries(data.connectors)) {
        if (!/^[a-z0-9-]+$/.test(connectorName)) continue;

        const connectorDir = getConnectorConfigDir(connectorName, connectDir);

        // Restore credentials.json at connector root
        if (connData.credentials && typeof connData.credentials === "object") {
          mkdirSync(connectorDir, { recursive: true });
          writeFileSync(join(connectorDir, "credentials.json"), JSON.stringify(connData.credentials, null, 2));
          imported++;
        }

        if (!connData.profiles || typeof connData.profiles !== "object") continue;

        const profilesDir = join(connectorDir, "profiles");
        for (const [profileName, config] of Object.entries(connData.profiles)) {
          if (!config || typeof config !== "object") continue;
          mkdirSync(profilesDir, { recursive: true });
          writeFileSync(join(profilesDir, `${profileName}.json`), JSON.stringify(config, null, 2));
          imported++;
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ success: true, imported }));
      } else {
        console.log(chalk.green(`✓ Imported ${imported} profile(s)`));
      }
    });

  // Auth-import command — migrate tokens from older connector homes into the connectors data root
  program
    .command("auth-import")
    .option("--json", "Output as JSON", false)
    .option("-d, --dry-run", "Preview what would be imported without copying", false)
    .option("--force", "Overwrite existing files in the connectors data root", false)
    .description("Migrate auth tokens from ~/.connect/ to the connectors data root")
    .action((options: { json: boolean; dryRun: boolean; force: boolean }) => {
      const oldBase = join(homedir(), ".connect");
      const newBase = getConnectorsHome();

      if (!existsSync(oldBase)) {
        if (options.json) {
          console.log(JSON.stringify({ imported: [], skipped: [], error: null, message: "No ~/.connect/ directory found" }));
        } else {
          console.log(chalk.dim("No ~/.connect/ directory found. Nothing to import."));
        }
        return;
      }

      // Find all connect-* directories in ~/.connect/
      const entries = readdirSync(oldBase).filter((name) => {
        if (!name.startsWith("connect-")) return false;
        try { return statSync(join(oldBase, name)).isDirectory(); } catch { return false; }
      });

      if (entries.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ imported: [], skipped: [], message: "No connect-* directories found in ~/.connect/" }));
        } else {
          console.log(chalk.dim("No connect-* directories found in ~/.connect/. Nothing to import."));
        }
        return;
      }

      const imported: Array<{ connector: string; files: string[] }> = [];
      const skipped: Array<{ connector: string; files: string[] }> = [];

      for (const dirName of entries) {
        const oldDir = join(oldBase, dirName);
        const connectorName = dirName.replace(/^connect-/, "");
        const newDir = getConnectorConfigDir(connectorName, newBase);

        // Collect all files recursively from the old directory
        const allFiles = listFilesRecursive(oldDir);

        // Filter to auth-related files
        const authFiles = allFiles.filter((f) => {
          return f === "credentials.json"
            || f === "config.json"
            || f === "tokens.json"
            || f === "current_profile"
            || f.startsWith("profiles/") || f.startsWith("profiles\\");
        });

        if (authFiles.length === 0) continue;

        const copiedFiles: string[] = [];
        const skippedFiles: string[] = [];

        for (const relFile of authFiles) {
          const srcPath = join(oldDir, relFile);
          const destPath = join(newDir, relFile);

          if (existsSync(destPath) && !options.force) {
            skippedFiles.push(relFile);
            continue;
          }

          if (!options.dryRun) {
            // Ensure parent directory exists
            const parentDir = join(destPath, "..");
            mkdirSync(parentDir, { recursive: true });
            // Copy file contents
            const content = readFileSync(srcPath);
            writeFileSync(destPath, content);
          }
          copiedFiles.push(relFile);
        }

        if (copiedFiles.length > 0) {
          imported.push({ connector: connectorName, files: copiedFiles });
        }
        if (skippedFiles.length > 0) {
          skipped.push({ connector: connectorName, files: skippedFiles });
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ dryRun: options.dryRun, force: options.force, imported, skipped }, null, 2));
        return;
      }

      if (options.dryRun) {
        console.log(chalk.bold("\nDry run — no changes will be made\n"));
      } else {
        console.log(chalk.bold("\nAuth Import Results\n"));
      }

      for (const entry of imported) {
        console.log(`  ${chalk.green("✓")} ${chalk.cyan(entry.connector)}`);
        for (const f of entry.files) {
          console.log(chalk.dim(`      ${options.dryRun ? "would copy" : "copied"}: ${f}`));
        }
      }

      for (const entry of skipped) {
        console.log(`  ${chalk.yellow("⊘")} ${chalk.cyan(entry.connector)}`);
        for (const f of entry.files) {
          console.log(chalk.dim(`      skipped (exists): ${f}`));
        }
      }

      if (imported.length === 0 && skipped.length === 0) {
        console.log(chalk.dim("  No auth files found to import."));
      }

      // Summary
      const totalCopied = imported.reduce((sum, e) => sum + e.files.length, 0);
      const totalSkipped = skipped.reduce((sum, e) => sum + e.files.length, 0);
      const parts: string[] = [];
      if (totalCopied > 0) parts.push(chalk.green(`${totalCopied} file${totalCopied !== 1 ? "s" : ""} ${options.dryRun ? "to copy" : "copied"}`));
      if (totalSkipped > 0) parts.push(chalk.yellow(`${totalSkipped} skipped`));
      if (parts.length > 0) {
        console.log(`\n  ${chalk.bold("Summary:")} ${parts.join(", ")}`);
      }

      if (options.dryRun) {
        console.log(chalk.dim("\n  Run without --dry-run to apply.\n"));
      } else {
        console.log();
      }
    });
}
