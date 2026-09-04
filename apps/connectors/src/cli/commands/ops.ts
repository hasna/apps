import { Command } from "commander";
import chalk from "chalk";
import { getConnector } from "../../lib/registry.js";
import { getInstalledConnectors } from "../../lib/installer.js";
import { getAuthStatus, getAuthType, saveApiKey } from "../../server/auth.js";
import {
  getConnectorOperations,
  runConnectorCommand,
  getConnectorCommandHelp,
  hasConnectorCommandSurface,
} from "../../lib/runner.js";
import {
  getCurrentOAuthProfile,
  getOAuthTokenPathsForProfile,
  hasOAuthTokenFileUpdatedSince,
} from "./auth.js";
import { maybeTruncateOutput } from "../../lib/compact-output.js";

function argsRequestJson(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") return true;
    if ((arg === "--format" || arg === "-f") && args[i + 1] === "json") return true;
    if (arg === "--format=json" || arg === "-f=json") return true;
  }
  return false;
}

export function registerCommands(program: Command): void {
  // ============================================
  // Operations Discovery
  // ============================================
  program
    .command("ops")
    .description("List available API operations for a connector")
    .argument("<name>", "Connector name (e.g. stripe, gmail)")
    .argument("[command]", "Get detailed help for a specific subcommand")
    .option("--json", "Output as JSON")
    .action(async (name: string, command: string | undefined, options: { json?: boolean }) => {
      const meta = getConnector(name);
      if (!meta) {
        console.error(chalk.red(`Connector '${name}' not found.`));
        console.error(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
        process.exit(1);
      }

      if (!hasConnectorCommandSurface(name)) {
        console.error(chalk.red(`Connector '${name}' does not expose runnable operations.`));
        console.error(chalk.dim(`Run 'connectors docs ${name}' to see how to use this connector programmatically.`));
        process.exit(1);
      }

      if (command) {
        const help = await getConnectorCommandHelp(name, command);
        if (options.json) {
          console.log(JSON.stringify({ connector: name, command, help }, null, 2));
        } else {
          console.log(chalk.bold(`\n${meta.displayName} → ${command}\n`));
          console.log(help);
        }
        return;
      }

      const ops = await getConnectorOperations(name);

      if (options.json) {
        console.log(JSON.stringify({
          connector: name,
          displayName: meta.displayName,
          auth: getAuthStatus(name),
          commands: ops.commands,
          operations: ops.operations,
        }, null, 2));
      } else {
        console.log(chalk.bold(`\n${meta.displayName} operations:\n`));
        if (ops.operations.length > 0) {
          for (const operation of ops.operations) {
            const aliases = operation.aliases.length > 0
              ? chalk.dim(` aliases: ${operation.aliases.join(", ")}`)
              : "";
            const summary = operation.summary
              ? chalk.dim(` — ${operation.summary}`)
              : "";
            console.log(`  ${chalk.cyan(operation.name)}${aliases}${summary}`);
          }
          console.log(chalk.dim(`\n  Run ${chalk.white(`connectors ops ${name} <command>`)} for details`));
          console.log(chalk.dim(`  Run ${chalk.white(`connectors run ${name} <command> [args...]`)} to execute\n`));
        } else {
          console.log(ops.helpText);
        }
      }
    });

  // ============================================
  // Run Connector Operation
  // ============================================
  program
    .command("run")
    .description("Execute an API operation on a connector")
    .argument("<name>", "Connector name (e.g. stripe, gmail)")
    .argument("[args...]", "Command arguments (e.g. products list --limit 5)")
    .option("--timeout <ms>", "Timeout in milliseconds", "30000")
    .option("-v, --verbose", "Print full command output without truncation", false)
    .passThroughOptions()
    .action(async (name: string, args: string[], options: { timeout: string; verbose: boolean }) => {
      const meta = getConnector(name);
      if (!meta) {
        console.error(chalk.red(`Connector '${name}' not found.`));
        console.error(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
        process.exit(1);
      }

      if (!hasConnectorCommandSurface(name)) {
        console.error(chalk.red(`Connector '${name}' does not expose runnable operations.`));
        console.error(chalk.dim(`Run 'connectors docs ${name}' to see how to use this connector programmatically.`));
        process.exit(1);
      }

      if (args.length === 0) {
        console.error(chalk.yellow(`No command specified. Run ${chalk.white(`connectors ops ${name}`)} to see available operations.`));
        process.exit(1);
      }

      const result = await runConnectorCommand(name, args, parseInt(options.timeout));

      if (result.stdout) {
        const preserveMachineOutput = argsRequestJson(args);
        const output = maybeTruncateOutput(result.stdout, {
          enabled: !options.verbose && !preserveMachineOutput,
          hint: "Use `connectors run --verbose <connector> ...` for full output.",
        });
        console.log(output.text);
      }
      if (result.stderr) {
        console.error(result.stderr);
      }

      process.exit(result.exitCode);
    });

  // ============================================
  // Setup Command — Install + Auth + Verify
  // ============================================
  program
    .command("setup")
    .argument("<name>", "Connector name to set up")
    .option("-k, --key <value>", "API key or bearer token value")
    .option("-f, --field <field>", "Which field to set (for multi-field connectors)")
    .option("-o, --overwrite", "Overwrite existing installation", false)
    .option("--json", "Output as JSON", false)
    .option("--no-browser", "Print OAuth URL without opening a browser (agent-friendly)", false)
    .description("Install, configure auth, and verify a connector in one step")
    .action(async (name: string, options: { key?: string; field?: string; overwrite: boolean; json: boolean; browser: boolean }) => {
      const meta = getConnector(name);
      if (!meta) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Connector '${name}' not found. Run 'connectors list' to see available connectors.` }));
        } else {
          console.log(chalk.red(`Connector '${name}' not found`));
          console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${name}' to search.`));
        }
        process.exit(1);
        return;
      }

      if (!options.json) {
        console.log(chalk.bold(`\nSetting up ${meta.displayName}...\n`));
      }

      // Step 1: Install (if not already installed)
      const { installConnector, getInstalledConnectors } = await import("../../lib/installer.js");
      const installed = getInstalledConnectors();
      const alreadyInstalled = installed.includes(meta.name);
      let installResult: { success: boolean; path?: string; error?: string };

      if (alreadyInstalled && !options.overwrite) {
        installResult = { success: true, path: ".connectors/manifest.json" };
        if (!options.json) {
          console.log(`  ${chalk.green("✓")} Already enabled for this project`);
        }
      } else {
        const result = installConnector(name, { overwrite: options.overwrite });
        installResult = { success: result.success, path: result.path, error: result.error };
        if (!options.json) {
          if (result.success) {
            console.log(`  ${chalk.green("✓")} Installed → ${chalk.dim(result.path)}`);
          } else {
            console.log(`  ${chalk.red("✗")} Install failed: ${result.error}`);
            process.exit(1);
            return;
          }
        } else if (!result.success) {
          console.log(JSON.stringify({ error: `Install failed: ${result.error}` }));
          process.exit(1);
          return;
        }
      }

      // Step 2: Configure auth
      const authType = getAuthType(name);
      let authConfigured = false;

      if (authType === "oauth") {
        // OAuth: start server and open browser for auth flow
        if (options.key) {
          // Allow manual token setting even for OAuth connectors
          await saveApiKey(name, options.key, options.field || undefined);
          authConfigured = true;
          if (!options.json) {
            console.log(`  ${chalk.green("✓")} Token saved`);
          }
        } else {
          const statusBefore = getAuthStatus(name);
          if (statusBefore.configured) {
            authConfigured = true;
            if (!options.json) {
              console.log(`  ${chalk.green("✓")} OAuth already configured`);
            }
          } else {
            if (options.json) {
              // Can't do OAuth interactively in JSON mode
              const summary = {
                connector: name,
                displayName: meta.displayName,
                installed: installResult.success,
                path: installResult.path,
                authType: "oauth",
                authConfigured: false,
                message: "OAuth requires browser-based authentication. Use 'connectors serve' or pass --key to set tokens manually.",
              };
              console.log(JSON.stringify(summary, null, 2));
              process.exit(0);
              return;
            }

            // Start server and open browser for OAuth
            console.log(`  ${chalk.yellow("⟳")} OAuth authentication required — starting server...`);

            const port = 9876;
            const oauthUrl = `http://localhost:${port}/oauth/${name}/start`;

            if (!options.browser) {
              // --no-browser: spawn detached server, print URL, wait for tokens
              console.log(`\n  ${chalk.bold("Open this URL to authenticate:")}`);
              console.log(`  ${chalk.cyan(oauthUrl)}\n`);

              const { spawn } = await import("child_process");
              const { getConnectorsHome } = await import("../../db/database.js");

              const scriptPath = process.argv[1];
              const serverProc = spawn(process.execPath, [scriptPath, "serve", "--port", String(port)], {
                detached: true,
                stdio: "ignore",
              });
              const startedAt = Date.now();
              serverProc.unref();
              await new Promise<void>((resolve) => setTimeout(resolve, 2000));

              try {
                await fetch(`http://localhost:${port}/api/connectors`);
              } catch {
                console.log(`  ${chalk.red("✗")} OAuth server failed to start on port ${port}.`);
                process.exit(1);
                return;
              }

              console.log(chalk.dim("  Waiting for authentication to complete..."));
              const connectorsHome = getConnectorsHome();
              const activeProfile = getCurrentOAuthProfile(name, connectorsHome);
              const tokenPaths = getOAuthTokenPathsForProfile(name, connectorsHome, activeProfile);

              let attempts = 0;
              const maxAttempts = 360;
              while (attempts < maxAttempts) {
                await new Promise<void>((resolve) => setTimeout(resolve, 500));
                if (hasOAuthTokenFileUpdatedSince(tokenPaths, startedAt)) break;
                attempts++;
                if (attempts % 6 === 0) process.stdout.write(".");
              }

              try { serverProc.kill("SIGTERM"); } catch {}

              if (attempts >= maxAttempts) {
                console.log();
                console.log(chalk.yellow("  Timed out waiting for OAuth callback."));
                process.exit(1);
                return;
              }

              console.log();
              console.log(`  ${chalk.green("✓")} ${meta.displayName} is now authenticated.`);
              authConfigured = true;
              process.exit(0);
              return;
            }

            try {
              const { startServer } = await import("../../server/serve.js");
              await startServer(port, { strict: true });

              console.log(`\n  ${chalk.bold("Open this URL to authenticate:")}`);
              console.log(`  ${chalk.cyan(oauthUrl)}\n`);

              const { openBrowser } = await import("../../lib/open-browser.js");
              const opened = await openBrowser(oauthUrl);
              if (opened.ok) {
                console.log(chalk.dim("  Browser opened. Complete the OAuth flow, then press Ctrl+C.\n"));
              } else {
                console.log(chalk.dim("  Open the URL above in your browser.\n"));
              }

              await new Promise<void>(() => {});
            } catch (err) {
              console.log(`  ${chalk.red("✗")} OAuth flow failed: ${err}`);
              console.log(chalk.dim("  Try 'connectors serve' for the OAuth flow."));
            }
            process.exit(0);
            return;
          }
        }
      } else {
        // API Key / Bearer Token
        if (options.key) {
          await saveApiKey(name, options.key, options.field || undefined);
          authConfigured = true;
          if (!options.json) {
            console.log(`  ${chalk.green("✓")} ${authType === "bearer" ? "Bearer token" : "API key"} saved`);
          }
        } else {
          const statusBefore = getAuthStatus(name);
          if (statusBefore.configured) {
            authConfigured = true;
            if (!options.json) {
              console.log(`  ${chalk.green("✓")} Auth already configured (${authType === "bearer" ? "bearer token" : "API key"})`);
            }
          } else {
            if (!options.json) {
              console.log(`  ${chalk.yellow("⚠")} No API key provided. Use --key <value> to configure auth.`);
            }
          }
        }
      }

      // Step 3: Verify auth status
      const finalStatus = getAuthStatus(name);

      if (options.json) {
        const summary = {
          connector: name,
          displayName: meta.displayName,
          installed: installResult.success,
          path: installResult.path,
          authType: finalStatus.type,
          authConfigured: finalStatus.configured,
          envVars: finalStatus.envVars,
          tokenExpiry: finalStatus.tokenExpiry,
        };
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log();
        console.log(chalk.bold("  Summary"));
        console.log(`  ├─ Connector: ${meta.displayName}`);
        console.log(`  ├─ Installed: ${chalk.green("yes")}`);
        console.log(`  ├─ Auth type: ${finalStatus.type === "oauth" ? "OAuth" : finalStatus.type === "apikey" ? "API Key" : "Bearer Token"}`);
        console.log(`  └─ Auth:      ${finalStatus.configured ? chalk.green("configured") : chalk.red("not configured")}`);
        console.log();
      }

      process.exit(0);
    });
}
