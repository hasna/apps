#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { CloudflareWorkers } from "../api";
import type { HttpMethod, JsonObject, JsonValue, OutputFormat, QueryParams, QueryValue } from "../types";
import { clearConfig, getAccountId, getApiToken, getBaseUrl, loadConfig, setAccountId, setApiToken, setBaseUrl } from "../utils/config";
import { error, info, print, success } from "../utils/output";

const CONNECTOR_NAME = "connect-cloudflare-workers";
const VERSION = "0.0.1";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("Cloudflare Workers REST API CLI")
  .version(VERSION)
  .option("-f, --format <format>", "Output format (json, pretty)", "pretty")
  .option("--api-token <token>", "Cloudflare API token")
  .option("--account-id <id>", "Cloudflare account ID")
  .option("--base-url <url>", "Cloudflare API base URL");

function globalOptions(): Record<string, unknown> {
  return program.opts() as Record<string, unknown>;
}

function optionString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function getFormat(): OutputFormat {
  return (optionString(globalOptions(), "format") || "pretty") as OutputFormat;
}

function client(): CloudflareWorkers {
  const opts = globalOptions();
  return new CloudflareWorkers({
    apiToken: optionString(opts, "apiToken") || getApiToken(),
    accountId: optionString(opts, "accountId") || getAccountId(),
    baseUrl: optionString(opts, "baseUrl") || getBaseUrl(),
  });
}

