#!/usr/bin/env bun
import { Command } from "commander";
import chalk from "chalk";
import { TripleWhale } from "../api/index.js";
import {
  clearConfig,
  createProfile,
  deleteProfile,
  getApiKey,
  getBaseUrl,
  getConfigDir,
  getCurrentProfile,
  getShopDomain,
  listProfiles,
  loadProfile,
  profileExists,
  saveProfile,
  setApiKey,
  setBaseUrl,
  setCurrentProfile,
  setProfileOverride,
  setShopDomain,
} from "../utils/config.js";
import { COMMAND_SPECS, type QueryValue, type TripleWhaleCommandMethod } from "../types/index.js";
import type { OutputFormat } from "../utils/output.js";
import { error, info, print, success } from "../utils/output.js";

const CONNECTOR_NAME = "connect-triple-whale";
const VERSION = "0.1.0";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("Triple Whale connector — ecommerce analytics, attribution, data-in, SQL, and Moby")
  .version(VERSION)
  .option("-f, --format <format>", "Output format (json, pretty)", "pretty")
  .option("-p, --profile <profile>", "Use a specific profile")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.profile) {
      if (!profileExists(opts.profile)) {
        error(`Profile "${opts.profile}" does not exist. Create it with "${CONNECTOR_NAME} profile create ${opts.profile}"`);
        process.exit(1);
      }
      setProfileOverride(opts.profile);
    }
  });

function getFormat(cmd: Command): OutputFormat {
  const parent = cmd.parent;
  return (parent?.opts().format || "pretty") as OutputFormat;
}

function getClient(): TripleWhale {
  const apiKey = getApiKey();
  if (!apiKey) {
    error(`No API key configured. Run "${CONNECTOR_NAME} config set-key <key>" or set TRIPLE_WHALE_API_KEY.`);
    process.exit(1);
  }
  return new TripleWhale({
    apiKey,
    baseUrl: getBaseUrl(),
    shopDomain: getShopDomain(),
  });
}

