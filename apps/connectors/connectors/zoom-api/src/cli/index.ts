#!/usr/bin/env bun
import { Command } from "commander";
import { ZoomApiClient } from "../api";
import type { HttpMethod, JsonObject, JsonValue, OutputFormat, QueryParams, QueryValue } from "../types";
import { clearConfig, getApiKey, getBaseUrl, getConfigPath, setApiKey, setBaseUrl } from "../utils/config";
import { error, print, success } from "../utils/output";

const VERSION = "0.0.1";
const DEFAULT_BASE_URL = "https://api.zoomapi.com/v1";

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
          return item as string | number | boolean | null | undefined;
        }
        throw new Error(`query.${key} must contain only string, number, boolean, null, or undefined values`);
      });
      continue;
    }
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null || entry === undefined) {
      query[key] = entry as QueryValue;
      continue;
    }
    query[key] = JSON.stringify(entry);
  }
  return query;
}

function parseMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  if (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return method;
  }
  throw new Error("method must be one of: GET, POST, PUT, PATCH, DELETE");
}

function getFormat(command: Command): OutputFormat {
  return (command.optsWithGlobals().format || "pretty") as OutputFormat;
}

function mask(value: string | undefined): string | null {
  return value ? `${value.slice(0, 8)}...` : null;
}

function getClient(command: Command): ZoomApiClient {
  const options = command.optsWithGlobals();
  return new ZoomApiClient({
    apiKey: options.apiKey || getApiKey(),
    baseUrl: options.baseUrl || getBaseUrl(),
  });
}

async function run(command: Command, action: (client: ZoomApiClient) => Promise<unknown> | unknown): Promise<void> {
  try {
    print(await action(getClient(command)), getFormat(command));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const program = new Command()
  .name("connect-zoom-api")
  .description("Zoom Api REST connector")
  .version(VERSION)
  .option("-k, --api-key <key>", "Zoom Api API key")
  .option("--base-url <url>", "Zoom Api base URL", DEFAULT_BASE_URL)
  .option("-f, --format <format>", "Output format: json or pretty", "pretty");

const config = program.command("config").description("Manage local configuration");
config.command("set-api-key <key>").description("Save Zoom Api API key").action((key: string) => {
  setApiKey(key);
  success("Zoom Api API key saved");
});
config.command("set-base-url <url>").description("Save API base URL").action((url: string) => {
  setBaseUrl(url);
  success("Zoom Api base URL saved");
});
config.command("show").description("Show current configuration").action(() => {
  print({ configPath: getConfigPath(), apiKey: mask(getApiKey()), baseUrl: getBaseUrl() || DEFAULT_BASE_URL });
});
config.command("clear").description("Clear local configuration").action(() => {
  clearConfig();
  success("Zoom Api configuration cleared");
});

const items = program.command("items").description("Item operations");
items.command("list").description("List items").option("-q, --query <json>", "Query params JSON object").action((opts, cmd) => run(cmd, (client) => client.listItems({ query: parseQueryParams(opts.query) })));
items.command("create").description("Create an item").requiredOption("-b, --body <json>", "Item JSON body").action((opts, cmd) => run(cmd, (client) => client.createItem(parseObject(opts.body, "body"))));
items.command("get <itemId>").description("Get an item by ID").action((itemId: string, opts, cmd) => run(cmd, (client) => client.getItem(itemId)));

const events = program.command("events").description("Event operations");
events.command("list").description("List events").option("-q, --query <json>", "Query params JSON object").action((opts, cmd) => run(cmd, (client) => client.listEvents({ query: parseQueryParams(opts.query) })));

program.command("search").description("Search resources").requiredOption("-b, --body <json>", "Search JSON body").action((opts, cmd) => run(cmd, (client) => client.search(parseObject(opts.body, "body"))));

program
  .command("request")
  .description("Call a guarded raw Zoom Api path")
  .requiredOption("-m, --method <method>", "HTTP method")
  .requiredOption("-p, --path <path>", "API path (e.g. /items or /items/id)")
  .option("-b, --body <json>", "JSON body")
  .option("-q, --query <json>", "Query params JSON object")
  .option("--no-auth", "Do not send Authorization header")
  .action((opts, cmd) =>
    run(cmd, (client) =>
      client.rawRequest(parseMethod(opts.method), opts.path, {
        body: opts.body ? parseJson(opts.body, "body") : undefined,
        query: parseQueryParams(opts.query),
        auth: opts.auth,
      }),
    ),
  );

program.parse();
