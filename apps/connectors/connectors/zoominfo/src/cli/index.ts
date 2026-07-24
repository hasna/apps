#!/usr/bin/env bun
import { Command } from "commander";
import { ZoomInfo } from "../api";
import type { HttpMethod, JsonObject, JsonValue, OutputFormat, QueryPrimitive, QueryValue } from "../types";
import {
  clearConfig,
  getBaseUrl,
  getJwt,
  getPassword,
  getUsername,
  loadConfig,
  setBaseUrl,
  setJwt,
  setPassword,
  setUsername,
} from "../utils/config";
import { error, info, print, success } from "../utils/output";

const CONNECTOR_NAME = "connect-zoominfo";
const VERSION = "0.0.1";

const program = new Command();

program
  .name(CONNECTOR_NAME)
  .description("ZoomInfo B2B sales intelligence API CLI")
  .version(VERSION)
  .option("-f, --format <format>", "Output format (json, pretty)", "pretty")
  .option("--username <username>", "ZoomInfo API username")
  .option("--password <password>", "ZoomInfo API password")
  .option("--jwt <jwt>", "Preconfigured ZoomInfo JWT (skips /authenticate)")
  .option("--base-url <url>", "Override ZoomInfo API base URL");

function getFormat(): OutputFormat {
  return (program.opts().format || "pretty") as OutputFormat;
}

function getCliOptions(): Record<string, unknown> {
  return program.opts() as Record<string, unknown>;
}

function client(): ZoomInfo {
  const opts = getCliOptions();
  return new ZoomInfo({
    username: optionString(opts, "username") || getUsername(),
    password: optionString(opts, "password") || getPassword(),
    jwt: optionString(opts, "jwt") || getJwt(),
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as JsonObject;
}

function toQueryValue(value: unknown, label: string): QueryValue {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
        throw new Error(`Invalid ${label}: arrays must contain strings, numbers, or booleans`);
      }
    }
    return value as QueryPrimitive[];
  }
  throw new Error(`Invalid ${label}: expected string, number, boolean, array, null, or undefined`);
}

function parseParams(value: unknown): Record<string, QueryValue> {
  const parsed = parseJsonObject(typeof value === "string" ? value : undefined, "params");
  const params: Record<string, QueryValue> = {};
  for (const [key, rawValue] of Object.entries(parsed)) params[key] = toQueryValue(rawValue, `params.${key}`);
  return params;
}

function parseHeaders(value: unknown): Record<string, string> {
  const parsed = parseJsonObject(typeof value === "string" ? value : undefined, "headers");
  const headers: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== "string") throw new Error(`headers.${key} must be a string`);
    headers[key] = rawValue;
  }
  return headers;
}

function optionString(opts: Record<string, unknown>, key: string): string | undefined {
  const value = opts[key];
  return typeof value === "string" ? value : undefined;
}

function optionBody(opts: Record<string, unknown>, fallback: JsonValue = {}): JsonValue {
  return parseJsonValue(optionString(opts, "body"), "body", fallback) ?? fallback;
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

configCmd.command("set-username <username>").description("Store a ZoomInfo API username").action((username: string) => {
  setUsername(username);
  success("Username saved");
});

configCmd.command("set-password <password>").description("Store a ZoomInfo API password").action((password: string) => {
  setPassword(password);
  success("Password saved");
});

configCmd.command("set-jwt <jwt>").description("Store a preconfigured ZoomInfo JWT").action((jwt: string) => {
  setJwt(jwt);
  success("JWT saved");
});

configCmd.command("set-base-url <baseUrl>").description("Set a custom ZoomInfo API base URL").action((baseUrl: string) => {
  setBaseUrl(baseUrl);
  success(`Base URL set to ${baseUrl}`);
});

configCmd.command("show").description("Show current configuration").action(() => {
  const api = client();
  const config = loadConfig();
  info(`Username: ${getUsername() ? "configured" : "not set"}`);
  info(`Password: ${getPassword() ? "configured" : "not set"}`);
  info(`JWT: ${getJwt() ? "configured" : "not set"}`);
  info(`Base URL: ${api.getBaseUrl()}`);
  if (Object.keys(config).length > 0) info("Stored config file is present");
});

configCmd.command("clear").description("Clear saved configuration").action(() => {
  clearConfig();
  success("Configuration cleared");
});

program.command("authenticate").description("Authenticate with username/password and obtain a JWT").action(() => run(() => client().authenticate()));
program.command("search-contacts").description("Search ZoomInfo contacts").option("--body <json>", "JSON request body", "{}").option("--params <json>", "Query parameters as JSON object").action((opts: Record<string, unknown>) => run(() => client().searchContacts(optionBody(opts), parseParams(opts.params))));
program.command("search-companies").description("Search ZoomInfo companies").option("--body <json>", "JSON request body", "{}").option("--params <json>", "Query parameters as JSON object").action((opts: Record<string, unknown>) => run(() => client().searchCompanies(optionBody(opts), parseParams(opts.params))));
program.command("enrich-contact").description("Enrich contacts (requires matchPersonInput in body)").requiredOption("--body <json>", "JSON request body with matchPersonInput").action((opts: Record<string, unknown>) => run(() => client().enrichContact(optionBody(opts))));
program.command("enrich-company").description("Enrich companies").option("--body <json>", "JSON request body", "{}").action((opts: Record<string, unknown>) => run(() => client().enrichCompany(optionBody(opts))));
program.command("lookup-contact <contactId>").description("Look up a contact by ZoomInfo ID").action((contactId: string) => run(() => client().lookupContact(contactId)));
program.command("contact-search-output-fields").description("List available contact search output fields").action(() => run(() => client().listContactSearchOutputFields()));
program.command("company-search-output-fields").description("List available company search output fields").action(() => run(() => client().listCompanySearchOutputFields()));

program
  .command("raw-request <method> <path>")
  .description("Send a raw relative ZoomInfo request")
  .option("--params <json>", "Query parameters as JSON object")
  .option("--body <json>", "JSON request body")
  .option("--headers <json>", "Additional headers as JSON object")
  .option("--no-auth", "Do not attach Bearer JWT")
  .action((method: string, path: string, opts: Record<string, unknown>) =>
    run(() =>
      client().rawRequest(method.toUpperCase() as HttpMethod, path, {
        params: parseParams(opts.params),
        body: parseJsonValue(optionString(opts, "body"), "body", undefined),
        headers: parseHeaders(opts.headers),
        auth: opts.auth !== false,
      }),
    ),
  );

program.parse();
