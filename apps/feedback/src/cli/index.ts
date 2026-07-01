#!/usr/bin/env bun
import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { FeedbackClient } from "../client.js";
import { startFeedbackServer } from "../server/index.js";
import { LocalFeedbackStore, resolveFeedbackFilePath } from "../storage.js";
import type { FeedbackInput, FeedbackKind, FeedbackListFilter, FeedbackStatus, JsonObject } from "../types.js";
import { parseFeedbackStatus } from "../validation.js";
import { VERSION } from "../version.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseTags(values: string[] | undefined): string[] {
  return values?.flatMap((value) => value.split(",")).map((tag) => tag.trim()).filter(Boolean) ?? [];
}

function parseMetadata(value: string | undefined): JsonObject | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--metadata must be a JSON object");
  return parsed as JsonObject;
}

function maybeClient(options: { apiUrl?: string; token?: string }): FeedbackClient | null {
  if (!options.apiUrl) return null;
  return new FeedbackClient({
    baseUrl: options.apiUrl,
    token: options.token ?? process.env["FEEDBACK_API_TOKEN"],
  });
}

function localStore(): LocalFeedbackStore {
  return new LocalFeedbackStore();
}

function commonFilter(options: { app?: string; status?: FeedbackStatus; tag?: string; limit?: string }): FeedbackListFilter {
  return {
    appId: options.app,
    status: options.status,
    tag: options.tag,
    limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
  };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("feedback")
    .description("Collect and inspect Open Feedback entries")
    .version(VERSION);

  program
    .command("init")
    .description("Create the local Open Feedback data directory")
    .action(() => {
      const filePath = resolveFeedbackFilePath();
      mkdirSync(dirname(filePath), { recursive: true });
      printJson({ dataFile: filePath });
    });

  program
    .command("serve")
    .description("Start the Open Feedback HTTP API")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "8787")
    .action((options: { host: string; port: string }) => {
      const server = startFeedbackServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
      });
      console.log(`Open Feedback API listening on http://${server.hostname}:${server.port}`);
    });

  program
    .command("submit")
    .description("Submit feedback locally or to an API")
    .argument("<message>", "Feedback message")
    .requiredOption("--app <appId>", "Application id")
    .option("--kind <kind>", "Feedback kind")
    .option("--severity <severity>", "Feedback severity")
    .option("--user <userId>", "User id")
    .option("--email <email>", "User email")
    .option("--url <url>", "Related URL")
    .option("--rating <rating>", "Rating from 1 to 5")
    .option("--tag <tag...>", "Tag; can be repeated or comma-separated")
    .option("--metadata <json>", "JSON object metadata")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (message: string, options: Record<string, string | string[] | undefined>) => {
      const input: FeedbackInput = {
        appId: String(options.app),
        message,
        kind: options.kind as FeedbackKind | undefined,
        severity: options.severity as FeedbackInput["severity"],
        userId: options.user as string | undefined,
        email: options.email as string | undefined,
        url: options.url as string | undefined,
        rating: options.rating ? Number.parseInt(String(options.rating), 10) : undefined,
        tags: parseTags(options.tag as string[] | undefined),
        metadata: parseMetadata(options.metadata as string | undefined),
      };
      const client = maybeClient({ apiUrl: options.apiUrl as string | undefined, token: options.token as string | undefined });
      printJson(client ? await client.submit(input) : await localStore().createFeedback(input, { source: "cli" }));
    });

  program
    .command("list")
    .description("List feedback")
    .option("--app <appId>", "Filter by app id")
    .option("--status <status>", "Filter by status")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit results", "50")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; limit?: string; apiUrl?: string; token?: string }) => {
      const filter = commonFilter({ ...options, status: options.status ? parseFeedbackStatus(options.status) : undefined });
      const client = maybeClient(options);
      printJson(client ? await client.list(filter) : await localStore().listFeedback(filter));
    });

  program
    .command("show")
    .description("Show one feedback item")
    .argument("<id>", "Feedback id")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (id: string, options: { apiUrl?: string; token?: string }) => {
      const client = maybeClient(options);
      const item = client ? await client.get(id) : await localStore().getFeedback(id);
      if (!item) {
        console.error(`Feedback not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("status")
    .description("Update feedback status")
    .argument("<id>", "Feedback id")
    .argument("<status>", "new, triaged, or closed")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (id: string, status: string, options: { apiUrl?: string; token?: string }) => {
      const parsedStatus = parseFeedbackStatus(status);
      const client = maybeClient(options);
      const item = client ? await client.updateStatus(id, parsedStatus) : await localStore().updateFeedbackStatus(id, parsedStatus);
      if (!item) {
        console.error(`Feedback not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("stats")
    .description("Show feedback stats")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { apiUrl?: string; token?: string }) => {
      const client = maybeClient(options);
      printJson(client ? await client.stats() : await localStore().stats());
    });

  program
    .command("export")
    .description("Export feedback")
    .option("--app <appId>", "Filter by app id")
    .option("--status <status>", "Filter by status")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Limit results", "500")
    .option("--format <format>", "json or jsonl", "jsonl")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; limit?: string; format: string }) => {
      const filter = commonFilter({ ...options, status: options.status ? parseFeedbackStatus(options.status) : undefined });
      if (options.format === "json") {
        printJson(await localStore().listFeedback(filter));
        return;
      }
      process.stdout.write(await localStore().exportJsonl(filter));
    });

  await program.parseAsync(argv);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/cli/index.ts") ||
  process.argv[1]?.endsWith("/cli/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

