#!/usr/bin/env bun
import {
  EventsClient,
  sanitizeChannelForOutput,
  sanitizeChannelsForOutput,
  type ChannelConfig,
  type EventFilter,
  type TransportKind,
} from "@hasna/events";
import { Command } from "commander";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveClientTransport } from "@hasna/contracts/client";
import { resolveStore, type Store } from "../client-store.js";
import { projectDestinationUrl, projectForOutput } from "./projection.js";
import type { TotalStats } from "../store-interface.js";
import { getConfigPath, getDataDir, getDatabasePath, loadConfig, saveConfig, updateConfig } from "../config.js";
import { serveShortlinks } from "../server.js";
import { createCloudflarePlan, writeWorkerFiles, upsertCloudflareDnsRecord } from "../cloudflare.js";
import { runDomains } from "../domains-cli.js";
import { createLocalSetupPlan, registerMachinesDns } from "../local.js";
import type { Domain, Link, LinkStats } from "../types.js";

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

function useJson(localOpts?: { json?: boolean }): boolean {
  return Boolean(localOpts?.json || program.opts().json);
}

function print(data: unknown, localOpts?: { json?: boolean }, human?: () => void): void {
  if (useJson(localOpts)) {
    console.log(JSON.stringify(projectForOutput(data), null, 2));
    return;
  }
  if (human) human();
}

function handleError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (useJson()) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(chalk.red(message));
  }
  process.exit(1);
}

/**
 * Run `fn` with the resolved client {@link Store}. The store is the hosted-API
 * ApiStore when the @hasna/contracts client resolver finds a shortlinks
 * credential — the Keychain item, ~/.hasna/shortlinks/config/credentials, or
 * HASNA_SHORTLINKS_API_KEY, with the authority defaulting to the fleet gateway
 * — otherwise the CLI FAILS CLOSED with an error naming the credential chain
 * unless local mode was explicitly opted into (HASNA_SHORTLINKS_LOCAL=1 /
 * SHORTLINKS_LOCAL=1 or --db <path>), which is announced on stderr.
 * There is no DSN/postgres client path: a client never touches the raw RDS.
 */
async function withRuntimeStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const store = resolveStore(process.env, { dbPath: program.opts().db });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf-8" });
  return result.status === 0;
}

const DEFAULT_HUMAN_LIMIT = 20;
const DEFAULT_JSON_LIMIT = 100;
const TEXT_LIMIT = 88;
const EXTERNAL_OUTPUT_LIMIT = 20;
const EXTERNAL_OUTPUT_WIDTH = 120;

function parseLimit(value: string | number | undefined, fallback: number, label = "--limit"): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function humanLimit(opts: { limit?: string | number }): number {
  return parseLimit(opts.limit, DEFAULT_HUMAN_LIMIT);
}

function jsonLimit(opts: { limit?: string | number }): number | undefined {
  return opts.limit === undefined ? undefined : parseLimit(opts.limit, DEFAULT_JSON_LIMIT);
}

function truncateText(value: string | null | undefined, max = TEXT_LIMIT): string {
  const text = value || "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function printHint(message: string): void {
  console.log(chalk.dim(message));
}

function printVerbose(data: unknown, opts: { verbose?: boolean }): boolean {
  if (!opts.verbose) return false;
  console.log(JSON.stringify(projectForOutput(data), null, 2));
  return true;
}

function formatLink(link: Link, maxDestinationLength = 72): string {
  return `${chalk.green(link.short_url || `${link.hostname}/${link.slug}`)} ${chalk.dim("->")} ${truncateText(projectDestinationUrl(link.destination_url), maxDestinationLength)}`;
}

function printBoundedTextOutput(text: string, stream: "stdout" | "stderr"): boolean {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  let truncated = lines.length > EXTERNAL_OUTPUT_LIMIT;
  for (const line of lines.slice(0, EXTERNAL_OUTPUT_LIMIT)) {
    const output = truncateText(line, EXTERNAL_OUTPUT_WIDTH);
    if (output !== line) truncated = true;
    if (stream === "stderr") console.error(output);
    else console.log(output);
  }
  return truncated;
}

function printExternalCommandResult(
  result: ReturnType<typeof runDomains>,
  opts: { verbose?: boolean },
  label: string,
): void {
  if (opts.verbose) {
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    return;
  }

  const stdoutTruncated = result.stdout.trim() ? printBoundedTextOutput(result.stdout, "stdout") : false;
  const stderrTruncated = result.stderr.trim() ? printBoundedTextOutput(result.stderr, "stderr") : false;
  if (stdoutTruncated || stderrTruncated) printHint(`Use --verbose or --json for full ${label} command output.`);
}

function printDomainSummary(domain: Domain): void {
  console.log(`${domain.default_domain ? "*" : " "} ${domain.hostname} ${chalk.dim(domain.provider)} default=${yesNo(domain.default_domain)}`);
  if (domain.origin_url) console.log(`  origin: ${truncateText(domain.origin_url)}`);
  if (domain.cloudflare_worker_name) console.log(`  worker: ${domain.cloudflare_worker_name}`);
  printHint("Use `shortlinks domain get <hostname> --verbose` or `--json` for full details.");
}

