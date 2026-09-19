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
import { resolveClientTransport } from "@hasna/contracts/client";
import { shortlinksResolverInputs } from "../client-resolver-inputs.js";
import { LOCAL_OPT_IN_ENV_KEY, resolveStore, type Store } from "../client-store.js";
import { projectDestinationUrl, projectForOutput } from "./projection.js";
import type { TotalStats } from "../store-interface.js";
import { getConfigPath, getDataDir, getDatabasePath, loadConfig, normalizeHostname, saveConfig, updateConfig } from "../config.js";
import { serveShortlinks } from "../server.js";
import { createLocalSetupPlan, registerMachinesDns } from "../local.js";
import { DEFAULT_DOMAIN_HOSTNAME } from "../slug.js";
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
 * unless the local backend was explicitly opted into (HASNA_SHORTLINKS_LOCAL=1,
 * alias SHORTLINKS_LOCAL=1), which is announced on stderr. `--db <path>` only
 * names the file for such a run; on its own it is refused, never a second door
 * into local storage.
 * There is no DSN/postgres client path: a client never touches the raw RDS.
 */
async function withRuntimeStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const store = await resolveStore(process.env, { dbPath: program.opts().db });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

const DEFAULT_HUMAN_LIMIT = 20;
const DEFAULT_JSON_LIMIT = 20;
const TEXT_LIMIT = 88;

function parseLimit(value: string | number | undefined, fallback: number, label = "--limit"): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function humanLimit(opts: { limit?: string | number }): number {
  return parseLimit(opts.limit, DEFAULT_HUMAN_LIMIT);
}