function parseBody(body?: string): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("body must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    error(`Invalid --body JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

function shopFields(cmd: Command): void {
  cmd
    .option("--shop <shop>", "Shop domain or identifier")
    .option("--shop-domain <domain>", "Shop domain (alias)")
    .option("--shop-id <id>", "Shop ID (alias)");
}

function periodFields(cmd: Command): void {
  cmd
    .option("--start-date <date>", "Period start date")
    .option("--end-date <date>", "Period end date")
    .option("--body <json>", "Full request body as JSON (merged with flags)");
}

type CommonOpts = {
  shop?: string;
  shopDomain?: string;
  shopId?: string;
  body?: string;
  startDate?: string;
  endDate?: string;
  query?: string;
  question?: string;
  metrics?: string;
  todayHour?: string;
  page?: string;
  pageSize?: string;
  excludeJourneyData?: boolean;
  currency?: string;
  path?: string;
  method?: string;
};

function buildOptions(opts: CommonOpts): Record<string, unknown> {
  const base = parseBody(opts.body);
  if (opts.shop) base.shop = opts.shop;
  if (opts.shopDomain) base.shopDomain = opts.shopDomain;
  if (opts.shopId) base.shopId = opts.shopId;
  if (opts.startDate) base.startDate = opts.startDate;
  if (opts.endDate) base.endDate = opts.endDate;
  if (opts.query) base.query = opts.query;
  if (opts.question) base.question = opts.question;
  if (opts.currency) base.currency = opts.currency;
  if (opts.todayHour) base.todayHour = Number(opts.todayHour);
  if (opts.page) base.page = Number(opts.page);
  if (opts.pageSize) base.pageSize = Number(opts.pageSize);
  if (opts.excludeJourneyData) base.excludeJourneyData = true;
  if (opts.metrics) {
    try {
      base.metrics = JSON.parse(opts.metrics);
    } catch {
      error("Invalid --metrics JSON");
      process.exit(1);
    }
  }
  return base;
}

async function runOperation(
  cmd: Command,
  method: TripleWhaleCommandMethod,
  opts: CommonOpts,
): Promise<void> {
  try {
    const client = getClient();
    const options = buildOptions(opts);
    let result: unknown;

    switch (method) {
      case "validateApiKey":
        result = await client.validateApiKey();
        break;
      case "getSummary":
        result = await client.getSummary(options);
        break;
      case "pushMetrics":
        result = await client.pushMetrics(options as { metrics: Array<Record<string, unknown>> });
        break;
      case "getMetricsData":
        result = await client.getMetricsData(options);
        break;
      case "exportAttributedOrders":
        result = await client.exportAttributedOrders(options);
        break;
      case "runSqlQuery":
        if (!options.query) {
          error("run-sql-query requires --query or query in --body");
          process.exit(1);
        }
        result = await client.runSqlQuery(options as { query: string });
        break;
      case "askMoby":
        if (!options.question) {
          error("ask-moby requires --question or question in --body");
          process.exit(1);
        }
        result = await client.askMoby(options as { question: string });
        break;
      case "createOrderRecord":
        result = await client.createOrderRecord(options);
        break;
      case "bulkCreateOrderRecords":
        result = await client.bulkCreateOrderRecords(options);
        break;
      case "createCustomerRecord":
        result = await client.createCustomerRecord(options);
        break;
      case "createProductRecord":
        result = await client.createProductRecord(options);
        break;
      case "createSubscriptionRecord":
        result = await client.createSubscriptionRecord(options);
        break;
      case "createPpsRecord":
        result = await client.createPpsRecord(options);
        break;
      case "createAdRecord":
        result = await client.createAdRecord(options);
        break;
      case "enrichOrder":
        result = await client.enrichOrder(options);
        break;
      case "enrichProduct":
        result = await client.enrichProduct(options);
        break;
      case "sendPixelOfflineEvent":
        result = await client.sendPixelOfflineEvent(options);
        break;
      case "sendLeadEvent":
        result = await client.sendLeadEvent(options);
        break;
      case "sendMqlEvent":
        result = await client.sendMqlEvent(options);
        break;
      case "sendSqlEvent":
        result = await client.sendSqlEvent(options);
        break;
      case "sendOpportunityEvent":
        result = await client.sendOpportunityEvent(options);
        break;
      case "sendBookDemoEvent":
        result = await client.sendBookDemoEvent(options);
        break;
      case "sendCustomEvent":
        result = await client.sendCustomEvent(options);
        break;
      case "createComplianceDeletionRequest":
        result = await client.createComplianceDeletionRequest(options);
        break;
      case "rawRequest":
      case "request": {
        const path = opts.path || (options.path as string | undefined);
        if (!path) {
          error("raw-request requires --path or path in --body");
          process.exit(1);
        }
        result = await client.rawRequest({
          path,
          method: (opts.method || (options.method as string) || "GET") as "GET" | "POST",
          body: options.body as Record<string, unknown> | undefined,
          query: options.query as Record<string, QueryValue> | undefined,
        });
        break;
      }
      default:
        error(`Unknown operation: ${method}`);
        process.exit(1);
    }

    print(result, getFormat(cmd));
  } catch (err) {
    error(String(err));
    process.exit(1);
  }
}

// Profile commands
const profileCmd = program.command("profile").description("Manage configuration profiles");

profileCmd.command("list").description("List all profiles").action(() => {
  const profiles = listProfiles();
  const current = getCurrentProfile();
  if (!profiles.length) {
    info('No profiles found. Use "profile create <name>" to create one.');
    return;
  }
  success("Profiles:");
  for (const p of profiles) {
    console.log(`  ${p}${p === current ? chalk.green(" (active)") : ""}`);
  }
});

profileCmd
  .command("use <name>")
  .description("Switch to a profile")
  .action((name: string) => {
    if (!profileExists(name)) {
      error(`Profile "${name}" does not exist`);
      process.exit(1);
    }
    setCurrentProfile(name);
    success(`Switched to profile: ${name}`);
  });

profileCmd
  .command("create <name>")
  .description("Create a new profile")
  .option("--key <key>", "API key")
  .option("--shop <shop>", "Default shop domain")
  .option("--base-url <url>", "API base URL")
  .option("--use", "Switch to this profile after creation")
  .action((name: string, opts: { key?: string; shop?: string; baseUrl?: string; use?: boolean }) => {
    if (profileExists(name)) {
      error(`Profile "${name}" already exists`);
      process.exit(1);
    }
    createProfile(name, {
      apiKey: opts.key,
      shopDomain: opts.shop,
      baseUrl: opts.baseUrl,
    });
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
    if (!deleteProfile(name)) {
      error(`Profile "${name}" not found`);
      process.exit(1);
    }
    success(`Profile "${name}" deleted`);
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
    info(`API Key: ${config.apiKey ? `${config.apiKey.slice(0, 8)}...` : chalk.gray("not set")}`);
    info(`Shop Domain: ${config.shopDomain || chalk.gray("not set")}`);
    info(`Base URL: ${config.baseUrl || chalk.gray("default (https://api.triplewhale.com)")}`);
  });

// Config commands
const configCmd = program.command("config").description("Manage CLI configuration");

configCmd
  .command("set-key <key>")
  .description("Set API key for active profile")
  .action((key: string) => {
    setApiKey(key);
    success(`API key saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("set-shop <domain>")
  .description("Set default shop domain for active profile")
  .action((domain: string) => {
    setShopDomain(domain);
    success(`Shop domain saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("set-base-url <url>")
  .description("Set API base URL for active profile")
  .action((url: string) => {
    setBaseUrl(url);
    success(`Base URL saved to profile: ${getCurrentProfile()}`);
  });

configCmd
  .command("show")
  .description("Show current configuration")
  .action(() => {
    console.log(chalk.bold(`Active Profile: ${getCurrentProfile()}`));
    info(`Config directory: ${getConfigDir()}`);
    info(`API Key: ${getApiKey() ? `${getApiKey()!.slice(0, 8)}...` : chalk.gray("not set")}`);
    info(`Shop Domain: ${getShopDomain() || chalk.gray("not set")}`);
    info(`Base URL: ${getBaseUrl() || chalk.gray("default (https://api.triplewhale.com)")}`);
  });

configCmd
  .command("clear")
  .description("Clear configuration for active profile")
  .action(() => {
    clearConfig();
    success(`Configuration cleared for profile: ${getCurrentProfile()}`);
  });

// Operation commands from COMMAND_SPECS
for (const [, cliName, description] of COMMAND_SPECS) {
  const method = COMMAND_SPECS.find((s) => s[1] === cliName)![0];
  const cmd = program.command(cliName).description(description);
  shopFields(cmd);
  periodFields(cmd);

  if (cliName === "push-metrics") {
    cmd.option("--metrics <json>", "Metrics array JSON");
  }
  if (cliName === "get-summary") {
    cmd.option("--today-hour <n>", "Today hour bucket (default 25)");
  }
  if (cliName === "export-attributed-orders") {
    cmd
      .option("--page <n>", "Page number")
      .option("--page-size <n>", "Page size")
      .option("--exclude-journey-data", "Exclude journey data");
  }
  if (cliName === "run-sql-query") {
    cmd.requiredOption("--query <sql>", "SQL query string").option("--currency <code>", "Currency code");
  }
  if (cliName === "ask-moby") {
    cmd.requiredOption("--question <text>", "Natural language question");
  }
  if (cliName === "raw-request" || cliName === "request") {
    cmd
      .requiredOption("--path <path>", "Relative API path (e.g. /users/api-keys/me)")
      .option("--method <method>", "HTTP method", "GET");
  }

  cmd.action(async (opts: CommonOpts) => {
    await runOperation(cmd, method, opts);
  });
}

program.parse();