function printLinkSummary(link: Link): void {
  console.log(formatLink(link));
  console.log(`  slug: ${link.slug}`);
  console.log(`  domain: ${link.hostname}`);
  console.log(`  active: ${yesNo(link.active)}`);
  if (link.title) console.log(`  title: ${truncateText(link.title)}`);
  if (link.expires_at) console.log(`  expires: ${link.expires_at}`);
  printHint("Use `shortlinks link get <slug> --verbose` or `--json` for full details.");
}

function printStatsSummary(stats: LinkStats | { domains: number; links: number; clicks: number }): void {
  if ("link" in stats) {
    console.log(`${stats.link.short_url || `${stats.link.hostname}/${stats.link.slug}`} clicks=${stats.clicks}`);
    console.log(`  destination: ${truncateText(projectDestinationUrl(stats.link.destination_url))}`);
    console.log(`  last clicked: ${stats.last_clicked_at || "never"}`);
    const topReferrer = stats.top_referrers[0];
    const topAgent = stats.top_user_agents[0];
    if (topReferrer) console.log(`  top referrer: ${truncateText(topReferrer.referer || "(direct)", 72)} (${topReferrer.clicks})`);
    if (topAgent) console.log(`  top user agent: ${truncateText(topAgent.user_agent || "(unknown)", 72)} (${topAgent.clicks})`);
    printHint("Use `shortlinks stats <slug> --verbose` or `--json` for full stats.");
    return;
  }
  console.log(`domains=${stats.domains} links=${stats.links} clicks=${stats.clicks}`);
}

function printConfigSummary(data: { path: string; config: unknown }): void {
  const config = data.config as {
    defaultDomain?: string;
    publicBaseUrl?: string;
    cloudflare?: { accountId?: string; workerName?: string; origin?: string };
  };
  console.log("shortlinks config");
  console.log(`  path: ${data.path}`);
  console.log(`  default domain: ${config.defaultDomain || "(unset)"}`);
  console.log(`  public base URL: ${config.publicBaseUrl || "(unset)"}`);
  if (config.cloudflare) {
    console.log(`  cloudflare worker: ${config.cloudflare.workerName || "(unset)"}`);
    console.log(`  cloudflare origin: ${config.cloudflare.origin || "(unset)"}`);
  }
  printHint("Use `shortlinks config show --verbose` or `--json` for full config.");
}

function printCloudflarePlanSummary(plan: {
  hostname: string;
  target: string;
  proxied: boolean;
  workerName: string;
  origin: string;
  wranglerCommand: string;
}): void {
  console.log(`Cloudflare plan for ${plan.hostname}`);
  console.log(`  CNAME: ${plan.hostname} -> ${plan.target} proxied=${yesNo(plan.proxied)}`);
  console.log(`  worker: ${plan.workerName}`);
  console.log(`  origin: ${truncateText(plan.origin)}`);
  console.log(`  deploy: ${plan.wranglerCommand}`);
  printHint("Use `--verbose` or `--json` for the full DNS payload.");
}

function printCloudflareDnsSummary(result: unknown): void {
  if (result && typeof result === "object" && "dnsRecord" in result) {
    printCloudflarePlanSummary(result as unknown as Parameters<typeof printCloudflarePlanSummary>[0]);
    return;
  }
  const value = result as { id?: string; action?: string };
  console.log(`Cloudflare DNS ${value.action || "updated"} ${value.id || ""}`.trim());
  printHint("Use `--json` for the full API result.");
}

function printLocalPlanSummary(plan: {
  domain: string;
  targetHost: string;
  port: number;
  hostsEntry: string;
  caddySnippet: string;
  certPath: string;
  keyPath: string;
  machinesCommand: string;
}): void {
  console.log(`Local plan for ${plan.domain}`);
  console.log(`  target: ${plan.targetHost}:${plan.port}`);
  console.log(`  hosts: ${plan.hostsEntry}`);
  console.log(`  cert: ${truncateText(plan.certPath)}`);
  console.log(`  key: ${truncateText(plan.keyPath)}`);
  console.log(`  machines: ${plan.machinesCommand}`);
  printHint("Use `--verbose` or `--json` for the full Caddy snippet.");
}

