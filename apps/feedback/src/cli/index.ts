#!/usr/bin/env bun
import { Command } from "commander";
import { constants, existsSync, mkdirSync, statSync } from "node:fs";
import { access, rm, writeFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { dirname, join } from "node:path";
import { FeedbackClient } from "../client.js";
import { startFeedbackServer } from "../server/index.js";
import { createFeedbackStore, describeFeedbackStoreRuntime, resolveFeedbackFilePath } from "../storage.js";
import type {
  FeedbackContext,
  FeedbackInput,
  FeedbackKind,
  FeedbackListFilter,
  FeedbackStatus,
  FeedbackStore,
  JsonObject,
} from "../types.js";
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

function parseKeyValue(values: string[] | undefined): JsonObject | undefined {
  if (!values?.length) return undefined;
  return Object.fromEntries(values.map((value) => {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error(`Expected key=value, got: ${value}`);
    return [value.slice(0, index), value.slice(index + 1)];
  }));
}

function mergeJsonObjects(first: JsonObject | undefined, second: JsonObject | undefined): JsonObject | undefined {
  if (!first) return second;
  if (!second) return first;
  return { ...first, ...second };
}

function maybeClient(options: { apiUrl?: string; token?: string }): FeedbackClient | null {
  if (!options.apiUrl) return null;
  return new FeedbackClient({
    baseUrl: options.apiUrl,
    token: options.token ?? process.env["FEEDBACK_API_TOKEN"],
  });
}

function localStore(): FeedbackStore {
  return createFeedbackStore();
}

function commonFilter(options: { app?: string; status?: FeedbackStatus; tag?: string; search?: string; since?: string; until?: string; limit?: string }): FeedbackListFilter {
  return {
    appId: options.app,
    status: options.status,
    tag: options.tag,
    search: options.search,
    since: options.since,
    until: options.until,
    limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
  };
}

function buildContext(options: Record<string, string | string[] | undefined>): FeedbackContext | undefined {
  const extra = parseKeyValue(options.context as string[] | undefined) as FeedbackContext | undefined;
  const context: FeedbackContext = {
    ...extra,
    route: options.route as string | undefined ?? extra?.route,
    screen: options.screen as string | undefined ?? extra?.screen,
    version: options.appVersion as string | undefined ?? extra?.version,
    environment: options.env as string | undefined ?? extra?.environment,
  };
  return Object.values(context).some((value) => value !== undefined) ? context : undefined;
}

function findOnPath(command: string, pathValue = process.env["PATH"]): string | null {
  for (const dir of (pathValue ?? "").split(delimiter).filter(Boolean)) {
    const filePath = join(dir, command);
    if (!existsSync(filePath)) continue;
    try {
      statSync(filePath);
      return filePath;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

export interface FeedbackDoctorReport {
  ok: boolean;
  version: string;
  runtime: ReturnType<typeof describeFeedbackStoreRuntime>;
  dataFile?: string;
  dataDirWritable: boolean | null;
  dataFileReadable: boolean | null;
  apiTokenConfigured: boolean;
  bins: Record<"feedback" | "feedback-mcp" | "feedback-serve", string | null>;
}

export async function buildDoctorReport(env: Record<string, string | undefined> = process.env): Promise<FeedbackDoctorReport> {
  const runtime = describeFeedbackStoreRuntime({ env });
  const filePath = runtime.local?.dataFile ?? resolveFeedbackFilePath({ dataDir: env["FEEDBACK_DATA_DIR"] });
  let dataDirWritable: boolean | null = null;
  let dataFileReadable: boolean | null = null;

  if (runtime.mode === "local") {
    const dataDir = dirname(filePath);
    mkdirSync(dataDir, { recursive: true });
    const tmpPath = join(dataDir, `.feedback-doctor-${process.pid}.tmp`);
    try {
      await writeFile(tmpPath, "", "utf8");
      await rm(tmpPath, { force: true });
      dataDirWritable = true;
    } catch {
      dataDirWritable = false;
    }
    try {
      if (!existsSync(filePath)) {
        dataFileReadable = true;
      } else {
        await access(filePath, constants.R_OK);
        dataFileReadable = true;
      }
    } catch {
      dataFileReadable = false;
    }
  }

  const bins = {
    feedback: findOnPath("feedback", env["PATH"]),
    "feedback-mcp": findOnPath("feedback-mcp", env["PATH"]),
    "feedback-serve": findOnPath("feedback-serve", env["PATH"]),
  };
  const localStorageOk = runtime.mode !== "local" || (dataDirWritable === true && dataFileReadable === true);
  return {
    ok: runtime.ok && localStorageOk,
    version: VERSION,
    runtime,
    dataFile: runtime.mode === "local" ? filePath : undefined,
    dataDirWritable,
    dataFileReadable,
    apiTokenConfigured: Boolean(env["FEEDBACK_API_TOKEN"]),
    bins,
  };
}

async function runDoctor(): Promise<void> {
  printJson(await buildDoctorReport());
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
    .command("doctor")
    .description("Check local Open Feedback installation and storage")
    .action(async () => {
      await runDoctor();
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
    .option("--meta <key=value...>", "Metadata key/value; can be repeated")
    .option("--route <route>", "Current app route")
    .option("--screen <screen>", "Current app screen")
    .option("--app-version <version>", "App version or build id")
    .option("--env <environment>", "App environment")
    .option("--context <key=value...>", "Context key/value; can be repeated")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (message: string, options: Record<string, string | string[] | undefined>) => {
      const metadata = mergeJsonObjects(parseMetadata(options.metadata as string | undefined), parseKeyValue(options.meta as string[] | undefined));
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
        metadata,
        context: buildContext(options),
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
    .option("--search <text>", "Search message, metadata, context, and tags")
    .option("--since <date>", "Only entries created at or after this date")
    .option("--until <date>", "Only entries created at or before this date")
    .option("--limit <n>", "Limit results", "50")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; search?: string; since?: string; until?: string; limit?: string; apiUrl?: string; token?: string }) => {
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
    .option("--search <text>", "Search message, metadata, context, and tags")
    .option("--since <date>", "Only entries created at or after this date")
    .option("--until <date>", "Only entries created at or before this date")
    .option("--limit <n>", "Limit results", "500")
    .option("--format <format>", "json or jsonl", "jsonl")
    .option("--api-url <url>", "Remote Open Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; search?: string; since?: string; until?: string; limit?: string; format: string; apiUrl?: string; token?: string }) => {
      const filter = commonFilter({ ...options, status: options.status ? parseFeedbackStatus(options.status) : undefined });
      const client = maybeClient(options);
      if (options.format === "json") {
        printJson(client ? await client.list(filter) : await localStore().listFeedback(filter));
        return;
      }
      process.stdout.write(client ? await client.exportJsonl(filter) : await localStore().exportJsonl(filter));
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
