import type { Command } from "commander";
import chalk from "chalk";
import { resolveContactsClientTransport } from "../cloud/http-storage.js";

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
    issue: resolution.issue,
    warning: resolution.warning,
    local_fallback: false,
  };
}

export function registerStorageCommands(program: Command): void {
  program
    .command("connection")
    .description("Inspect the canonical contacts HTTPS client configuration")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      const status = connectionStatus();
      if (opts.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      console.log(`Transport: ${status.transport === "https" ? chalk.green("https") : chalk.red("unconfigured")}`);
      console.log(`Configured: ${status.configured ? chalk.green("yes") : chalk.red("no")}`);
      if (status.api_url_source) console.log(`API URL source: ${status.api_url_source}`);
      console.log(`API key: ${status.api_key_present ? chalk.green("present") : chalk.red("not resolved")}`);
      if (status.issue) console.log(chalk.red(`Issue: ${status.issue}`));
      if (status.warning) console.log(chalk.yellow(`Warning: ${status.warning}`));
      console.log(chalk.gray("Local fallback: disabled"));
    });
}