function printDoctorSummary(data: {
  service: string;
  store: string;
  db_path: string;
  db_exists: boolean;
  stats: { domains: number; links: number; clicks: number };
  commands: Record<string, boolean>;
  environment: Record<string, unknown>;
}): void {
  const missingCommands = Object.entries(data.commands).filter(([, present]) => !present).map(([name]) => name);
  const presentEnv = Object.entries(data.environment).filter(([, present]) => present).map(([name]) => name);
  console.log(`${data.service} doctor`);
  console.log(`  store: ${data.store}`);
  console.log(`  db: ${data.db_exists ? "found" : "missing"} ${truncateText(data.db_path)}`);
  console.log(`  stats: domains=${data.stats.domains} links=${data.stats.links} clicks=${data.stats.clicks}`);
  console.log(`  commands: ${missingCommands.length ? `missing ${missingCommands.join(", ")}` : "ok"}`);
  console.log(`  env: ${presentEnv.length ? presentEnv.join(", ") : "no optional env vars detected"}`);
  printHint("Use `shortlinks doctor --verbose` or `--json` for paths and full readiness data.");
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, got ${value}`);
  return parsed;
}

function collectValues(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseJsonObject(value: string | undefined, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!value) return fallback;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseHeaders(values: string[] = []): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const index = value.indexOf("=");
    if (index <= 0) throw new Error(`Header must be name=value: ${value}`);
    headers[value.slice(0, index)] = value.slice(index + 1);
  }
  return headers;
}

function parseEventFilter(opts: {
  type?: string;
  source?: string;
  subject?: string;
  severity?: string;
}): EventFilter[] {
  const filter: EventFilter = {};
  if (opts.type) filter.type = opts.type;
  if (opts.source) filter.source = opts.source;
  if (opts.subject) filter.subject = opts.subject;
  if (opts.severity) filter.severity = opts.severity;
  return Object.keys(filter).length ? [filter] : [];
}

function createEventsClient(): EventsClient {
  return new EventsClient();
}

function formatEventRow(event: { time: string; id: string; source: string; type: string; severity: string; subject?: string }): string {
  return `${event.time}\t${event.id}\t${event.source}\t${event.type}\t${event.severity}${event.subject ? `\t${truncateText(event.subject, 48)}` : ""}`;
}

function formatChannelTarget(channel: ChannelConfig): string {
  return channel.webhook?.url ?? channel.command?.command ?? channel.transport;
}

function registerCompactEventsCommands(program: Command): void {
  const webhooks = program.command("webhooks").description("Manage Hasna event webhook subscriptions");

  webhooks
    .command("add")
    .description("Add or replace a webhook or command subscription")
    .argument("<target>", "Webhook URL or command binary")
    .requiredOption("--id <id>", "Subscription/channel identifier")
    .option("--transport <kind>", "Transport kind: webhook or command", "webhook")
    .option("--name <name>", "Display name")
    .option("--type <pattern>", "Event type filter, e.g. todos.task.*")
    .option("--source <pattern>", "Event source filter")
    .option("--subject <pattern>", "Event subject filter")
    .option("--severity <pattern>", "Event severity filter")
    .option("--secret <secret>", "Webhook HMAC secret")
    .option("--header <name=value...>", "Webhook header", collectValues, [])
    .option("--arg <arg...>", "Command argument", collectValues, [])
    .option("--timeout-ms <ms>", "Transport timeout in milliseconds", parseNumber)
    .option("--retry-attempts <n>", "Maximum delivery attempts", parseNumber)
    .option("--retry-backoff-ms <ms>", "Initial retry backoff in milliseconds", parseNumber)
    .option("--redact <path...>", "Event field path to redact before delivery", collectValues, [])
    .option("--disabled", "Create channel disabled", false)
    .option("-j, --json", "Output JSON")
    .action(async (target, opts) => {
      try {
        const transport = opts.transport as TransportKind;
        const channel: Omit<ChannelConfig, "createdAt" | "updatedAt"> = {
          id: opts.id,
          name: opts.name,
          enabled: !opts.disabled,
          transport,
          filters: parseEventFilter(opts),
          retry: opts.retryAttempts || opts.retryBackoffMs ? { maxAttempts: opts.retryAttempts, backoffMs: opts.retryBackoffMs } : undefined,
          redact: opts.redact?.length ? { paths: opts.redact } : undefined,
        };
        if (transport === "webhook") {
          channel.webhook = { url: target, secret: opts.secret, headers: parseHeaders(opts.header), timeoutMs: opts.timeoutMs };
        } else if (transport === "command") {
          channel.command = { command: target, args: opts.arg ?? [], timeoutMs: opts.timeoutMs };
        } else {
          throw new Error(`Transport ${transport} is reserved for future use and cannot be added yet.`);
        }
        const saved = sanitizeChannelForOutput(await createEventsClient().addChannel(channel));
        print(saved, opts, () => console.log(`Added ${saved.transport} channel ${saved.id}`));
      } catch (error) {
        handleError(error);
      }
    });

  webhooks
    .command("list")
    .description("List configured subscriptions")
    .option("--limit <n>", "Maximum rows")
    .option("-j, --json", "Output JSON")
    .action(async (opts) => {
      try {
        const channels = sanitizeChannelsForOutput(await createEventsClient().listChannels());
        const outputChannels = useJson(opts) && opts.limit === undefined ? channels : channels.slice(0, useJson(opts) ? parseLimit(opts.limit, channels.length) : humanLimit(opts));
        print(outputChannels, opts, () => {
          if (!channels.length) {
            console.log("No channels configured.");
            return;
          }
          for (const channel of outputChannels) {
            console.log(`${channel.id}\t${channel.enabled ? "enabled" : "disabled"}\t${channel.transport}\t${truncateText(formatChannelTarget(channel), 80)}`);
          }
          console.log(chalk.dim(`Showing ${outputChannels.length} of ${channels.length} channel(s).`));
          if (channels.length > outputChannels.length) printHint(`Use --limit ${channels.length} or --json for more.`);
        });
      } catch (error) {
        handleError(error);
      }
    });

  webhooks
    .command("remove")
    .description("Remove a subscription")
    .argument("<id>", "Subscription/channel identifier")
    .option("-j, --json", "Output JSON")
    .action(async (id, opts) => {
      try {
        const removed = await createEventsClient().removeChannel(id);
        print({ removed }, opts, () => console.log(removed ? `Removed ${id}` : `Channel not found: ${id}`));
      } catch (error) {
        handleError(error);
      }
    });

  webhooks
    .command("test")
    .description("Send a test event to one subscription")
    .argument("<id>", "Subscription/channel identifier")
    .option("--type <type>", "Event type", "events.test")
    .option("--subject <subject>", "Event subject")
    .option("--message <message>", "Event message", "Hasna events test delivery")
    .option("--data <json>", "Event data JSON object")
    .option("-j, --json", "Output JSON")
    .action(async (id, opts) => {
      try {
        const result = await createEventsClient().testChannel(id, {
          source: "shortlinks",
          type: opts.type,
          subject: opts.subject ?? id,
          message: opts.message,
          data: parseJsonObject(opts.data, { test: true }),
        });
        print(result, opts, () => console.log(`${result.status}: ${result.channelId}`));
      } catch (error) {
        handleError(error);
      }
    });

  const events = program.command("events").description("Emit, list, and replay Hasna events");

  events
    .command("emit")
    .description("Emit an event from this app")
    .argument("<type>", "Event type")
    .option("--source <source>", "Event source override")
    .option("--subject <subject>", "Event subject")
    .option("--severity <severity>", "Event severity", "info")
    .option("--message <message>", "Event message")
    .option("--dedupe-key <key>", "Dedupe key")
    .option("--data <json>", "Event data JSON object")
    .option("--metadata <json>", "Event metadata JSON object")
    .option("--no-deliver", "Record without delivering")
    .option("--no-dedupe", "Allow duplicate id/dedupeKey events")
    .option("-j, --json", "Output JSON")
    .action(async (type, opts) => {
      try {
        const result = await createEventsClient().emit({
          source: opts.source ?? "shortlinks",
          type,
          subject: opts.subject,
          severity: opts.severity,
          message: opts.message,
          dedupeKey: opts.dedupeKey,
          data: parseJsonObject(opts.data, {}),
          metadata: parseJsonObject(opts.metadata, {}),
        }, { deliver: opts.deliver, dedupe: opts.dedupe });
        print(result, opts, () => console.log(`${result.deduped ? "Deduped" : "Emitted"} ${result.event.id} to ${result.deliveries.length} channel(s)`));
      } catch (error) {
        handleError(error);
      }
    });

  events
    .command("list")
    .description("List recorded events")
    .option("--source <source>", "Filter by source")
    .option("--type <type>", "Filter by type")
    .option("--limit <n>", "Maximum rows")
    .option("-j, --json", "Output JSON")
    .action(async (opts) => {
      try {
        let rows = await createEventsClient().listEvents();
        if (opts.source) rows = rows.filter((event) => event.source === opts.source);
        if (opts.type) rows = rows.filter((event) => event.type === opts.type);
        const limit = useJson(opts) ? jsonLimit(opts) : humanLimit(opts);
        const outputRows = limit === undefined ? rows : rows.slice(-limit);
        print(outputRows, opts, () => {
          if (!rows.length) {
            console.log("No events recorded.");
            return;
          }
          for (const event of outputRows) console.log(formatEventRow(event));
          console.log(chalk.dim(`Showing ${outputRows.length} of ${rows.length} event(s).`));
          if (rows.length > outputRows.length) printHint(`Use --limit ${rows.length} or --json for more.`);
        });
      } catch (error) {
        handleError(error);
      }
    });

  events
    .command("replay")
    .description("Replay recorded events")
    .option("--id <id>", "Replay one event id")
    .option("--source <source>", "Filter by source")
    .option("--type <type>", "Filter by type")
    .option("--dry-run", "Preview without delivery", false)
    .option("-j, --json", "Output JSON")
    .action(async (opts) => {
      try {
        const result = await createEventsClient().replay({
          eventId: opts.id,
          source: opts.source,
          type: opts.type,
          dryRun: opts.dryRun,
        });
        print(result, opts, () => console.log(`Replayed ${result.events.length} event(s), ${result.deliveries.length} delivery result(s)`));
      } catch (error) {
        handleError(error);
      }
    });
}

program
  .name("shortlinks")
  .description("Shortlink manager with custom domains, click tracking, and Cloudflare helpers — hosted /v1 API storage, or on-box SQLite with an explicit local opt-in")
  .version(getPackageVersion())
  .option("--db <path>", "SQLite database path (local backend only)")
  .option("-j, --json", "Output JSON for agents and scripts");

program
  .command("init")
  .description("Initialize local shortlinks storage")
  .option("--domain <hostname>", "Add a default shortlink domain")
  .option("--public-base-url <url>", "Public URL base for generated links")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const result = await withRuntimeStore(async (store) => {
        const config = loadConfig();
        if (opts.publicBaseUrl) config.publicBaseUrl = opts.publicBaseUrl;
        if (opts.domain) {
          const domain = await store.addDomain({
            hostname: opts.domain,
            provider: "manual",
            defaultDomain: true,
          });
          config.defaultDomain = domain.hostname;
          config.publicBaseUrl = opts.publicBaseUrl || `https://${domain.hostname}`;
        }
        if (store.kind === "local") saveConfig(config);
        return {
          data_dir: getDataDir(),
          config_path: getConfigPath(),
          db_path: getDatabasePath(program.opts().db),
          store: store.kind,
          config,
          stats: await store.totalStats(),
        };
      });
      print(result, opts, () => {
        console.log(chalk.green("shortlinks initialized"));
        console.log(`  Data: ${result.data_dir}`);
        console.log(`  DB: ${result.db_path}`);
        if (result.config.defaultDomain) console.log(`  Default domain: ${result.config.defaultDomain}`);
      });
    } catch (error) {
      handleError(error);
    }
  });

