#!/usr/bin/env bun
import { Command } from "commander";
import { ZymblyClient } from "../api";
import type { HttpMethod, JsonObject, JsonValue, OutputFormat, QueryParams, QueryValue } from "../types";
import {
  clearConfig,
  getApiKey,
  getBaseUrl,
  getConfigPath,
  setApiKey,
  setBaseUrl,
} from "../utils/config";
import { error, print, success } from "../utils/output";

const VERSION = "0.0.1";
const DEFAULT_BASE_URL = "https://api.zymbly.com/v1";

function parseJson(value: string | undefined, label: string): JsonValue {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid ${label}: ${message}`);
  }
}

function parseObject(value: string | undefined, label: string): JsonObject {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as JsonObject;
}

function parseQueryParams(value: string | undefined): QueryParams | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseObject(value, "query");
  const query: QueryParams = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (Array.isArray(entry)) {
      query[key] = entry.map((item) => {
        if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null || item === undefined) {
          return item as QueryValue;
        }
        throw new Error(`query.${key} must contain only string, number, boolean, null, or undefined values`);
      });
      continue;
    }
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null || entry === undefined) {
      query[key] = entry as QueryValue;
      continue;
    }
    throw new Error(`query.${key} must be a string, number, boolean, null, or an array of those values`);
  }
  return query;
}

function getFormat(command: Command): OutputFormat {
  return (command.optsWithGlobals().format || "pretty") as OutputFormat;
}

function getClient(command: Command): ZymblyClient {
  const options = command.optsWithGlobals();
  const apiKey = options.apiKey || getApiKey();
  const baseUrl = options.baseUrl || getBaseUrl();
  if (!apiKey) {
    error("No Zymbly API key configured. Use config set-key or set ZYMBLY_API_KEY.");
    process.exit(1);
  }
  return new ZymblyClient({ apiKey, baseUrl });
}

async function run(command: Command, action: (client: ZymblyClient) => Promise<unknown>): Promise<void> {
  try {
    print(await action(getClient(command)), getFormat(command));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command()
  .name("connect-zymbly")
  .description("Zymbly aircraft maintenance API connector")
  .version(VERSION)
  .option("-k, --api-key <key>", "Zymbly API key")
  .option("--base-url <url>", "API base URL", DEFAULT_BASE_URL)
  .option("-f, --format <format>", "Output format: json or pretty", "pretty");

const config = program.command("config").description("Manage local configuration");
config.command("set-key <key>").description("Save API key").action((key: string) => {
  setApiKey(key);
  success("Zymbly API key saved");
});
config.command("set-base-url <url>").description("Save API base URL").action((url: string) => {
  setBaseUrl(url);
  success("Zymbly base URL saved");
});
config.command("show").description("Show current configuration").action(() => {
  const key = getApiKey();
  print({
    configPath: getConfigPath(),
    baseUrl: getBaseUrl() || DEFAULT_BASE_URL,
    apiKey: key ? `${key.slice(0, 6)}...` : null,
  });
});
config.command("clear").description("Clear local configuration").action(() => {
  clearConfig();
  success("Zymbly configuration cleared");
});

const workOrders = program.command("work-orders").description("Manage work orders");
workOrders
  .command("list")
  .description("List work orders")
  .option("-q, --query <json>", "Query params JSON object")
  .action((opts, cmd) => run(cmd, (client) => client.listWorkOrders(parseQueryParams(opts.query))));
workOrders
  .command("get <workOrderId>")
  .description("Get a work order by ID")
  .action((workOrderId: string, _opts, cmd) => run(cmd, (client) => client.getWorkOrder(workOrderId)));

const parts = program.command("parts").description("Search aircraft parts");
parts
  .command("search")
  .description("Search parts catalog")
  .option("-q, --query <json>", "Query params JSON object")
  .action((opts, cmd) => run(cmd, (client) => client.searchParts(parseQueryParams(opts.query))));

const notes = program.command("notes").description("Maintenance notes");
notes
  .command("create <workOrderId>")
  .description("Create a maintenance note on a work order")
  .requiredOption("-n, --note <text>", "Note text")
  .action((workOrderId: string, opts, cmd) => run(cmd, (client) => client.createMaintenanceNote(workOrderId, opts.note)));

program
  .command("raw <method> <path>")
  .description("Call a raw Zymbly API path")
  .option("-b, --body <json>", "JSON body")
  .option("-q, --query <json>", "Query params JSON object")
  .action((method: string, path: string, opts, cmd) =>
    run(cmd, (client) =>
      client.rawRequest(method.toUpperCase() as HttpMethod, path, {
        body: opts.body ? parseJson(opts.body, "body") : undefined,
        query: parseQueryParams(opts.query),
      }),
    ),
  );

program.parse();
