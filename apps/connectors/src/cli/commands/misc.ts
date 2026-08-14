import { Command } from "commander";
import chalk from "chalk";
import { CONNECTORS, CATEGORIES } from "../../lib/registry.js";
import { getInstalledConnectors, getConnectorDocs } from "../../lib/installer.js";
import { getAuthStatus } from "../../server/auth.js";
import { getConnectorsHome } from "../../db/database.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { TEST_ENDPOINTS } from "../../lib/test-endpoints.js";
import { refreshOAuthToken } from "../../server/auth.js";
import { PRESETS, isTTY } from "./install.js";
import {
  getConnectorConfigReadDirs,
  listConfiguredConnectorNames,
} from "../../lib/connector-resolver.js";
import { DEFAULT_COMPACT_LIMIT, pageItems, truncateText } from "../../lib/compact-output.js";

export function registerCommands(program: Command): void {
  // Upgrade command — check for and install latest version
  program
    .command("upgrade")
    .alias("self-update")
    .option("--check", "Only check for updates, don't install", false)
    .option("--json", "Output as JSON", false)
    .description("Check for updates and upgrade to the latest version")
    .action(async (options: { check: boolean; json: boolean }) => {
      const currentVersion = program.version() as string;

      try {
        const res = await fetch("https://registry.npmjs.org/@hasna/connectors/latest");
        if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
        const data = await res.json() as { version: string };
        const latestVersion = data.version;
        const isUpToDate = currentVersion === latestVersion;

        if (options.json) {
          console.log(JSON.stringify({ current: currentVersion, latest: latestVersion, upToDate: isUpToDate }));
          if (options.check) { process.exit(isUpToDate ? 0 : 1); return; }
        } else {
          console.log(`\n  Current: ${chalk.cyan(currentVersion)}`);
          console.log(`  Latest:  ${chalk.cyan(latestVersion)}`);
          if (isUpToDate) {
            console.log(chalk.green("\n  Already up to date!\n"));
            process.exit(0);
            return;
          }
          console.log(chalk.yellow(`\n  Update available: ${currentVersion} → ${latestVersion}`));
        }

        if (options.check) {
          if (!options.json) console.log(chalk.dim(`\n  Run 'connectors upgrade' to install.\n`));
          process.exit(isUpToDate ? 0 : 1);
          return;
        }

        // Detect package manager and run upgrade
        if (!options.json) console.log(chalk.dim(`\n  Upgrading...`));
        const { execSync } = await import("child_process");
        try {
          execSync(`bun install -g @hasna/connectors@${latestVersion}`, { stdio: options.json ? "pipe" : "inherit" });
        } catch {
          try {
            execSync(`npm install -g @hasna/connectors@${latestVersion}`, { stdio: options.json ? "pipe" : "inherit" });
          } catch (e) {
            if (options.json) {
              console.log(JSON.stringify({ error: "Failed to upgrade. Try manually: bun install -g @hasna/connectors@latest" }));
            } else {
              console.log(chalk.red(`\n  Failed to upgrade. Try manually:`));
              console.log(chalk.dim(`  bun install -g @hasna/connectors@latest\n`));
            }
            process.exit(1);
            return;
          }
        }

        if (options.json) {
          console.log(JSON.stringify({ upgraded: true, from: currentVersion, to: latestVersion }));
        } else {
          console.log(chalk.green(`\n  Upgraded to ${latestVersion}!\n`));
        }
      } catch (e) {
        if (options.json) {
          console.log(JSON.stringify({ error: e instanceof Error ? e.message : "Failed to check for updates" }));
        } else {
          console.log(chalk.red(`\n  Failed to check for updates: ${e instanceof Error ? e.message : e}\n`));
        }
        process.exit(1);
      }
    });

  // Completions command — output shell completion scripts
  program
    .command("completions")
    .argument("<shell>", "Shell type: bash, zsh, or fish")
    .description("Output shell completion script")
    .action((shell: string) => {
      const commands = ["interactive", "install", "list", "search", "info", "docs", "remove", "categories", "serve", "update", "status", "doctor", "auth", "init", "export", "import", "upgrade", "completions"];
      const connectorNames = CONNECTORS.map(c => c.name);
      const categoryNames = CATEGORIES.map(c => `"${c}"`);

      if (shell === "zsh") {
        console.log(`#compdef connectors
_connectors() {
  local -a commands connectors categories
  commands=(${commands.join(" ")})
  connectors=(${connectorNames.join(" ")})
  categories=(${categoryNames.map(c => c.replace(/"/g, '\\"')).join(" ")})

  if (( CURRENT == 2 )); then
    _describe 'command' commands
  elif (( CURRENT == 3 )); then
    case "\${words[2]}" in
      install|add|info|docs|remove|rm|auth)
        _describe 'connector' connectors ;;
      search) _message 'search query' ;;
      list|ls) _arguments '--category[Filter by category]:category:(${CATEGORIES.join(" ").replace(/&/g, "\\&")})' '--installed' '--json' '--brief' ;;
      *) ;;
    esac
  fi
}
compdef _connectors connectors`);
      } else if (shell === "bash") {
        console.log(`_connectors() {
  local cur prev commands connectors
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${commands.join(" ")}"
  connectors="${connectorNames.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
  elif [[ \${COMP_CWORD} -eq 2 ]]; then
    case "\${prev}" in
      install|add|info|docs|remove|rm|auth)
        COMPREPLY=( $(compgen -W "\${connectors}" -- "\${cur}") ) ;;
    esac
  fi
}
complete -F _connectors connectors`);
      } else if (shell === "fish") {
        let script = `# Fish completions for connectors\n`;
        for (const cmd of commands) {
          script += `complete -c connectors -n "__fish_use_subcommand" -a "${cmd}"\n`;
        }
        script += `# Connector names for install/info/docs/remove/auth\n`;
        for (const name of connectorNames) {
          script += `complete -c connectors -n "__fish_seen_subcommand_from install add info docs remove rm auth" -a "${name}"\n`;
        }
        console.log(script);
      } else {
        console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`);
        process.exit(1);
      }
    });

  // Env command — generate .env.example from installed connectors
  program
    .command("env")
    .option("-o, --output <file>", "Write to file instead of stdout")
    .option("--json", "Output as JSON", false)
    .description("Generate .env.example from installed connectors' required env vars")
    .action((options: { output?: string; json: boolean }) => {
      const installed = getInstalledConnectors();
      if (installed.length === 0) {
        if (options.json) { console.log(JSON.stringify({ vars: [], connectors: [] })); }
        else { console.log(chalk.dim("No connectors installed. Run: connectors install <name>")); }
        return;
      }

      const vars: Array<{ variable: string; description: string; connector: string }> = [];
      const seen = new Set<string>();

      for (const name of installed) {
        const docs = getConnectorDocs(name);
        if (!docs?.envVars) continue;
        for (const v of docs.envVars) {
          if (!seen.has(v.variable)) {
            seen.add(v.variable);
            vars.push({ variable: v.variable, description: v.description, connector: name });
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ vars, connectors: installed }, null, 2));
        return;
      }

      const lines: string[] = [
        "# Environment Variables",
        `# Generated by connectors env (${installed.length} installed connectors)`,
        "#",
      ];

      let lastConnector = "";
      for (const v of vars) {
        if (v.connector !== lastConnector) {
          lines.push("");
          lines.push(`# ${v.connector}`);
          lastConnector = v.connector;
        }
        if (v.description) lines.push(`# ${v.description}`);
        lines.push(`${v.variable}=`);
      }

      const output = lines.join("\n") + "\n";

      if (options.output) {
        writeFileSync(options.output, output);
        console.log(chalk.green(`✓ Written to ${options.output} (${vars.length} variables)`));
      } else {
        console.log(output);
      }
    });

  // Presets command — list available connector presets
  program
    .command("presets")
    .option("--json", "Output as JSON", false)
    .option("-v, --verbose", "Show every connector in each preset", false)
    .description("List available connector preset bundles")
    .action((options: { json: boolean; verbose: boolean }) => {
      if (options.json) {
        console.log(JSON.stringify(Object.entries(PRESETS).map(([name, p]) => ({
          name,
          description: p.description,
          connectors: p.connectors,
          count: p.connectors.length,
        })), null, 2));
        return;
      }

      console.log(chalk.bold("\nAvailable presets:\n"));
      for (const [name, preset] of Object.entries(PRESETS)) {
        console.log(`  ${chalk.cyan(name.padEnd(12))} ${preset.description}`);
        const visible = options.verbose ? preset.connectors : preset.connectors.slice(0, 5);
        const suffix = !options.verbose && preset.connectors.length > visible.length
          ? `, ... +${preset.connectors.length - visible.length} more`
          : "";
        console.log(chalk.dim(`  ${"".padEnd(12)} ${visible.join(", ")}${suffix}`));
        console.log();
      }
      console.log(chalk.dim(`  Install with: connectors install --preset <name>`));
      console.log(chalk.dim(`  More detail: connectors presets --verbose | connectors presets --json\n`));
    });

  // Whoami command — show current setup summary
  program
    .command("whoami")
    .option("--json", "Output as JSON", false)
    .option("-v, --verbose", "Show all connector rows", false)
    .description("Show current setup: config dir, installed connectors, auth status")
    .action((options: { json: boolean; verbose: boolean }) => {
      const configDir = getConnectorsHome();
      const installed = getInstalledConnectors();
      const version = "0.3.1";

      let configured = 0;
      let unconfigured = 0;
      const connectorDetails: Array<{ name: string; configured: boolean; authType: string; profile: string; source: "project" | "global" }> = [];
      const seen = new Set<string>();

      // Project-installed connectors
      for (const name of installed) {
        seen.add(name);
        const auth = getAuthStatus(name);
        if (auth.configured) configured++;
        else unconfigured++;

        // Read current profile
        let profile = "default";
        for (const connectorConfigDir of getConnectorConfigReadDirs(name, configDir)) {
          const currentProfileFile = join(connectorConfigDir, "current_profile");
          if (existsSync(currentProfileFile)) {
            try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
            break;
          }
        }

        connectorDetails.push({ name, configured: auth.configured, authType: auth.type, profile, source: "project" });
      }

      // Globally configured connectors from the shared connector home
      if (existsSync(configDir)) {
        try {
          for (const name of listConfiguredConnectorNames(configDir)) {
            if (seen.has(name)) continue;

            const auth = getAuthStatus(name);
            if (!auth.configured) continue; // Only show globally configured ones

            seen.add(name);
            configured++;

            let profile = "default";
            for (const connectorConfigDir of getConnectorConfigReadDirs(name, configDir)) {
              const currentProfileFile = join(connectorConfigDir, "current_profile");
              if (existsSync(currentProfileFile)) {
                try { profile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
                break;
              }
            }

            connectorDetails.push({ name, configured: true, authType: auth.type, profile, source: "global" });
          }
        } catch {
          // Ignore read errors in the shared connector home.
        }
      }

      if (options.json) {
        console.log(JSON.stringify({
          version,
          configDir,
          configDirExists: existsSync(configDir),
          installed: installed.length,
          configured,
          unconfigured,
          connectors: connectorDetails,
        }, null, 2));
        return;
      }

      console.log(chalk.bold("\nConnectors Setup\n"));
      console.log(`  Version:      ${chalk.cyan(version)}`);
      console.log(`  Config:       ${configDir}${existsSync(configDir) ? "" : chalk.dim(" (not created yet)")}`);
      console.log(`  Installed:    ${installed.length} connector${installed.length !== 1 ? "s" : ""}`);
      console.log(`  Configured:   ${chalk.green(String(configured))} ready, ${unconfigured > 0 ? chalk.red(String(unconfigured)) : chalk.dim("0")} need auth`);

      const projectConnectors = connectorDetails.filter(c => c.source === "project");
      const globalConnectors = connectorDetails.filter(c => c.source === "global");

      if (projectConnectors.length > 0) {
        const page = pageItems(projectConnectors, {
          limit: options.verbose ? undefined : DEFAULT_COMPACT_LIMIT,
        });
        console.log(chalk.bold(`\n  Project Connectors (${page.items.length}/${projectConnectors.length}):\n`));
        const nameWidth = Math.max(10, ...projectConnectors.map(c => c.name.length)) + 2;
        for (const c of page.items) {
          const status = c.configured ? chalk.green("✓") : chalk.red("✗");
          const profileLabel = c.profile !== "default" ? chalk.dim(` [${c.profile}]`) : "";
          console.log(`    ${status} ${chalk.cyan(truncateText(c.name, nameWidth - 2).padEnd(nameWidth))}${c.authType.padEnd(8)}${profileLabel}`);
        }
        if (page.nextOffset !== null) {
          console.log(chalk.dim(`    ... ${projectConnectors.length - page.items.length} more (use --verbose)`));
        }
      }

      if (globalConnectors.length > 0) {
        const page = pageItems(globalConnectors, {
          limit: options.verbose ? undefined : DEFAULT_COMPACT_LIMIT,
        });
        console.log(chalk.bold(`\n  Global Connectors (${page.items.length}/${globalConnectors.length})`) + chalk.dim(" (~/.hasna/connectors)") + chalk.bold(":\n"));
        const nameWidth = Math.max(10, ...globalConnectors.map(c => c.name.length)) + 2;
        for (const c of page.items) {
          const status = c.configured ? chalk.green("✓") : chalk.red("✗");
          const profileLabel = c.profile !== "default" ? chalk.dim(` [${c.profile}]`) : "";
          console.log(`    ${status} ${chalk.cyan(truncateText(c.name, nameWidth - 2).padEnd(nameWidth))}${c.authType.padEnd(8)}${profileLabel}`);
        }
        if (page.nextOffset !== null) {
          console.log(chalk.dim(`    ... ${globalConnectors.length - page.items.length} more (use --verbose)`));
        }
      }

      if (connectorDetails.length === 0) {
        console.log(chalk.dim("\n  No connectors installed or configured."));
      }

      console.log(chalk.dim("\n  More detail: connectors whoami --verbose | connectors whoami --json\n"));
    });

  // Test command — verify API credentials by making a real request
  program
    .command("test")
    .argument("[connector]", "Connector to test (default: all installed)")
    .option("--json", "Output as JSON", false)
    .option("--timeout <ms>", "Request timeout in milliseconds", "10000")
    .description("Verify API credentials by making a real request to the connector's API")
    .action(async (connector: string | undefined, options: { json: boolean; timeout: string }) => {
      const timeout = parseInt(options.timeout, 10) || 10000;
      const installed = getInstalledConnectors();

      let toTest: string[];
      if (connector) {
        const { getConnector } = await import("../../lib/registry.js");
        if (!getConnector(connector)) {
          if (options.json) { console.log(JSON.stringify({ error: `Connector '${connector}' not found. Run 'connectors list' to see available connectors.` })); }
          else {
            console.log(chalk.red(`Connector '${connector}' not found`));
            console.log(chalk.dim(`Run 'connectors list' to see available connectors, or 'connectors search ${connector}' to search.`));
          }
          process.exit(1);
          return;
        }
        toTest = [connector];
      } else {
        if (installed.length === 0) {
          if (options.json) { console.log(JSON.stringify({ results: [], tested: 0 })); }
          else { console.log(chalk.dim("No connectors installed. Run: connectors install <name>")); }
          return;
        }
        toTest = installed;
      }

      if (!options.json) console.log(chalk.bold("\nTesting connector credentials...\n"));

      const results: Array<{ name: string; status: "pass" | "fail" | "skip" | "no-key"; message: string; ms?: number }> = [];

      for (const name of toTest) {
        const auth = getAuthStatus(name);
        const endpoint = TEST_ENDPOINTS[name];

        if (!auth.configured) {
          results.push({ name, status: "no-key", message: `No credentials configured. Run 'connectors auth ${name}' or 'connectors setup ${name} --key <your-key>'` });
          if (!options.json) console.log(`  ${chalk.dim("○")} ${chalk.dim(name)} — ${chalk.dim(`no credentials configured — run 'connectors auth ${name}'`)}`);
          continue;
        }

        if (!endpoint) {
          results.push({ name, status: "skip", message: `No test endpoint defined. Run 'connectors ops ${name}' to see available operations` });
          if (!options.json) console.log(`  ${chalk.dim("○")} ${chalk.dim(name)} — ${chalk.dim(`no test endpoint — run 'connectors ops ${name}' to see operations`)}`);
          continue;
        }

        // Get the API key or OAuth access token
        const docs = getConnectorDocs(name);
        const envVars = docs?.envVars || [];
        let apiKey: string | undefined;

        // Try env vars first
        for (const v of envVars) {
          if (process.env[v.variable]) {
            apiKey = process.env[v.variable];
            break;
          }
        }

        // Try profile config if no env var
        if (!apiKey) {
          const connectorConfigDirs = getConnectorConfigReadDirs(name);

          // Determine current profile
          let currentProfile = "default";
          for (const connectorConfigDir of connectorConfigDirs) {
            const currentProfileFile = join(connectorConfigDir, "current_profile");
            if (existsSync(currentProfileFile)) {
              try { currentProfile = readFileSync(currentProfileFile, "utf-8").trim() || "default"; } catch {}
              break;
            }
          }

          // Try OAuth tokens first (profiles/<name>/tokens.json) — refresh if expired
          const tokensFile = connectorConfigDirs
            .map((dir) => join(dir, "profiles", currentProfile, "tokens.json"))
            .find((path) => existsSync(path));
          if (tokensFile) {
            try {
              const tokens = JSON.parse(readFileSync(tokensFile, "utf-8"));
              const isExpired = tokens.expiresAt && Date.now() >= tokens.expiresAt - 60000;
              if (isExpired && tokens.refreshToken) {
                // Attempt auto-refresh before test
                try {
                  const refreshed = await refreshOAuthToken(name);
                  apiKey = refreshed.accessToken;
                  if (!options.json) console.log(`  ${chalk.dim("↻")} ${chalk.dim(name)} — ${chalk.dim("token refreshed")}`);
                } catch {
                  // Refresh failed, use existing token
                  if (tokens.accessToken) apiKey = tokens.accessToken;
                }
              } else if (tokens.accessToken) {
                apiKey = tokens.accessToken;
              }
            } catch {}
          }

          // Try flat profile config (profiles/<name>.json)
          if (!apiKey) {
            for (const connectorConfigDir of connectorConfigDirs) {
              const profileFile = join(connectorConfigDir, "profiles", `${currentProfile}.json`);
              if (existsSync(profileFile)) {
                try {
                  const config = JSON.parse(readFileSync(profileFile, "utf-8"));
                  apiKey = Object.values(config).find((v): v is string => typeof v === "string" && v.length > 0) as string | undefined;
                } catch {}
                if (apiKey) break;
              }
            }
          }

          // Try directory profile config (profiles/<name>/config.json)
          if (!apiKey) {
            for (const connectorConfigDir of connectorConfigDirs) {
              const profileDirConfig = join(connectorConfigDir, "profiles", currentProfile, "config.json");
              if (existsSync(profileDirConfig)) {
                try {
                  const config = JSON.parse(readFileSync(profileDirConfig, "utf-8"));
                  apiKey = Object.values(config).find((v): v is string => typeof v === "string" && v.length > 0) as string | undefined;
                } catch {}
                if (apiKey) break;
              }
            }
          }
        }

        if (!apiKey) {
          results.push({ name, status: "no-key", message: "Credentials configured but could not extract key" });
          if (!options.json) console.log(`  ${chalk.yellow("⚠")} ${chalk.yellow(name)} — ${chalk.dim("could not extract key")}`);
          continue;
        }

        // Build the test URL — some connectors use query param auth
        let testUrl = endpoint.url;
        const QUERY_PARAM_AUTH: Record<string, string> = {
          googlegemini: "key",
          googlemaps: "key",
          openweathermap: "appid",
          tomtom: "key",
        };
        if (QUERY_PARAM_AUTH[name]) {
          const sep = testUrl.includes("?") ? "&" : "?";
          testUrl = `${testUrl}${sep}${QUERY_PARAM_AUTH[name]}=${encodeURIComponent(apiKey)}`;
        }

        // Make the test request
        const start = Date.now();
        try {
          const body = endpoint.method === "POST"
            ? JSON.stringify(endpoint.body ?? { query: "test", num_results: 1 })
            : undefined;
          const res = await fetch(testUrl, {
            method: endpoint.method || "GET",
            headers: endpoint.headers(apiKey),
            body,
            signal: AbortSignal.timeout(timeout),
          });
          const ms = Date.now() - start;
          const successCodes = endpoint.successCodes || [200];

          if (successCodes.includes(res.status) || (res.status >= 200 && res.status < 300)) {
            results.push({ name, status: "pass", message: `OK (${res.status})`, ms });
            if (!options.json) console.log(`  ${chalk.green("✓")} ${chalk.green(name)} — ${chalk.dim(`${res.status} OK`)} ${chalk.dim(`(${ms}ms)`)}`);
          } else {
            const body = await res.text().catch(() => "");
            const msg = res.status === 401 ? `Invalid or expired credentials. Run 'connectors auth ${name}' to reconfigure` : `HTTP ${res.status}`;
            results.push({ name, status: "fail", message: msg, ms });
            if (!options.json) console.log(`  ${chalk.red("✗")} ${chalk.red(name)} — ${chalk.red(res.status === 401 ? "Invalid or expired credentials" : `HTTP ${res.status}`)} ${chalk.dim(`(${ms}ms)`)}`);
            if (!options.json && res.status === 401) console.log(chalk.dim(`      → Run 'connectors auth ${name}' to reconfigure credentials`));
          }
        } catch (e) {
          const ms = Date.now() - start;
          const msg = e instanceof Error ? e.message : String(e);
          results.push({ name, status: "fail", message: msg, ms });
          if (!options.json) console.log(`  ${chalk.red("✗")} ${chalk.red(name)} — ${chalk.red(msg)}`);
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ results, tested: results.length, passed: results.filter(r => r.status === "pass").length }, null, 2));
      } else {
        const passed = results.filter(r => r.status === "pass").length;
        const failed = results.filter(r => r.status === "fail").length;
        const skipped = results.filter(r => r.status === "skip" || r.status === "no-key").length;
        console.log();
        const parts: string[] = [];
        if (passed > 0) parts.push(chalk.green(`${passed} passed`));
        if (failed > 0) parts.push(chalk.red(`${failed} failed`));
        if (skipped > 0) parts.push(chalk.dim(`${skipped} skipped`));
        console.log(`  ${parts.join(", ")}\n`);
      }

      process.exit(results.some(r => r.status === "fail") ? 1 : 0);
    });
}
