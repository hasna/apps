#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { TextIt } from "../api";
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiToken,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  getTokenPrefix,
  listProfiles,
  loadProfile,
  profileExists,
  setApiToken,
  setCurrentProfile,
  setProfileOverride,
} from "../utils/config";
import type { OutputFormat } from "../utils/output";
import { error, info, print, setVerboseMode, success } from "../utils/output";

const CONNECTOR_NAME = "connect-textit";
const VERSION = "0.0.1";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("TextIt (RapidPro) API connector CLI")
  .version(VERSION)
  .option("-t, --token <token>", "API token (overrides config)")
  .option("-f, --format <format>", "Output format (json, pretty)", "pretty")
  .option("-p, --profile <profile>", "Use a specific profile")
  .option("-v, --verbose", "Enable verbose output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) setVerboseMode(true);
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
    if (opts.token) process.env.TEXTIT_API_TOKEN = opts.token;
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || "pretty") as OutputFormat;
}

function getClient(): TextIt {
  const apiToken = getApiToken();
  if (!apiToken) {
    error(`No API token configured. Run "${CONNECTOR_NAME} config set-token <token>" or set TEXTIT_API_TOKEN.`);
    process.exit(1);
  }
  return new TextIt({
    apiToken,
    baseUrl: getBaseUrl(),
    tokenPrefix: getTokenPrefix(),
  });
}

function parseJsonOption(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    error(`Invalid JSON for ${label}`);
    process.exit(1);
  }
}

const profileCmd = program.command("profile").description("Manage configuration profiles");

profileCmd.command("list").action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (profiles.length === 0) {
    info("No profiles found. Use \"profile create <name>\" to create one.");
    return;
  }
  success("Profiles:");
  for (const p of profiles) {
    const active = p === current ? chalk.green(" (active)") : "";
    console.log(`  ${p}${active}`);
  }
});

profileCmd.command("use <name>").action((name: string) => {
  if (!profileExists(name)) {
    error(`Profile "${name}" does not exist`);
    process.exit(1);
  }
  setCurrentProfile(name);
  success(`Switched to profile: ${name}`);
});

profileCmd
  .command("create <name>")
  .option("--token <token>", "API token")
  .option("--use", "Switch to this profile after creation")
  .action((name: string, opts: { token?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, { apiToken: opts.token });
    success(`Profile "${name}" created`);
    if (opts.use) {
      setCurrentProfile(name);
      info(`Switched to profile: ${name}`);
    }
  });

profileCmd.command("delete <name>").action((name: string) => {
  if (!deleteProfile(name)) {
    error(`Could not delete profile "${name}"`);
    process.exit(1);
  }
  success(`Profile "${name}" deleted`);
});

profileCmd.command("show [name]").action((name?: string) => {
  const profileName = name || getCurrentProfile();
  const config = loadProfile(profileName);
  const active = getCurrentProfile();
  console.log(chalk.bold(`Profile: ${profileName}${profileName === active ? chalk.green(" (active)") : ""}`));
  info(`API Token: ${config.apiToken ? `${config.apiToken.substring(0, 8)}...` : chalk.gray("not set")}`);
});

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd.command("set-token <token>").action((token: string) => {
  setApiToken(token);
  success(`API token saved to profile: ${getCurrentProfile()}`);
});

configCmd.command("show").action(() => {
  const token = getApiToken();
  console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
  info(`Config directory: ${getConfigDir()}`);
  info(`API Token: ${token ? `${token.substring(0, 8)}...` : chalk.gray("not set")}`);
  info(`Base URL: ${getBaseUrl() || chalk.gray("default (https://textit.com/api/v2)")}`);
});

configCmd.command("clear").action(() => {
  clearConfig();
  success(`Configuration cleared for profile: ${getCurrentProfile()}`);
});

const contactsCmd = program.command("contacts").description("Contact operations");

contactsCmd
  .command("list")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
  .option("--group <uuid>", "Filter by group UUID")
  .option("--query <text>", "Search query")
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listContacts({
        page: opts.page,
        page_size: opts.pageSize,
        group: opts.group,
        query: opts.query,
      });
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

contactsCmd
  .command("create")
  .requiredOption("-b, --body <json>", "Contact JSON body")
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const result = await client.createContact(parseJsonOption(opts.body, "contact body"));
      success("Contact created");
      print(result, getFormat(contactsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const messagesCmd = program.command("messages").description("Message operations");

messagesCmd
  .command("list")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
  .option("--contact <uuid>", "Filter by contact UUID")
  .option("--flow <uuid>", "Filter by flow UUID")
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listMessages({
        page: opts.page,
        page_size: opts.pageSize,
        contact: opts.contact,
        flow: opts.flow,
      });
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

messagesCmd
  .command("send")
  .requiredOption("-b, --body <json>", "Message JSON body")
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const result = await client.sendMessage(parseJsonOption(opts.body, "message body"));
      success("Message sent");
      print(result, getFormat(messagesCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

const flowsCmd = program.command("flows").description("Flow operations");

flowsCmd
  .command("list")
  .option("--page <n>", "Page number", (v) => parseInt(v, 10))
  .option("--page-size <n>", "Page size", (v) => parseInt(v, 10))
  .option("--archived", "Include archived flows")
  .action(async (opts) => {
    try {
      const client = getClient();
      const result = await client.listFlows({
        page: opts.page,
        page_size: opts.pageSize,
        archived: opts.archived ? true : undefined,
      });
      print(result, getFormat(flowsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

flowsCmd
  .command("start")
  .requiredOption("-b, --body <json>", "Flow start JSON body")
  .action(async (opts: { body: string }) => {
    try {
      const client = getClient();
      const result = await client.startFlow(parseJsonOption(opts.body, "flow start body"));
      success("Flow started");
      print(result, getFormat(flowsCmd));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program
  .command("raw")
  .description("Raw API request")
  .requiredOption("--path <path>", "Resource path (e.g. contacts or contacts.json)")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("-b, --body <json>", "JSON request body")
  .action(async (opts: { path: string; method: string; body?: string }) => {
    try {
      const client = getClient();
      const result = await client.rawRequest(opts.path, {
        method: opts.method.toUpperCase(),
        body: opts.body ? parseJsonOption(opts.body, "request body") : undefined,
      });
      print(result, getFormat(program));
    } catch (err) {
      error(String(err));
      process.exit(1);
    }
  });

program.parse();