const configCmd = program.command("config").description("View and update local config");

configCmd
  .command("show")
  .description("Show local config")
  .option("--verbose", "Show full config object")
  .option("-j, --json", "Output JSON")
  .action((opts) => {
    const data = { path: getConfigPath(), config: loadConfig() };
    print(data, opts, () => {
      if (printVerbose(data, opts)) return;
      printConfigSummary(data);
    });
  });

configCmd
  .command("set <key> <value>")
  .description("Set config value: default-domain, public-base-url, cloudflare-account-id, cloudflare-worker-name, cloudflare-origin")
  .option("-j, --json", "Output JSON")
  .action((key, value, opts) => {
    try {
      let config = loadConfig();
      switch (key) {
        case "default-domain":
          config = updateConfig({ defaultDomain: value, publicBaseUrl: config.publicBaseUrl || `https://${value}` });
          break;
        case "public-base-url":
          config = updateConfig({ publicBaseUrl: value });
          break;
        case "cloudflare-account-id":
          config = updateConfig({ cloudflare: { accountId: value } });
          break;
        case "cloudflare-worker-name":
          config = updateConfig({ cloudflare: { workerName: value } });
          break;
        case "cloudflare-origin":
          config = updateConfig({ cloudflare: { origin: value } });
          break;
        default:
          throw new Error(`Unknown config key: ${key}`);
      }
      print({ path: getConfigPath(), config }, opts, () => console.log(chalk.green(`Set ${key}.`)));
    } catch (error) {
      handleError(error);
    }
  });