function parseJsonValue(value: string | undefined, label: string, fallback: JsonValue | undefined): JsonValue | undefined {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as JsonValue;
  } catch (err) {
    throw new Error(`Invalid ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseJsonObject(value: string | undefined, label: string, fallback: JsonObject = {}): JsonObject {
  const parsed = parseJsonValue(value, label, fallback);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as JsonObject;
}

function optionalJsonObject(value: string | undefined, label: string): JsonObject | undefined {
  if (!value) return undefined;
  return parseJsonObject(value, label);
}

function toQueryValue(value: unknown, label: string): QueryValue | QueryValue[] {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as QueryValue;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
        throw new Error(`${label} array values must be string, number, boolean, or null`);
      }
    }
    return value as QueryValue[];
  }
  throw new Error(`${label} must be string, number, boolean, array, null, or undefined`);
}

function params(source: Record<string, unknown>): QueryParams {
  const parsed = parseJsonObject(optionString(source, "params"), "params", {});
  const output: QueryParams = {};
  for (const [key, value] of Object.entries(parsed)) output[key] = toQueryValue(value, `params.${key}`);
  return output;
}

function body(source: Record<string, unknown>): JsonObject {
  return parseJsonObject(optionString(source, "body"), "body");
}

function bodyValue(source: Record<string, unknown>): JsonValue {
  const parsed = parseJsonValue(optionString(source, "body"), "body", undefined);
  if (parsed === undefined) throw new Error("body is required");
  return parsed;
}

function scriptBody(source: Record<string, unknown>): string | Uint8Array {
  const file = optionString(source, "file");
  if (file) return readFileSync(file);
  const text = optionString(source, "text");
  if (text !== undefined) return text;
  throw new Error("upload-script requires --file or --text");
}

function method(value: unknown): HttpMethod {
  const input = typeof value === "string" ? value.toUpperCase() : "GET";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(input)) throw new Error("method must be one of GET, POST, PUT, PATCH, DELETE");
  return input as HttpMethod;
}

async function run(action: () => Promise<unknown>): Promise<void> {
  try {
    print(await action(), getFormat());
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const configCmd = program.command("config").description("Manage CLI configuration");

configCmd.command("set-token <apiToken>").description("Store a Cloudflare API token").action((apiToken: string) => {
  setApiToken(apiToken);
  success("API token saved");
});

configCmd.command("set-account <accountId>").description("Store a Cloudflare account ID").action((accountId: string) => {
  setAccountId(accountId);
  success("Account ID saved");
});

configCmd.command("set-base-url <baseUrl>").description("Store the Cloudflare API base URL").action((baseUrl: string) => {
  setBaseUrl(baseUrl);
  success(`Base URL set to ${baseUrl}`);
});

configCmd.command("show").description("Show current configuration").action(() => {
  const api = client();
  const stored = loadConfig();
  info(`API token: ${getApiToken() ? "configured" : "not set"}`);
  info(`Account ID: ${getAccountId() ? "configured" : "not set"}`);
  info(`Base URL: ${api.getBaseUrl()}`);
  if (Object.keys(stored).length > 0) info("Stored config file is present");
});

configCmd.command("clear").description("Clear saved configuration").action(() => {
  clearConfig();
  success("Configuration cleared");
});

program.command("list-scripts").description("List Workers scripts").option("--params <json>", "Query parameters JSON").action((opts: Record<string, unknown>) => run(() => client().listScripts(params(opts))));
program.command("get-script <scriptName>").description("Get Workers script metadata").action((scriptName: string) => run(() => client().getScript(scriptName)));
program.command("script-content <scriptName>").description("Get Workers script source text").action((scriptName: string) => run(() => client().getScriptContent(scriptName)));
program.command("upload-script <scriptName>").description("Upload a Workers script as multipart form data").option("--file <path>", "Read script body from file").option("--text <value>", "Use text as script body").option("--metadata <json>", "Worker metadata JSON").option("--filename <name>", "Script part filename").option("--content-type <type>", "Script Content-Type").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().uploadScript(scriptName, scriptBody(opts), {
  metadata: optionalJsonObject(optionString(opts, "metadata"), "metadata"),
  filename: optionString(opts, "filename"),
  contentType: optionString(opts, "contentType"),
})));
program.command("delete-script <scriptName>").description("Delete a Workers script").action((scriptName: string) => run(() => client().deleteScript(scriptName)));

program.command("get-settings <scriptName>").description("Get script settings").action((scriptName: string) => run(() => client().getScriptSettings(scriptName)));
program.command("update-settings <scriptName>").description("Patch script settings").requiredOption("--body <json>", "Settings JSON body").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().updateScriptSettings(scriptName, body(opts))));
program.command("list-deployments <scriptName>").description("List script deployments").action((scriptName: string) => run(() => client().listDeployments(scriptName)));
program.command("create-deployment <scriptName>").description("Create a script deployment").requiredOption("--body <json>", "Deployment JSON body").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().createDeployment(scriptName, body(opts))));
program.command("list-versions <scriptName>").description("List script versions").action((scriptName: string) => run(() => client().listVersions(scriptName)));
program.command("get-version <scriptName> <versionId>").description("Get a script version").action((scriptName: string, versionId: string) => run(() => client().getVersion(scriptName, versionId)));
program.command("list-secrets <scriptName>").description("List script secrets").action((scriptName: string) => run(() => client().listSecrets(scriptName)));
program.command("put-secret <scriptName>").description("Create or update a script secret").requiredOption("--body <json>", "Secret JSON body").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().putSecret(scriptName, body(opts))));
program.command("delete-secret <scriptName> <secretName>").description("Delete a script secret").action((scriptName: string, secretName: string) => run(() => client().deleteSecret(scriptName, secretName)));
program.command("get-schedules <scriptName>").description("Get script cron schedules").action((scriptName: string) => run(() => client().getSchedules(scriptName)));
program.command("put-schedules <scriptName>").description("Replace script cron schedules").requiredOption("--body <json>", "Schedules JSON body").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().putSchedules(scriptName, body(opts))));
program.command("create-tail <scriptName>").description("Create a Workers tail").action((scriptName: string) => run(() => client().createTail(scriptName)));
program.command("delete-tail <scriptName> <tailId>").description("Delete a Workers tail").action((scriptName: string, tailId: string) => run(() => client().deleteTail(scriptName, tailId)));

program.command("get-account-subdomain").description("Get the account Workers subdomain").action(() => run(() => client().getAccountSubdomain()));
program.command("update-account-subdomain").description("Update the account Workers subdomain").requiredOption("--body <json>", "Subdomain JSON body").action((opts: Record<string, unknown>) => run(() => client().updateAccountSubdomain(body(opts))));
program.command("get-script-subdomain <scriptName>").description("Get a script subdomain setting").action((scriptName: string) => run(() => client().getScriptSubdomain(scriptName)));
program.command("update-script-subdomain <scriptName>").description("Update a script subdomain setting").requiredOption("--body <json>", "Script subdomain JSON body").action((scriptName: string, opts: Record<string, unknown>) => run(() => client().updateScriptSubdomain(scriptName, body(opts))));

program.command("list-routes <zoneId>").description("List zone Workers routes").action((zoneId: string) => run(() => client().listRoutes(zoneId)));
program.command("get-route <zoneId> <routeId>").description("Get a zone Workers route").action((zoneId: string, routeId: string) => run(() => client().getRoute(zoneId, routeId)));
program.command("create-route <zoneId>").description("Create a zone Workers route").requiredOption("--body <json>", "Route JSON body").action((zoneId: string, opts: Record<string, unknown>) => run(() => client().createRoute(zoneId, body(opts))));
program.command("update-route <zoneId> <routeId>").description("Update a zone Workers route").requiredOption("--body <json>", "Route JSON body").action((zoneId: string, routeId: string, opts: Record<string, unknown>) => run(() => client().updateRoute(zoneId, routeId, body(opts))));
program.command("delete-route <zoneId> <routeId>").description("Delete a zone Workers route").action((zoneId: string, routeId: string) => run(() => client().deleteRoute(zoneId, routeId)));

program.command("get-account-settings").description("Get Workers account settings").action(() => run(() => client().getAccountSettings()));
program.command("update-account-settings").description("Patch Workers account settings").requiredOption("--body <json>", "Account settings JSON body").action((opts: Record<string, unknown>) => run(() => client().updateAccountSettings(body(opts))));

program.command("list-beta-workers").description("List beta Workers").option("--params <json>", "Query parameters JSON").action((opts: Record<string, unknown>) => run(() => client().listBetaWorkers(params(opts))));
program.command("create-beta-worker").description("Create a beta Worker").requiredOption("--body <json>", "Beta Worker JSON body").action((opts: Record<string, unknown>) => run(() => client().createBetaWorker(body(opts))));
program.command("get-beta-worker <workerId>").description("Get a beta Worker").action((workerId: string) => run(() => client().getBetaWorker(workerId)));
program.command("delete-beta-worker <workerId>").description("Delete a beta Worker").action((workerId: string) => run(() => client().deleteBetaWorker(workerId)));
program.command("list-beta-versions <workerId>").description("List beta Worker versions").action((workerId: string) => run(() => client().listBetaVersions(workerId)));
program.command("create-beta-version <workerId>").description("Create a beta Worker version").requiredOption("--body <json>", "Beta version JSON body").action((workerId: string, opts: Record<string, unknown>) => run(() => client().createBetaVersion(workerId, body(opts))));
program.command("get-beta-version <workerId> <versionId>").description("Get a beta Worker version").action((workerId: string, versionId: string) => run(() => client().getBetaVersion(workerId, versionId)));

program
  .command("raw <path>")
  .description("Run a constrained raw Cloudflare Workers API request")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("--params <json>", "Query parameters JSON")
  .option("--body <json>", "Request JSON body")
  .action((path: string, opts: Record<string, unknown>) => run(() => client().rawRequest(method(opts.method), path, {
    query: params(opts),
    body: optionString(opts, "body") ? bodyValue(opts) : undefined,
  })));

program.parse();
