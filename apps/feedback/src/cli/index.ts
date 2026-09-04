#!/usr/bin/env bun
import { Command } from "commander";
import { constants, existsSync, mkdirSync } from "node:fs";
import { access, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FeedbackClient } from "../client.js";
import { startFeedbackServer } from "../server/index.js";
import { SERVE_DESCRIPTION } from "../server/deprecation.js";
import { readStorageEnv } from "../storage.paths.js";
import { createFeedbackStore, describeFeedbackStoreRuntime, resolveFeedbackFilePath } from "../storage.js";
import { describeTaskSinkRuntime, findBinaryOnPath } from "../tasks.js";
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

export interface FeedbackApiTarget {
  apiUrl: string;
  token?: string;
}

/**
 * Resolve which hosted Hasna Feedback service a command talks to.
 *
 * `FEEDBACK_API_URL` exists so a fleet can be pointed at a hosted deployment
 * once, in the environment, instead of every agent and human remembering to
 * type `--api-url` on every invocation. Returns null when no hosted service is
 * configured — the caller then decides between an explicit on-box run
 * (`FEEDBACK_LOCAL=1`) and failing closed; nothing silently opens the local
 * store.
 */
export function resolveApiTarget(
  options: { apiUrl?: string; token?: string },
  env: Record<string, string | undefined> = process.env,
): FeedbackApiTarget | null {
  const apiUrl = options.apiUrl?.trim() || env["FEEDBACK_API_URL"]?.trim();
  if (!apiUrl) return null;
  const token = options.token?.trim() || env["FEEDBACK_API_TOKEN"]?.trim();
  return token ? { apiUrl, token } : { apiUrl };
}

export interface FeedbackRunTarget {
  /**
   * The hosted-service client when `--api-url` / `FEEDBACK_API_URL` configured
   * a remote target; null only when the run explicitly opted into the on-box
   * store.
   */
  client: FeedbackClient | null;
  /** True only when the run explicitly opted into the on-box store. */
  local: boolean;
}

/**
 * Whether the on-box store was EXPLICITLY selected for this run
 * (`HASNA_FEEDBACK_LOCAL=1` / `FEEDBACK_LOCAL=1`). Local storage is never the
 * default: with neither a hosted service configured nor this opt-in, command
 * verbs fail closed instead of silently writing to the machine-local store.
 */