const domainCmd = program.command("domain").alias("domains").description("Manage custom shortlink domains");

domainCmd
  .command("add <hostname>")
  .description("Add or update a custom domain")
  .option("--provider <provider>", "Provider label", "manual")
  .option("--default", "Make this the default domain")
  .option("--cloudflare-zone-id <id>", "Cloudflare zone ID")
  .option("--cloudflare-account-id <id>", "Cloudflare account ID")
  .option("--cloudflare-worker-name <name>", "Cloudflare Worker name")
  .option("--origin <url>", "Origin redirect server URL")
  .option("--notes <text>", "Notes")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.addDomain({
        hostname,
        provider: opts.provider,
        defaultDomain: opts.default,
        cloudflareZoneId: opts.cloudflareZoneId,
        cloudflareAccountId: opts.cloudflareAccountId,
        cloudflareWorkerName: opts.cloudflareWorkerName,
        originUrl: opts.origin,
        notes: opts.notes,
      }));
      print(domain, opts, () => {
        console.log(chalk.green(`Domain ready: ${domain.hostname}`));
        if (domain.default_domain) console.log(chalk.dim("Default domain updated."));
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("list")
  .description("List configured domains")
  .option("--limit <n>", "Maximum rows")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const allDomains = await withRuntimeStore((store) => store.listDomains());
      const outputDomains = useJson(opts) && opts.limit === undefined ? allDomains : allDomains.slice(0, useJson(opts) ? parseLimit(opts.limit, allDomains.length) : humanLimit(opts));
      print(outputDomains, opts, () => {
        const domains = outputDomains;
        if (domains.length === 0) {
          console.log(chalk.dim("No domains configured."));
          return;
        }
        for (const domain of domains) {
          const marker = domain.default_domain ? chalk.green("*") : " ";
          console.log(`${marker} ${domain.hostname} ${chalk.dim(domain.provider)}`);
        }
        console.log(chalk.dim(`Showing ${domains.length} of ${allDomains.length} domain(s).`));
        if (allDomains.length > domains.length) printHint(`Use --limit ${allDomains.length} or --json for more.`);
        printHint("Use `shortlinks domain get <hostname>` for details.");
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("get <hostname>")
  .alias("show")
  .description("Show a configured domain")
  .option("--verbose", "Show full domain object")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.getDomain(hostname));
      if (!domain) throw new Error("Domain not found.");
      print(domain, opts, () => {
        if (printVerbose(domain, opts)) return;
        printDomainSummary(domain);
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("remove <hostname>")
  .alias("delete")
  .alias("rm")
  .description("Delete a domain and all of its links and clicks")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const domain = await withRuntimeStore((store) => store.deleteDomain(hostname));
      print({ deleted: true, hostname: domain.hostname }, opts, () => {
        console.log(chalk.green(`Domain removed: ${domain.hostname}`));
        console.log(chalk.dim("Its links and clicks were deleted."));
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("setup <hostname>")
  .description("Add a domain locally and optionally prepare Cloudflare DNS")
  .option("--default", "Make this the default domain")
  .option("--origin <url>", "Origin redirect server URL")
  .option("--cloudflare", "Upsert Cloudflare CNAME record")
  .option("--target <hostname>", "CNAME target for Cloudflare DNS")
  .option("--zone-id <id>", "Cloudflare zone ID")
  .option("--dry-run", "Show the Cloudflare plan without changing DNS")
  .option("--verbose", "Show full setup result")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const result = await withRuntimeStore(async (store) => {
        const domain = await store.addDomain({
          hostname,
          provider: opts.cloudflare ? "cloudflare" : "manual",
          defaultDomain: opts.default,
          originUrl: opts.origin,
        });
        const cloudflare = opts.cloudflare
          ? await upsertCloudflareDnsRecord({
              hostname,
              target: opts.target || hostname,
              zoneId: opts.zoneId,
              dryRun: opts.dryRun,
            })
          : null;
        return { domain, cloudflare };
      });
      print(result, opts, () => {
        if (printVerbose(result, opts)) return;
        console.log(chalk.green(`Domain ready: ${result.domain.hostname}`));
        if (result.cloudflare) printCloudflareDnsSummary(result.cloudflare);
        if (!result.cloudflare) printHint("Use --cloudflare --dry-run to preview DNS changes.");
      });
    } catch (error) {
      handleError(error);
    }
  });

domainCmd
  .command("check <hostname>")
  .description("Check domain availability through @hasna/domains")
  .option("--dry-run", "Print the command without running it")
  .option("--verbose", "Show full domains CLI output")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    const result = runDomains("check", hostname, { dryRun: opts.dryRun });
    print(result, opts, () => {
      printExternalCommandResult(result, opts, "domains check");
      if (result.status !== 0) process.exit(result.status || 1);
    });
  });

domainCmd
  .command("buy <hostname>")
  .description("Buy a domain through @hasna/domains / Route 53")
  .option("--dry-run", "Print the command without running it")
  .option("--verbose", "Show full domains CLI output")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    const result = runDomains("buy", hostname, { dryRun: opts.dryRun });
    print(result, opts, () => {
      printExternalCommandResult(result, opts, "domains buy");
      if (result.status !== 0) process.exit(result.status || 1);
    });
  });