function jsonLimit(opts: { limit?: string | number }): number {
  return parseLimit(opts.limit, DEFAULT_JSON_LIMIT);
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

function printDomainSummary(domain: Domain): void {
  console.log(`${domain.default_domain ? "*" : " "} ${domain.hostname} ${chalk.dim(domain.provider)} default=${yesNo(domain.default_domain)}`);
  if (domain.origin_url) console.log(`  origin: ${truncateText(domain.origin_url)}`);
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
  };
  console.log("shortlinks config");
  console.log(`  path: ${data.path}`);
  console.log(`  default domain: ${config.defaultDomain || "(unset)"}`);
  console.log(`  public base URL: ${config.publicBaseUrl || "(unset)"}`);
  printHint("Use `shortlinks config show --verbose` or `--json` for full config.");
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
  environment: Record<string, unknown>;
}): void {
  const presentEnv = Object.entries(data.environment).filter(([, present]) => present).map(([name]) => name);
  console.log(`${data.service} doctor`);
  console.log(`  store: ${data.store}`);
  console.log(`  db: ${data.db_exists ? "found" : "missing"} ${truncateText(data.db_path)}`);
  console.log(`  stats: domains=${data.stats.domains} links=${data.stats.links} clicks=${data.stats.clicks}`);
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
  .description("Shortlink manager with custom domains and click tracking — hosted /v1 API storage, or on-box SQLite with an explicit local opt-in")
  .version(getPackageVersion())
  .option("--db <path>", `SQLite database file for the on-box store; requires the local opt-in ${LOCAL_OPT_IN_ENV_KEY}=1`)
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
          const hostname = normalizeHostname(opts.domain);
          if (hostname !== DEFAULT_DOMAIN_HOSTNAME) {
            throw new Error(`Custom domains must be purchased through \`shortlinks domain setup <hostname>\`; init accepts only ${DEFAULT_DOMAIN_HOSTNAME}.`);
          }
          const domain = await store.addDomain({
            hostname,
            provider: "managed",
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
  .description("Set config value: default-domain or public-base-url")
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
  .command("list")
  .description("List configured domains")
  .option("--limit <n>", "Maximum rows")
  .option("-j, --json", "Output JSON")
  .action(async (opts) => {
    try {
      const allDomains = await withRuntimeStore((store) => store.listDomains());
      const outputDomains = allDomains.slice(0, useJson(opts) ? jsonLimit(opts) : humanLimit(opts));
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
  .description("Purchase and activate a custom domain through the hosted Domains API")
  .requiredOption("--max-price <usd>", "Maximum registration price in USD")
  .requiredOption("--auto-renew <bool>", "Explicit auto-renew choice: true or false")
  .option("--years <n>", "Registration years", "1")
  .option("--default", "Make this the default after Domains reports ready")
  .option("--idempotency-key <key>", "Stable purchase request key (defaults to shortlinks-domain:<hostname>)")
  .option("--wait", "Poll the Shortlinks API projection until active or failed")
  .option("--timeout <sec>", "Maximum wait time", "1200")
  .option("--dry-run", "Preview the Domains API request without buying")
  .option("--verbose", "Show the full domain object")
  .option("-j, --json", "Output JSON")
  .action(async (hostname, opts) => {
    try {
      const normalized = normalizeHostname(hostname);
      const maxPrice = Number(opts.maxPrice);
      const years = Number(opts.years);
      const timeoutSeconds = Number(opts.timeout);
      if (!Number.isFinite(maxPrice) || maxPrice <= 0) throw new Error("--max-price must be greater than 0");
      if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error("--years must be an integer from 1 to 10");
      if (opts.autoRenew !== "true" && opts.autoRenew !== "false") throw new Error("--auto-renew must be true or false");
      if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new Error("--timeout must be 1-3600 seconds");
      const idempotencyKey = opts.idempotencyKey || `shortlinks-domain:${normalized}`;
      const request = {
        hostname: normalized,
        max_price_usd: maxPrice,
        years,
        auto_renew: opts.autoRenew === "true",
        default: Boolean(opts.default),
        idempotency_key: idempotencyKey,
      };
      if (opts.dryRun) {
        const domainsRoot = (process.env.HASNA_DOMAINS_API_URL?.trim() || "https://api.hasna.com/domains")
          .replace(/\/v1\/?$/, "")
          .replace(/\/$/, "");
        print({ ok: true, dry_run: true, authority: `${domainsRoot}/v1`, request }, opts, () => {
          console.log(chalk.green(`Dry run: ${normalized}`));
          console.log(chalk.dim("No registrar, DNS, Cloudflare, or Shortlinks writes were made."));
        });
        return;
      }

      const result = await withRuntimeStore(async (store) => {
        let result = await store.provisionDomain({
          hostname: normalized,
          maxPriceUsd: maxPrice,
          years,
          autoRenew: opts.autoRenew === "true",
          defaultDomain: Boolean(opts.default),
          idempotencyKey,
        });
        let domain = result.domain;
        if (opts.wait) {
          const deadline = Date.now() + timeoutSeconds * 1000;
          while (Date.now() < deadline) {
            const status = (domain.metadata?.provisioning as Record<string, unknown> | undefined)?.status;
            if (status === "active" || status === "failed") break;
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            result = await store.reconcileDomain(normalized);
            domain = result.domain;
          }
        }
        return { domain, provisioning: domain.metadata?.provisioning };
      });
      print(result, opts, () => {
        if (printVerbose(result, opts)) return;
        const status = (result.provisioning as Record<string, unknown> | undefined)?.status;
        console.log(status === "active" ? chalk.green(`Domain active: ${result.domain.hostname}`) : chalk.yellow(`Domain ${status ?? "pending"}: ${result.domain.hostname}`));
        printHint("Domains purchasing, registrar, DNS, Cloudflare, and certificate readiness are owned by https://api.hasna.com/domains/v1.");
      });
      if ((result.provisioning as Record<string, unknown> | undefined)?.status === "failed") process.exitCode = 1;
    } catch (error) {
      handleError(error);
    }
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
  .option("--length <n>", "Minimum generated code length (3+)", "3")
  .option("-j, --json", "Output JSON")
  .action(createLinkAction);

program
  .command("create <url>")
  .description("Create a shortlink")
  .option("--domain <hostname>", "Domain to use")
  .option("--slug <slug>", "Custom slug")
  .option("--title <title>", "Human title")
  .option("--expires <date>", "Expiration date")
  .option("--length <n>", "Minimum generated code length (3+)", "3")
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
      // other command: the cloud ApiStore when a shortlinks credential
      // resolves, the on-box LocalStore only under the explicit environment
      // opt-in (HASNA_SHORTLINKS_LOCAL=1 / SHORTLINKS_LOCAL=1; --db only names
      // its file), otherwise the resolution fails closed. No DSN path here —
      // a client never opens the raw RDS.
      const store = await resolveStore(process.env, { dbPath: program.opts().db });
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
        // read of the API key. It must also see the SAME inputs the store was
        // resolved with: a declared-but-blank authority variable is normalised
        // away at the app seam before @hasna/contracts sees it
        // (client-resolver-inputs.ts), and the resolver itself refuses a
        // declared-but-blank variable loudly — a blank alongside a valid key
        // must not make `doctor` fail while every store-backed command works.
        // With the local backend selected there is no hosted transport to
        // report, so the sources are null rather than resolved and discarded.
        const { env: reportEnv, credentials: reportCredentials } = shortlinksResolverInputs(process.env);
        const hosted = store.kind === "http"
          ? resolveClientTransport("shortlinks", reportEnv, { credentials: reportCredentials })
          : null;
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
          environment: {
            // Hosted-API client is bearer-key only — never a DB DSN on the client.
            api_url_present: Boolean(hosted?.apiUrlSource),
            api_url_source: hosted?.apiUrlSource ?? null,
            api_key_present: hosted?.apiKeyPresent ?? false,
            api_key_source: hosted?.apiKeySource ?? null,
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