export function localModeOptedIn(env: Record<string, string | undefined> = process.env): boolean {
  const value = readStorageEnv(env, "LOCAL")?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/**
 * Resolve what a command verb talks to, failing closed when the environment
 * names neither a hosted service nor an explicit on-box store.
 *
 * - `FEEDBACK_API_URL` (or `--api-url`, which always beats the environment)
 *   targets the hosted Hasna Feedback service; `client` is set.
 * - `FEEDBACK_LOCAL=1` is the ONLY way to select the on-box store.
 * - With neither, returns null — the verb must print
 *   {@link noConfiguredTargetError} and exit non-zero. "We run this in the
 *   cloud" must never silently degrade to a machine-local file that reads as
 *   green.
 */
export function resolveRunTarget(
  options: { apiUrl?: string; token?: string },
  env: Record<string, string | undefined> = process.env,
): FeedbackRunTarget | null {
  const api = resolveApiTarget(options, env);
  if (api) return { client: new FeedbackClient({ baseUrl: api.apiUrl, token: api.token }), local: false };
  if (localModeOptedIn(env)) return { client: null, local: true };
  return null;
}

/** The actionable error for an unconfigured run. */
export function noConfiguredTargetError(): string {
  return (
    "No Hasna Feedback service is configured. Set FEEDBACK_API_URL (and FEEDBACK_API_TOKEN when the " +
    "service requires one) so feedback reaches the hosted service, or set FEEDBACK_LOCAL=1 to " +
    "explicitly opt into the on-box store. Refusing to fall back to local storage."
  );
}

/**
 * Resolve the run target, or fail closed: prints {@link noConfiguredTargetError}
 * and marks exit 1 when nothing is configured, so the verb returns without
 * touching any store. Returns null in the fail-closed case.
 */
function requireTarget(
  options: { apiUrl?: string; token?: string },
  env: Record<string, string | undefined> = process.env,
): FeedbackRunTarget | null {
  const target = resolveRunTarget(options, env);
  if (target) return target;
  console.error(noConfiguredTargetError());
  process.exitCode = 1;
  return null;
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

export interface FeedbackDoctorReport {
  ok: boolean;
  version: string;
  runtime: ReturnType<typeof describeFeedbackStoreRuntime>;
  /** The wire that turns feedback into a task an executor can pick up. */
  taskSink: ReturnType<typeof describeTaskSinkRuntime>;
  /**
   * Which target the CLI will actually use with this environment. "none" is
   * the fail-closed state: no hosted service configured and no explicit
   * on-box opt-in, so no store is opened.
   */
  target: "local" | "remote" | "none";
  /**
   * Command-target blockers: non-empty only when `target` is "none", naming
   * what to configure so a gating health check can act on it.
   */
  blockers: string[];
  dataFile?: string;
  dataDirWritable: boolean | null;
  dataFileReadable: boolean | null;
  /** Configured remote service, if any. Never includes the token value. */
  apiUrl: string | null;
  apiTokenConfigured: boolean;
  bins: Record<"feedback" | "feedback-mcp" | "feedback-serve", string | null>;
}

export async function buildDoctorReport(env: Record<string, string | undefined> = process.env): Promise<FeedbackDoctorReport> {
  const runtime = describeFeedbackStoreRuntime({ env });
  const apiUrl = env["FEEDBACK_API_URL"]?.trim() || null;
  // Fail closed when the environment names neither a hosted service nor an
  // explicit on-box opt-in: doctor must not report a local store as the ready
  // target of a run that should reach the hosted service, and must not create
  // local storage while probing one.
  const target: "local" | "remote" | "none" = apiUrl ? "remote" : localModeOptedIn(env) ? "local" : "none";
  const blockers = target === "none" ? [noConfiguredTargetError()] : [];
  const filePath = runtime.local?.dataFile ?? resolveFeedbackFilePath({ dataDir: env["FEEDBACK_DATA_DIR"] });
  let dataDirWritable: boolean | null = null;
  let dataFileReadable: boolean | null = null;

  if (target === "local" && runtime.mode === "local") {
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
    feedback: findBinaryOnPath("feedback", env["PATH"]),
    "feedback-mcp": findBinaryOnPath("feedback-mcp", env["PATH"]),
    "feedback-serve": findBinaryOnPath("feedback-serve", env["PATH"]),
  };
  const taskSink = describeTaskSinkRuntime({ env });
  const localStorageOk =
    target !== "local" || runtime.mode !== "local" || (dataDirWritable === true && dataFileReadable === true);
  return {
    ok: target !== "none" && runtime.ok && localStorageOk && taskSink.ok,
    version: VERSION,
    runtime,
    taskSink,
    target,
    blockers,
    dataFile: target === "local" && runtime.mode === "local" ? filePath : undefined,
    dataDirWritable,
    dataFileReadable,
    apiUrl,
    apiTokenConfigured: Boolean(env["FEEDBACK_API_TOKEN"]),
    bins,
  };
}

async function runDoctor(): Promise<void> {
  const report = await buildDoctorReport();
  printJson(report);
  // A health check that always exits 0 cannot gate anything. Report the
  // verdict in the exit code as well as the payload.
  if (!report.ok) process.exitCode = 1;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("feedback")
    .description("Collect and inspect Hasna Feedback entries")
    .version(VERSION);

  program
    .command("init")
    .description("Create the local Hasna Feedback data directory")
    .action(() => {
      // Report the file the ACTIVE engine uses, not the JSONL log — with
      // SQLite as the default, printing feedback.jsonl here would send an
      // operator to inspect a file the store no longer reads.
      const runtime = describeFeedbackStoreRuntime();
      const filePath = runtime.local?.dataFile ?? resolveFeedbackFilePath();
      mkdirSync(dirname(filePath), { recursive: true });
      printJson({ dataFile: filePath, engine: runtime.engine ?? null });
    });

  program
    .command("doctor")
    .description("Check Hasna Feedback installation, storage, task sink, and remote target")
    // Doctor's only output format is JSON. `--json` is accepted so callers
    // following the fleet-wide convention do not get an "unknown option" error.
    .option("--json", "Output JSON (default, accepted for convention parity)")
    .action(async () => {
      await runDoctor();
    });

  program
    .command("serve")
    .description(SERVE_DESCRIPTION)
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--port <port>", "Port to bind", "8787")
    .action((options: { host: string; port: string }) => {
      const server = startFeedbackServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
      });
      console.log(`Hasna Feedback API listening on http://${server.hostname}:${server.port}`);
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
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
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
      const target = requireTarget({ apiUrl: options.apiUrl as string | undefined, token: options.token as string | undefined });
      if (!target) return;
      const client = target.client;
      const item = client ? await client.submit(input) : await localStore().createFeedback(input, { source: "cli" });
      printJson(item);
      // An open loop must be visible at the moment it opens, not discovered
      // later by whoever wonders why nothing happened.
      if (item.taskError) {
        console.error(
          `Warning: feedback stored, but no task was created: ${item.taskError}\n` +
            `Retry with: feedback sync-tasks`,
        );
        process.exitCode = 1;
      }
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
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; search?: string; since?: string; until?: string; limit?: string; apiUrl?: string; token?: string }) => {
      const filter = commonFilter({ ...options, status: options.status ? parseFeedbackStatus(options.status) : undefined });
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
      printJson(client ? await client.list(filter) : await localStore().listFeedback(filter));
    });

  program
    .command("show")
    .description("Show one feedback item")
    .argument("<id>", "Feedback id")
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (id: string, options: { apiUrl?: string; token?: string }) => {
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
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
    .argument("<status>", "new, triaged, shipped, or closed")
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (id: string, status: string, options: { apiUrl?: string; token?: string }) => {
      const parsedStatus = parseFeedbackStatus(status);
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
      const item = client ? await client.updateStatus(id, parsedStatus) : await localStore().updateFeedbackStatus(id, parsedStatus);
      if (!item) {
        console.error(`Feedback not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("shipped")
    .description("Mark feedback as shipped and link it to the changelog entry that shipped it")
    .argument("<id>", "Feedback id")
    .requiredOption("--changelog-ref <ref>", "Changelog entry id or URI (feedback → changelog linkage)")
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (id: string, options: { changelogRef: string; apiUrl?: string; token?: string }) => {
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
      if (client) {
        printJson(await client.markShipped(id, options.changelogRef));
        return;
      }
      const store = localStore();
      if (!store.markFeedbackShipped) {
        console.error("This store cannot record changelog linkage");
        process.exitCode = 1;
        return;
      }
      const item = await store.markFeedbackShipped(id, options.changelogRef);
      if (!item) {
        console.error(`Feedback not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(item);
    });

  program
    .command("sync-tasks")
    .description("Create tasks for feedback that has none yet (repair path for a task sink that was down or unconfigured)")
    .option("--limit <n>", "Maximum number of items to process")
    .option("--retry-uncertain", "Also retry items whose previous attempt recorded no outcome (may duplicate a task)")
    .action(async (options: { limit?: string; retryUncertain?: boolean }) => {
      // sync-tasks is an on-box repair path. It must neither run against the
      // hosted service nor open the local store implicitly — fail closed until
      // the on-box store is explicitly selected.
      const target = requireTarget({});
      if (!target) return;
      if (!target.local) {
        console.error(
          "sync-tasks operates on the on-box store, but FEEDBACK_API_URL points at a remote service. " +
            "Task linkage for a hosted deployment is created server-side. " +
            "Run with FEEDBACK_LOCAL=1 and without FEEDBACK_API_URL to repair an on-box store.",
        );
        process.exitCode = 1;
        return;
      }
      const store = localStore();
      if (!store.syncTasks) {
        console.error("This store does not support task syncing");
        process.exitCode = 1;
        return;
      }
      const result = await store.syncTasks({
        limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
        retryUncertain: options.retryUncertain,
      });
      printJson(result);
      if (!result.sinkConfigured) {
        console.error(
          "No task sink is configured, so no tasks were created. " +
            "Set FEEDBACK_TASK_SINK=todos (or install the todos CLI for auto-detection).",
        );
        process.exitCode = 1;
        return;
      }
      if (result.uncertain > 0) {
        console.error(
          `${result.uncertain} item(s) have an attempt with no recorded outcome and may already have a task. ` +
            "They were NOT re-filed. Check them, then re-run with --retry-uncertain to force.",
        );
      }
      if (result.failed > 0) process.exitCode = 1;
    });

  program
    .command("stats")
    .description("Show feedback stats")
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { apiUrl?: string; token?: string }) => {
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
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
    .option("--api-url <url>", "Remote Hasna Feedback API URL")
    .option("--token <token>", "API bearer token")
    .action(async (options: { app?: string; status?: FeedbackStatus; tag?: string; search?: string; since?: string; until?: string; limit?: string; format: string; apiUrl?: string; token?: string }) => {
      const filter = commonFilter({ ...options, status: options.status ? parseFeedbackStatus(options.status) : undefined });
      const target = requireTarget(options);
      if (!target) return;
      const client = target.client;
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