const linkCmd = program.command("link").alias("links").description("Manage shortlinks");

async function createLinkAction(url: string, opts: any): Promise<void> {
  try {
    const link = await withRuntimeStore((store) => store.createLink({
      destinationUrl: url,
      domain: opts.domain,
      slug: opts.slug,
      title: opts.title,
      expiresAt: opts.expires,
      slugLength: opts.length ? Number(opts.length) : undefined,
    }));
    print(link, opts, () => console.log(formatLink(link)));
  } catch (error) {
    handleError(error);
  }
}

linkCmd
  .command("create <url>")
  .description("Create a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--slug <slug>", "Custom slug")
  .option("--title <title>", "Human title")
  .option("--expires <date>", "Expiration date")
  .option("--length <n>", "Generated slug length", "7")
  .option("-j, --json", "Output JSON")
  .action(createLinkAction);

program
  .command("create <url>")
  .description("Create a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--slug <slug>", "Custom slug")
  .option("--title <title>", "Human title")
  .option("--expires <date>", "Expiration date")
  .option("--length <n>", "Generated slug length", "7")
  .option("-j, --json", "Output JSON")
  .action(createLinkAction);

linkCmd
  .command("list")
  .description("List shortlinks")
  .option("--domain <hostname>", "Filter by domain")
  .option("--active", "Only active links")
  .option("--limit <n>", "Maximum rows")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const requestedLimit = useJson(opts) ? jsonLimit(opts) : humanLimit(opts) + 1;
      const links = await withRuntimeStore((store) => store.listLinks({
        domain: opts.domain,
        activeOnly: opts.active,
        limit: requestedLimit,
      }));
      print(links, opts, () => {
        if (links.length === 0) {
          console.log(chalk.dim("No links yet."));
          return;
        }
        const limit = humanLimit(opts);
        const displayed = links.slice(0, limit);
        for (const link of displayed) {
          const status = link.active ? "active" : "disabled";
          console.log(`${formatLink(link)} ${chalk.dim(status)}`);
        }
        console.log(chalk.dim(`Showing ${displayed.length}${links.length > displayed.length ? "+" : ""} link(s).`));
        if (links.length > displayed.length) printHint(`Use --limit ${limit * 2} or --json to see more rows.`);
        printHint("Use `shortlinks link get <slug>` for details.");
      });
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("get <slug>")
  .alias("show")
  .description("Show a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--verbose", "Show full shortlink object")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.getLink(opts.domain, slug) : store.getLink(slug));
      if (!link) throw new Error("Link not found.");
      print(link, opts, () => {
        if (printVerbose(link, opts)) return;
        printLinkSummary(link);
      });
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("disable <slug>")
  .description("Disable a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.setLinkActive(opts.domain, slug, false) : store.setLinkActive(slug, false));
      print(link, opts, () => console.log(chalk.green(`Disabled ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("enable <slug>")
  .description("Enable a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.setLinkActive(opts.domain, slug, true) : store.setLinkActive(slug, true));
      print(link, opts, () => console.log(chalk.green(`Enabled ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

linkCmd
  .command("delete <slug>")
  .description("Delete a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.deleteLink(opts.domain, slug) : store.deleteLink(slug));
      print(link, opts, () => console.log(chalk.green(`Deleted ${link.short_url}`)));
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("resolve <slug>")
  .description("Resolve a slug to its destination without recording a click")
  .option("--domain <hostname>", "Domain to use")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const link = await withRuntimeStore((store) => opts.domain ? store.getLink(opts.domain, slug) : store.getLink(slug));
      if (!link) throw new Error("Link not found.");
      print(link, opts, () => console.log(projectDestinationUrl(link.destination_url)));
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("stats [slug]")
  .description("Show overall stats or stats for a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--verbose", "Show full stats object")
  .option("-j, --json", "Output JSON")
  .action(async (slug, opts) => {
    try {
      const result = await withRuntimeStore<LinkStats | TotalStats>((store) => {
        if (slug) return opts.domain ? store.getStats(opts.domain, slug) : store.getStats(slug);
        return store.totalStats();
      });
      print(result, opts, () => {
        if (printVerbose(result, opts)) return;
        printStatsSummary(result);
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("serve")
  .description("Run the on-box redirect server that records clicks (routes through the resolved Store)")
  .option("--host <host>", "Bind host", "127.0.0.1")
  .option("--port <port>", "Port", "8787")
  .option("--default-host <hostname>", "Fallback host if the request has no Host header")
  .action(async (opts) => {
    try {
      // The redirect server reads/records through the same Store seam as every
      // other command: the cloud ApiStore when the flip is on, the on-box
      // LocalStore only under an explicit opt-in (--db / SHORTLINKS_LOCAL=1),
      // otherwise the resolution fails closed. No DSN path here — a client
      // never opens the raw RDS.
      const store = resolveStore(process.env, { dbPath: program.opts().db });
      const server = serveShortlinks({
        store,
        host: opts.host,
        port: Number(opts.port),
        defaultHost: opts.defaultHost,
      });
      console.log(chalk.green(`shortlinks redirect server listening on http://${server.hostname}:${server.port} (${store.kind})`));
    } catch (error) {
      handleError(error);
    }
  });

const cfCmd = program.command("cloudflare").description("Cloudflare DNS and Worker helpers");

cfCmd
  .command("plan <hostname>")
  .description("Print the Cloudflare setup plan")
  .requiredOption("--target <hostname>", "CNAME target")
  .option("--origin <url>", "Origin redirect server URL", process.env.SHORTLINKS_ORIGIN || "https://shortlinks.example.com")
  .option("--worker <name>", "Worker name", "shortlinks")
  .option("--no-proxied", "Create unproxied DNS record")
  .option("--verbose", "Show full Cloudflare setup plan")
  .option("-j, --json", "Output JSON")
  .action((hostname, opts) => {
    try {
      const plan = createCloudflarePlan({
        hostname,
        target: opts.target,
        origin: opts.origin,
        workerName: opts.worker,
        proxied: opts.proxied,
      });
      print(plan, opts, () => {
        if (printVerbose(plan, opts)) return;
        printCloudflarePlanSummary(plan);
      });
    } catch (error) {
      handleError(error);
    }
  });

cfCmd
  .command("worker")
  .description("Write Cloudflare Worker files")
  .option("--out-dir <dir>", "Output directory", "cloudflare")
  .option("--worker <name>", "Worker name", "shortlinks")
  .option("--origin <url>", "Origin redirect server URL", process.env.SHORTLINKS_ORIGIN || "https://shortlinks.example.com")
  .option("-j, --json", "Output JSON")
  .action((opts) => {
    try {
      const result = writeWorkerFiles({ outDir: opts.outDir, workerName: opts.worker, origin: opts.origin });
      print(result, opts, () => {
        console.log(chalk.green(`Wrote ${result.workerPath}`));
        console.log(chalk.green(`Wrote ${result.wranglerPath}`));
      });
    } catch (error) {
      handleError(error);
    }
  });

cfCmd
  .command("dns <hostname>")
  .description("Create or update the Cloudflare CNAME record")
  .requiredOption("--target <hostname>", "CNAME target")
  .option("--zone-id <id>", "Cloudflare zone ID")
  .option("--dry-run", "Show plan without changing DNS")
  .option("--no-proxied", "Create unproxied DNS record")
  .option("--verbose", "Show full Cloudflare API result or dry-run plan")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const result = await upsertCloudflareDnsRecord({
        hostname,
        target: opts.target,
        zoneId: opts.zoneId,
        dryRun: opts.dryRun,
        proxied: opts.proxied,
      });
      print(result, opts, () => {
        if (printVerbose(result, opts)) return;
        printCloudflareDnsSummary(result);
      });
    } catch (error) {
      handleError(error);
    }
  });

const localCmd = program.command("local").description("Local domain setup helpers");

localCmd
  .command("plan <domain>")
  .description("Render hosts and reverse-proxy setup for a local shortlink domain")
  .option("--port <port>", "Local redirect server port", "8787")
  .option("--target-host <host>", "Local target host", "127.0.0.1")
  .option("--verbose", "Show full local setup plan")
  .option("-j, --json", "Output JSON")
  .action((domain, opts) => {
    try {
      const plan = createLocalSetupPlan({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      print(plan, opts, () => {
        if (printVerbose(plan, opts)) return;
        printLocalPlanSummary(plan);
      });
    } catch (error) {
      handleError(error);
    }
  });

localCmd
  .command("setup <domain>")
  .description("Record local domain mapping with machines and print remaining sudo-only setup")
  .option("--port <port>", "Local redirect server port", "8787")
  .option("--target-host <host>", "Local target host", "127.0.0.1")
  .option("--skip-machines", "Do not call machines dns add")
  .option("--verbose", "Show full local setup result")
  .option("-j, --json", "Output JSON")
  .action((domain, opts) => {
    try {
      const plan = createLocalSetupPlan({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      const machines = opts.skipMachines ? null : registerMachinesDns({
        domain,
        port: Number(opts.port),
        targetHost: opts.targetHost,
      });
      const result = { plan, machines };
      print(result, opts, () => {
        if (machines && machines.status !== 0) {
          console.error(chalk.yellow(machines.stderr.trim() || "machines dns add failed"));
        }
        if (printVerbose(result, opts)) return;
        printLocalPlanSummary(plan);
        if (machines) console.log(`  machines status: ${machines.status ?? "not started"}`);
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command("doctor")
  .description("Check local shortlinks tooling and integration readiness")
  .option("--verbose", "Show full diagnostic object")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const dbPath = getDatabasePath(program.opts().db);
      const data = await withRuntimeStore(async (store) => {
        // The hosted transport report comes from the contracts client seam —
        // the same resolver that built the store — never a hand-rolled env
        // read of the API key. In explicit local mode there is no hosted
        // transport to report, so the sources are null rather than resolved
        // and discarded.
        const hosted = store.kind === "http" ? resolveClientTransport("shortlinks", process.env) : null;
        return {
          service: "shortlinks",
          ok: true,
          // Which transport the client resolver selected: "local" or "http".
          store: store.kind,
          data_dir: getDataDir(),
          config_path: getConfigPath(),
          db_path: dbPath,
          db_exists: existsSync(dbPath),
          stats: await store.totalStats(),
          commands: {
            domains: commandExists("domains"),
            wrangler: commandExists("wrangler"),
            secrets: commandExists("secrets"),
          },
          environment: {
            // Hosted-API client is bearer-key only — never a DB DSN on the client.
            api_url_present: Boolean(hosted?.apiUrlSource),
            api_url_source: hosted?.apiUrlSource ?? null,
            api_key_present: hosted?.apiKeyPresent ?? false,
            api_key_source: hosted?.apiKeySource ?? null,
            cloudflare_api_token_present: Boolean(process.env.CLOUDFLARE_API_TOKEN),
            cloudflare_api_key_present: Boolean(process.env.CLOUDFLARE_API_KEY),
            cloudflare_email_present: Boolean(process.env.CLOUDFLARE_EMAIL),
            shortlinks_origin_present: Boolean(process.env.SHORTLINKS_ORIGIN),
          },
        };
      });
      print(data, opts, () => {
        if (printVerbose(data, opts)) return;
        printDoctorSummary(data);
      });
    } catch (error) {
      handleError(error);
    }
  });
registerCompactEventsCommands(program);

program.parseAsync(process.argv).catch(handleError);
