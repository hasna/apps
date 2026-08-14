#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { UpdownIo } from "../api";
import {
  getApiKey,
  setApiKey,
  clearConfig,
  getConfigDir,
  setProfileOverride,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
} from "../utils/config";
import type { OutputFormat } from "../utils/output";
import { success, error, info, print, setVerboseMode, debug } from "../utils/output";

const CONNECTOR_NAME = "connect-updown-io";
const VERSION = "0.0.1";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("updown.io website monitoring connector")
  .version(VERSION)
  .option("-k, --api-key <key>", "API key (overrides config)")
  .option("-f, --format <format>", "Output format (json, pretty, table)", "pretty")
  .option("-p, --profile <profile>", "Use a specific profile")
  .option("-v, --verbose", "Enable verbose output for debugging")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerboseMode(true);
      debug("Verbose mode enabled");
    }
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(
          `Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`,
        );
        process.exit(1);
      }
      setProfileOverride(opts.profile);
      debug(`Using profile: ${opts.profile}`);
    }
    if (opts.apiKey) {
      process.env.UPDOWN_IO_API_KEY = opts.apiKey;
      debug("API key set from command line flag");
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || "pretty") as OutputFormat;
}

function getClient(): UpdownIo {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(
      `No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set UPDOWN_IO_API_KEY.`,
    );
    process.exit(1);
  }
  return new UpdownIo({ apiKey });
}

const profileCmd = program.command("profile").description("Manage configuration profiles");

profileCmd
  .command("list")
  .description("List all profiles")
  .action(() => {
    const profiles = listProfiles();
    const current = getCurrentProfile();
    if (profiles.length === 0) {
      info('No profiles found. Use "profile create <name>" to create one.');
      return;
    }
    success("Profiles:");
    profiles.forEach((p) => {
      const isActive = p === current ? chalk.green(" (active)") : "";
      console.log(`  ${p}${isActive}`);
    });
  });

profileCmd
  .command("use <name>")
  .description("Switch to a profile")
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist. Create it with "profile create ${name}"`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command("create <name>")
  .description("Create a new profile")
  .option("--api-key <key>", "API key")
  .option("--use", "Switch to this profile after creation")
  .action((name: string, opts: { apiKey?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiKey: opts.apiKey });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd
  .command("delete <name>")
  .description("Delete a profile")
  .action((name: string) => {
    if (name === "default") {
      error("Cannot delete the default profile");
      process.exit(1);
    }
    if (deleteProfile(name)) {
      success(`Profile "${name}" deleted`);
    } else {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
  });

profileCmd
  .command("show [name]")
  .description("Show profile configuration")
  .action((name?: string) => {
    const profileName = name || getCurrentProfile();
    const config = loadProfile(profileName);
    const active = getCurrentProfile();
    console.log(
      chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(" (active)") : ""}`),
    );
    info(`API Key: ${config.apiKey ? `${config.apiKey.substring(0, 8)}...` : chalk.gray("not set")}`);
  });

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set-key <apiKey>")
  .description("Set API key")
  .action((apiKey: string) => {
    setApiKey(apiKey);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    const profileName = getCurrentProfile();
    const apiKey = getApiKey();
    console.log(chalk.bold(`Active Profile: ${profileName}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${apiKey ? `${apiKey.substring(0, 8)}...` : chalk.gray("not set")}`);
  });

configCmd
  .command("clear")
  .description("Clear configuration for active profile")
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

const checksCmd = program.command("checks").description("Manage uptime checks");

checksCmd
  .command("list")
  .description("List all checks")
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listChecks();
      print(result, getFormat(checksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

checksCmd
  .command("get <token>")
  .description("Get a single check")
  .option("--metrics", "Include performance metrics")
  .option("--results", "Include detailed results")
  .action(async (token: string, opts: { metrics?: boolean; results?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.getCheck(token, {
        metrics: opts.metrics,
        results: opts.results,
      });
      print(result, getFormat(checksCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const downtimesCmd = program.command("downtimes").description("Check downtime history");

downtimesCmd
  .command("list <token>")
  .description("List downtimes for a check")
  .option("--page <number>", "Page number", "1")
  .option("--results", "Include detailed results")
  .action(async (token: string, opts: { page: string; results?: boolean }) => {
    try {
      const client = getClient();
      const result = await client.listDowntimes(token, {
        page: parseInt(opts.page, 10),
        results: opts.results,
      });
      print(result, getFormat(downtimesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const metricsCmd = program.command("metrics").description("Check performance metrics");

metricsCmd
  .command("get <token>")
  .description("Get metrics for a check")
  .option("--from <time>", "Start time")
  .option("--to <time>", "End time")
  .option("--group <group>", "Group by time or host")
  .action(async (token: string, opts: { from?: string; to?: string; group?: string }) => {
    try {
      const client = getClient();
      const result = await client.listMetrics(token, {
        from: opts.from,
        to: opts.to,
        group: opts.group,
      });
      print(result, getFormat(metricsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const nodesCmd = program.command("nodes").description("updown.io monitoring nodes");

nodesCmd
  .command("list")
  .description("List monitoring nodes")
  .action(async () => {
    try {
      const client = getClient();
      const result = await client.listNodes();
      print(result, getFormat(nodesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

nodesCmd
  .command("ips")
  .description("List monitoring node IP addresses")
  .option("--format <format>", "Response format (json or txt)", "json")
  .action(async (opts: { format: string }) => {
    try {
      const format = opts.format === "txt" ? "txt" : "json";
      const client = getClient();
      const result = await client.listNodeIps(format);
      if (format === "txt") {
        console.log(result);
      } else {
        print(result, getFormat(nodesCmd));
      }
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
