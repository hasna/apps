import type { Command } from "commander";
import chalk from "chalk";
import { displayIssue, resolveContactsClientTransport } from "../cloud/http-storage.js";

function connectionStatus() {
  const resolution = resolveContactsClientTransport("contacts");
  return {
    transport: resolution.transport,
    configured: resolution.configured,
    api_url_source: resolution.apiUrlSource,
    api_key_present: resolution.apiKeyPresent,
    api_key_source: resolution.apiKeySource,
    api_key_tier: resolution.apiKeyTier,
    misconfigured: resolution.misconfigured,
    issue: displayIssue(resolution.issue),
    warning: resolution.warning,
    // The transport the client actually uses: the hosted /v1 API when
    // configured, otherwise the local SQLite store. Nothing is gated.
    active_transport: resolution.configured ? "api" : "local",
  };
}

export function registerStorageCommands(program: Command): void {
  program
    .command("connection")
    .description("Inspect the active contacts client transport and API configuration")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const status = connectionStatus();
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      const apiLabel = status.configured ? chalk.green(`https (${status.api_url_source ?? "default"})`) : chalk.yellow("not configured");
      console.log(`Transport:    ${status.configured ? chalk.green("api (/v1)") : chalk.yellow("local (sqlite)")}`);
      console.log(`API:          ${apiLabel}`);
      console.log(`API key:      ${status.api_key_present ? chalk.green("present") : chalk.red("not resolved")}`);
      if (status.api_key_tier) console.log(`API key tier: ${status.api_key_tier}`);
      if (status.issue) console.log(chalk.red(`Issue: ${status.issue}`));
      if (status.warning) console.log(chalk.yellow(`Warning: ${status.warning}`));
      if (!status.configured) {
        console.log(chalk.gray("No API configuration resolved — commands use the local SQLite store at the data path."));
      }
    });
}