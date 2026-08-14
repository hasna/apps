#!/usr/bin/env bun
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";
import { registerStorageCommands } from "./storage.js";
import { registerLocalCommands } from "./local.js";
import {
  PROVIDER_NAMES,
  validateSearchProviderNames,
  type SearchProviderName,
  type ExportFormat,
} from "../types/index.js";
import { unifiedSearch, searchSingleProvider } from "../lib/search.js";
import { youtubeDeepSearch } from "../lib/youtube-deep.js";
import { exportResults } from "../lib/export.js";
import {
  getConfig,
  getConfigDiagnostics,
  getConfigDir,
  getConfigPath,
  setConfigValue,
  resetConfig,
  hasConfigKey,
} from "../lib/config.js";
import { listSearches, getSearch, deleteSearch, getSearchStats } from "../db/searches.js";
import { listResults } from "../db/results.js";
import {
  createSavedSearch,
  listSavedSearches,
  deleteSavedSearch,
  getSavedSearch,
  updateSavedSearchLastRun,
} from "../db/saved-searches.js";
import {
  listProviders,
  enableProvider,
  disableProvider,
  updateProvider,
  isProviderConfigured,
  getProviderConfigurationStatus,
} from "../db/providers.js";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  getProfileByName,
} from "../db/profiles.js";
import { getIndexDbPath } from "../db/index-db.js";
import { getDbPath } from "../db/database.js";
import {
  DEFAULT_COMPACT_LIMIT,
  clampLimit,
  truncateMiddle,
  truncateText,
} from "../lib/compact-output.js";
import { getExaConfigurationStatus } from "../lib/exa.js";
import {
  createWebset,
  createWebsetSearch,
  getWebset,
  listWebsetItems,
  listWebsets,
  waitForWebsetIdle,
  type CreateWebsetInput,
  type WebsetEntityInput,
  type WebsetMetadata,
  type WebsetSearchInput,
} from "../lib/websets.js";

const pkg = require("../../package.json") as { version: string };

const program = new Command();

function fail(message: string): void {
  console.error(chalk.red(message));
  process.exitCode = 1;
}

function parseProviderList(value: string | undefined): SearchProviderName[] | undefined {
  if (!value) return undefined;
  return validateSearchProviderNames(
    value
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
  );
}

function parseOptionalRateLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --rate-limit: ${value} (expected an integer >= 0)`);
  }
  return parsed;
}

function parsePositiveInteger(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value} (expected an integer >= 1)`);
  }
  return parsed;
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseMetadataOption(value: string | undefined, label: string): WebsetMetadata | undefined {
  if (value === undefined) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const metadata: WebsetMetadata = {};
  for (const [key, metadataValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof metadataValue !== "string") {
      throw new Error(`${label} values must be strings`);
    }
    if (metadataValue.length > 1000) {
      throw new Error(`${label}.${key} must be 1000 characters or less`);
    }
    metadata[key] = metadataValue;
  }
  return metadata;
}

function parseWebsetEntity(entity: string | undefined, description: string | undefined): WebsetEntityInput | undefined {
  if (!entity) {
    if (description) throw new Error("--entity-description requires --entity custom");
    return undefined;
  }
  if (entity === "custom") {
    if (!description || description.trim().length < 2) {
      throw new Error("--entity custom requires --entity-description with at least 2 characters");
    }
    return { type: "custom", description: description.trim() };
  }
  if (description) throw new Error("--entity-description is only valid with --entity custom");
  if (entity === "company" || entity === "person" || entity === "article" || entity === "research_paper") {
    return { type: entity };
  }
  throw new Error("--entity must be one of: company, person, article, research_paper, custom");
}

function parseConfigInput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

program
  .name("search")
  .version(pkg.version)
  .argument("[query...]", "Search query")
  .description("Unified search — local file index + 12 web providers, one interface");

registerStorageCommands(program);
registerEventsCommands(program, { source: "search" });

registerLocalCommands(program);

program
  .command("doctor")
  .description("Check local search configuration and storage paths")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const diagnostics = getConfigDiagnostics();
    const providers = listProviders().map((provider) => ({
      name: provider.name,
      enabled: provider.enabled,
      ...getProviderConfigurationStatus(provider),
    }));
    const report = {
      ok: diagnostics.valid,
      dataDir: getConfigDir(),
      configPath: getConfigPath(),
      config: diagnostics,
      dataDbPath: getDbPath(),
      indexDbPath: getIndexDbPath(),
      providers,
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(chalk.bold("Search Doctor"));
    console.log(`  Data dir:  ${report.dataDir}`);
    console.log(`  Config:    ${report.configPath}`);
    console.log(`  History DB: ${report.dataDbPath}`);
    console.log(`  Index DB:   ${report.indexDbPath}`);
    console.log(
      `  Config status: ${
        diagnostics.valid ? chalk.green("valid") : chalk.red(`invalid (${diagnostics.errors.join("; ")})`)
      }`,
    );
    console.log(`  Providers enabled: ${providers.filter((provider) => provider.enabled).length}/${providers.length}`);
    const missing = providers.filter((provider) => provider.enabled && !provider.configured);
    if (missing.length > 0) {
      console.log(chalk.yellow("  Missing provider configuration:"));
      for (const provider of missing) console.log(`    ${provider.name}: ${provider.reason}`);
    }
    if (!diagnostics.valid) process.exitCode = 1;
  });

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function parseCliLimit(value: string | undefined, label: string, fallback = DEFAULT_COMPACT_LIMIT): number {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    console.error(chalk.red(`Invalid ${label}: ${value} (expected a positive integer)`));
    process.exit(1);
  }
  return clampLimit(limit, fallback);
}

function parseCliOffset(value: string | undefined): number {
  if (value === undefined) return 0;
  const offset = Number(value);
  if (!Number.isInteger(offset) || offset < 0) {
    console.error(chalk.red(`Invalid --offset: ${value} (expected an integer >= 0)`));
    process.exit(1);
  }
  return offset;
}

function printPaginationHint(
  shown: number,
  total: number,
  offset: number,
  nextCommand: string,
  detailHint?: string,
): void {
  const nextOffset = offset + shown;
  const hints: string[] = [];
  if (nextOffset < total) hints.push(`more: ${nextCommand} --offset ${nextOffset}`);
  if (detailHint) hints.push(detailHint);
  if (hints.length > 0) console.log(chalk.dim(hints.join(" | ")));
}

// --- Main search command ---
program
  .command("query")
  .alias("q")
  .argument("<query...>", "Search query")
  .option("-p, --providers <providers>", "Comma-separated providers")
  .option("--profile <name>", "Use a search profile")
  .option("-l, --limit <n>", "Max results per provider", "10")
  .option("-f, --format <format>", "Output format: table, json", "table")
  .option("--smart", "Route the query to the best configured providers with the smart router")
  .option("--no-dedup", "Disable deduplication")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (queryParts: string[], opts) => {
    const query = queryParts.join(" ");

    try {
      const providers = parseProviderList(opts.providers);
      const response = await unifiedSearch(query, {
        providers,
        profile: opts.profile,
        options: { limit: parseInt(opts.limit) },
        dedup: opts.dedup,
        smart: opts.smart,
      });

      if (opts.format === "json") {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      printResults(response.results, response.search.duration, response.errors, { verbose: opts.verbose });
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// --- Provider-specific search commands ---
for (const providerName of PROVIDER_NAMES) {
  program
    .command(providerName)
    .argument("<query...>", "Search query")
    .option("-l, --limit <n>", "Max results", "10")
    .option("-f, --format <format>", "Output: table, json", "table")
    .option("--transcribe", "Transcribe top YouTube results (youtube only)")
    .option("--verbose", "Show every returned row with untruncated URLs/snippets")
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");

      try {
        if (providerName === "youtube" && opts.transcribe) {
          const deep = await youtubeDeepSearch(query, {
            limit: parseInt(opts.limit),
            transcribeTop: 3,
          });
          printResults(deep.videoResults, 0, [], { verbose: opts.verbose });
          if (deep.transcriptMatches.length > 0) {
            console.log(chalk.cyan("\n--- Transcript Matches ---"));
            for (const m of deep.transcriptMatches) {
              console.log(chalk.yellow(m.videoTitle));
              console.log(chalk.dim(m.snippet));
              console.log();
            }
          }
          return;
        }

        const response = await searchSingleProvider(
          providerName,
          query,
          { limit: parseInt(opts.limit) },
        );

        if (opts.format === "json") {
          console.log(JSON.stringify(response, null, 2));
          return;
        }

        printResults(response.results, response.search.duration, response.errors, { verbose: opts.verbose });
      } catch (err) {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }
    });
}

// --- History commands ---
const history = program.command("history").description("Search history");

history
  .command("list")
  .alias("ls")
  .option("-l, --limit <n>", "Max items", "20")
  .option("--offset <n>", "Start offset for pagination", "0")
  .option("-q, --query <query>", "Filter by query")
  .option("--json", "Output full records as JSON")
  .option("--verbose", "Show full query text")
  .action((opts) => {
    const limit = parseCliLimit(opts.limit, "--limit");
    const offset = parseCliOffset(opts.offset);
    const { searches, total } = listSearches({
      limit,
      offset,
      query: opts.query,
    });
    if (opts.json) {
      printJson({ total, limit, offset, searches });
      return;
    }
    console.log(chalk.bold(`Search History (showing ${searches.length} of ${total})`));
    console.log();
    for (const s of searches) {
      console.log(
        `${chalk.dim(s.id)}  ${chalk.white(opts.verbose ? s.query : truncateText(s.query, 88))}  ${chalk.cyan(s.providers.join(","))}  ${chalk.green(String(s.resultCount) + " results")}  ${chalk.dim(s.createdAt)}`,
      );
    }
    printPaginationHint(
      searches.length,
      total,
      offset,
      "search history list",
      "details: search history show <id> --verbose",
    );
  });

history
  .command("show <id>")
  .option("-l, --limit <n>", "Max result rows to show", "20")
  .option("--offset <n>", "Start offset for result pagination", "0")
  .option("--json", "Output details as JSON")
  .option("--verbose", "Show full result URLs/snippets")
  .action((id: string, opts) => {
    const search = getSearch(id);
    if (!search) {
      fail(`Search not found: ${id}`);
      return;
    }
    const limit = parseCliLimit(opts.limit, "--limit");
    const offset = parseCliOffset(opts.offset);
    const results = listResults(search.id, { limit, offset });
    if (opts.json) {
      printJson({ search, results, limit, offset });
      return;
    }
    console.log(chalk.bold(`Query: ${search.query}`));
    console.log(`Providers: ${search.providers.join(", ")}`);
    console.log(`Results: ${search.resultCount} | Showing: ${results.length} | Duration: ${search.duration}ms`);
    console.log();
    printResults(results, search.duration, [], { verbose: opts.verbose, total: search.resultCount, offset });
  });

history
  .command("delete <id>")
  .action((id: string) => {
    if (deleteSearch(id)) {
      console.log(chalk.green("Search deleted"));
    } else {
      fail(`Search not found: ${id}`);
    }
  });

// --- Saved searches ---
const saved = program.command("saved").description("Saved searches");

saved
  .command("list")
  .alias("ls")
  .option("-l, --limit <n>", "Max items", "20")
  .option("--offset <n>", "Start offset for pagination", "0")
  .option("--json", "Output full records as JSON")
  .option("--verbose", "Show full query text")
  .action((opts) => {
    const items = listSavedSearches();
    const limit = parseCliLimit(opts.limit, "--limit");
    const offset = parseCliOffset(opts.offset);
    const page = items.slice(offset, offset + limit);
    if (opts.json) {
      printJson({ total: items.length, limit, offset, savedSearches: page });
      return;
    }
    if (items.length === 0) {
      console.log(chalk.dim("No saved searches"));
      return;
    }
    console.log(chalk.bold(`Saved Searches (showing ${page.length} of ${items.length})`));
    console.log();
    for (const s of page) {
      console.log(
        `${chalk.dim(s.id)}  ${chalk.yellow(truncateText(s.name, 40))}  ${chalk.white(opts.verbose ? s.query : truncateText(s.query, 88))}  ${chalk.cyan(s.providers.join(",") || "all")}  ${chalk.dim(s.lastRunAt ?? "never run")}`,
      );
    }
    printPaginationHint(
      page.length,
      items.length,
      offset,
      "search saved list",
      "details: search saved run <id> --verbose",
    );
  });

saved
  .command("add <name> <query...>")
  .option("-p, --providers <providers>", "Comma-separated providers")
  .option("--profile <name>", "Search profile")
  .action((name: string, queryParts: string[], opts) => {
    const query = queryParts.join(" ");
    try {
      const providers = parseProviderList(opts.providers) ?? [];
      const s = createSavedSearch({ name, query, providers, profileId: opts.profile });
      console.log(chalk.green(`Saved search created: ${s.id}`));
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

saved
  .command("run <id>")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (id: string, opts) => {
    const s = getSavedSearch(id);
    if (!s) {
      fail(`Saved search not found: ${id}`);
      return;
    }
    updateSavedSearchLastRun(id);
    const response = await unifiedSearch(s.query, {
      providers: s.providers.length > 0 ? s.providers : undefined,
      options: s.options,
    });
    printResults(response.results, response.search.duration, response.errors, { verbose: opts.verbose });
  });

saved
  .command("delete <id>")
  .action((id: string) => {
    if (deleteSavedSearch(id)) {
      console.log(chalk.green("Saved search deleted"));
    } else {
      fail(`Not found: ${id}`);
    }
  });

// --- Providers ---
const providers = program.command("providers").description("Manage search providers");

providers
  .command("list")
  .alias("ls")
  .option("--json", "Output full records as JSON")
  .action((opts) => {
    const all = listProviders();
    if (opts.json) {
      printJson(all.map((p) => ({ ...p, configuration: getProviderConfigurationStatus(p) })));
      return;
    }
    console.log(chalk.bold("Search Providers"));
    console.log();
    for (const p of all) {
      const configured = isProviderConfigured(p);
      const configuration = getProviderConfigurationStatus(p);
      const status = p.enabled
        ? configured
          ? chalk.green("enabled")
          : chalk.yellow(`enabled (${configuration.reason})`)
        : chalk.dim("disabled");
      const keyInfo = p.apiKeyEnv ? chalk.dim(` [env:${p.apiKeyEnv}]`) : chalk.dim(" [no key needed]");
      console.log(`  ${chalk.white(p.name.padEnd(14))} ${status}${keyInfo}  rate: ${p.rateLimit}/min`);
    }
  });

// --- Exa Websets ---
const websets = program.command("websets").description("Manage Exa Websets");

websets
  .command("status")
  .description("Show Exa Websets configuration status")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    const status = getExaConfigurationStatus();
    if (opts.json) {
      console.log(JSON.stringify({ websets: status }, null, 2));
      return;
    }
    const icon = status.configured ? chalk.green("enabled") : chalk.yellow("missing");
    console.log(chalk.bold("Exa Websets"));
    console.log(`  Status: ${icon}`);
    console.log(`  Auth:   ${status.message}`);
  });

websets
  .command("list")
  .description("List Exa Websets")
  .option("--limit <n>", "Number of Websets to return", "25")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--search <term>", "Filter by ID, external ID, or title")
  .option("--json", "Output as JSON")
  .action(async (opts: { limit?: string; cursor?: string; search?: string; json?: boolean }) => {
    try {
      const result = await listWebsets({
        limit: parsePositiveInteger(opts.limit, "--limit", 25),
        cursor: opts.cursor,
        search: opts.search,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.bold(`${result.data.length} Webset(s)`));
      for (const webset of result.data) {
        console.log(
          `${chalk.cyan(webset.id)}  ${chalk.white(webset.status)}  ${chalk.dim(webset.title ?? "(untitled)")}`,
        );
      }
      if (result.nextCursor) console.log(chalk.dim(`next cursor: ${result.nextCursor}`));
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

websets
  .command("get <id>")
  .description("Get an Exa Webset by id or externalId")
  .option("--expand-items", "Include items in the response")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { expandItems?: boolean; json?: boolean }) => {
    try {
      const result = await getWebset(id, { expand: opts.expandItems ? ["items"] : undefined });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.bold(result.title ?? result.id));
      console.log(`  ID:     ${chalk.cyan(result.id)}`);
      console.log(`  Status: ${chalk.white(result.status)}`);
      if (result.dashboardUrl) console.log(`  URL:    ${chalk.dim(result.dashboardUrl)}`);
      console.log(`  Searches: ${result.searches.length}`);
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

websets
  .command("items <id>")
  .description("List items for an Exa Webset")
  .option("--limit <n>", "Number of items to return", "20")
  .option("--cursor <cursor>", "Pagination cursor")
  .option("--source-id <id>", "Filter by source id")
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { limit?: string; cursor?: string; sourceId?: string; json?: boolean }) => {
    try {
      const result = await listWebsetItems(id, {
        limit: parsePositiveInteger(opts.limit, "--limit", 20),
        cursor: opts.cursor,
        sourceId: opts.sourceId,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.bold(`${result.data.length} item(s)`));
      for (const item of result.data) {
        const name = typeof item.properties.name === "string" ? item.properties.name : item.properties.url;
        console.log(`${chalk.cyan(item.id)}  ${chalk.dim(String(name ?? ""))}`);
      }
      if (result.nextCursor) console.log(chalk.dim(`next cursor: ${result.nextCursor}`));
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

websets
  .command("create <query...>")
  .description("Create an Exa Webset with an initial search")
  .option("--title <title>", "Webset title")
  .option("--count <n>", "Number of items to attempt to find", "10")
  .option("--entity <type>", "Entity type: company, person, article, research_paper, or custom")
  .option("--entity-description <text>", "Required when --entity custom")
  .option("--criteria <text>", "Verification criterion; repeat for multiple criteria", collectOption, [])
  .option("--enrichment <description>", "Enrichment to extract; repeat for multiple enrichments", collectOption, [])
  .option("--external-id <id>", "External identifier")
  .option("--metadata <json>", "Metadata JSON object")
  .option("--wait", "Poll until the Webset status is idle")
  .option("--timeout-ms <n>", "Wait timeout in milliseconds", "60000")
  .option("--poll-interval-ms <n>", "Wait polling interval in milliseconds", "2000")
  .option("--json", "Output as JSON")
  .action(async (queryParts: string[], opts: {
    title?: string;
    count?: string;
    entity?: string;
    entityDescription?: string;
    criteria?: string[];
    enrichment?: string[];
    externalId?: string;
    metadata?: string;
    wait?: boolean;
    timeoutMs?: string;
    pollIntervalMs?: string;
    json?: boolean;
  }) => {
    try {
      const search: WebsetSearchInput = {
        query: queryParts.join(" "),
        count: parsePositiveInteger(opts.count, "--count", 10),
        ...(parseWebsetEntity(opts.entity, opts.entityDescription)
          ? { entity: parseWebsetEntity(opts.entity, opts.entityDescription) }
          : {}),
        ...(opts.criteria && opts.criteria.length > 0
          ? { criteria: opts.criteria.map((description) => ({ description })) }
          : {}),
      };
      const input: CreateWebsetInput = {
        ...(opts.title ? { title: opts.title } : {}),
        search,
        ...(opts.enrichment && opts.enrichment.length > 0
          ? { enrichments: opts.enrichment.map((description) => ({ description, format: "text" })) }
          : {}),
        ...(opts.externalId ? { externalId: opts.externalId } : {}),
        ...(opts.metadata ? { metadata: parseMetadataOption(opts.metadata, "--metadata") } : {}),
      };

      const created = await createWebset(input);
      const result = opts.wait
        ? await waitForWebsetIdle(created.id, {
            timeoutMs: parsePositiveInteger(opts.timeoutMs, "--timeout-ms", 60_000),
            pollIntervalMs: parsePositiveInteger(opts.pollIntervalMs, "--poll-interval-ms", 2_000),
          })
        : created;

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green("Webset created"));
      console.log(`  ID:     ${chalk.cyan(result.id)}`);
      console.log(`  Status: ${chalk.white(result.status)}`);
      if (result.dashboardUrl) console.log(`  URL:    ${chalk.dim(result.dashboardUrl)}`);
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

websets
  .command("search <id> <query...>")
  .description("Create an additional search for an Exa Webset")
  .option("--count <n>", "Number of items to attempt to find", "10")
  .option("--entity <type>", "Entity type")
  .option("--entity-description <text>", "Required when --entity custom")
  .option("--criteria <text>", "Verification criterion; repeat for multiple criteria", collectOption, [])
  .option("--behavior <mode>", "Search behavior: override or append", "override")
  .option("--json", "Output as JSON")
  .action(async (id: string, queryParts: string[], opts: {
    count?: string;
    entity?: string;
    entityDescription?: string;
    criteria?: string[];
    behavior?: "override" | "append";
    json?: boolean;
  }) => {
    try {
      if (opts.behavior !== "override" && opts.behavior !== "append") {
        throw new Error("--behavior must be override or append");
      }
      const result = await createWebsetSearch(id, {
        query: queryParts.join(" "),
        count: parsePositiveInteger(opts.count, "--count", 10),
        behavior: opts.behavior,
        ...(parseWebsetEntity(opts.entity, opts.entityDescription)
          ? { entity: parseWebsetEntity(opts.entity, opts.entityDescription) }
          : {}),
        ...(opts.criteria && opts.criteria.length > 0
          ? { criteria: opts.criteria.map((description) => ({ description })) }
          : {}),
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green("Webset search created"));
      console.log(`  ID:     ${chalk.cyan(result.id)}`);
      console.log(`  Webset: ${chalk.cyan(result.websetId)}`);
      if (typeof result.status === "string") console.log(`  Status: ${chalk.white(result.status)}`);
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

providers
  .command("enable <name>")
  .action((name: string) => {
    if (enableProvider(name)) {
      console.log(chalk.green(`Provider ${name} enabled`));
    } else {
      fail(`Provider not found: ${name}`);
    }
  });

providers
  .command("disable <name>")
  .action((name: string) => {
    if (disableProvider(name)) {
      console.log(chalk.green(`Provider ${name} disabled`));
    } else {
      fail(`Provider not found: ${name}`);
    }
  });

providers
  .command("configure <name>")
  .option("--key-env <env>", "API key env var name")
  .option("--rate-limit <n>", "Requests per minute")
  .action((name: string, opts) => {
    try {
      const updates: { apiKeyEnv?: string; rateLimit?: number } = {};
      if (opts.keyEnv) updates.apiKeyEnv = opts.keyEnv;
      const rateLimit = parseOptionalRateLimit(opts.rateLimit);
      if (rateLimit !== undefined) updates.rateLimit = rateLimit;
      if (updateProvider(name, updates)) {
        console.log(chalk.green(`Provider ${name} updated`));
      } else {
        fail(`Provider not found: ${name}`);
      }
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

// --- Profiles ---
const profiles = program.command("profiles").description("Search profiles");

profiles
  .command("list")
  .alias("ls")
  .option("--json", "Output full records as JSON")
  .option("--verbose", "Show full descriptions")
  .action((opts) => {
    const all = listProfiles();
    if (opts.json) {
      printJson(all);
      return;
    }
    console.log(chalk.bold(`Search Profiles (${all.length})`));
    console.log();
    for (const p of all) {
      console.log(
        `${chalk.dim(p.id)}  ${chalk.yellow(p.name.padEnd(12))} ${chalk.white(truncateText(p.providers.join(", "), 72))}  ${chalk.dim(opts.verbose ? (p.description ?? "") : truncateText(p.description ?? "", 88))}`,
      );
    }
  });

profiles
  .command("create <name>")
  .option("-p, --providers <providers>", "Comma-separated providers")
  .option("-d, --description <desc>", "Description")
  .action((name: string, opts) => {
    try {
      const providerList = parseProviderList(opts.providers) ?? [];
      const p = createProfile({ name, providers: providerList, description: opts.description });
      console.log(chalk.green(`Profile created: ${p.id}`));
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

profiles
  .command("delete <id>")
  .action((id: string) => {
    if (deleteProfile(id)) {
      console.log(chalk.green("Profile deleted"));
    } else {
      fail(`Profile not found: ${id}`);
    }
  });

profiles
  .command("use <name> <query...>")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (name: string, queryParts: string[], opts) => {
    const query = queryParts.join(" ");
    const profile = getProfileByName(name);
    if (!profile) {
      fail(`Profile not found: ${name}`);
      return;
    }
    const response = await unifiedSearch(query, { profile: name });
    printResults(response.results, response.search.duration, response.errors, { verbose: opts.verbose });
  });

// --- Export ---
program
  .command("export <searchId>")
  .option("-f, --format <format>", "Format: json, csv, md", "json")
  .option("-o, --output <file>", "Output file")
  .action((searchId: string, opts) => {
    try {
      const output = exportResults(searchId, opts.format as ExportFormat);
      if (opts.output) {
        Bun.write(opts.output, output);
        console.log(chalk.green(`Exported to ${opts.output}`));
      } else {
        console.log(output);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exitCode = 1;
    }
  });

// --- Config ---
const config = program.command("config").description("Configuration");

config.command("get [key]").action((key?: string) => {
  const diagnostics = getConfigDiagnostics();
  if (!diagnostics.valid) {
    console.error(chalk.yellow(`Warning: invalid config at ${diagnostics.path}; using defaults.`));
    for (const error of diagnostics.errors) console.error(chalk.yellow(`  ${error}`));
  }
  const cfg = getConfig();
  if (key) {
    if (!hasConfigKey(key)) {
      fail(`Unknown config key: ${key}`);
      return;
    }
    const value = cfg[key];
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(JSON.stringify(cfg, null, 2));
  }
});

config
  .command("set <key> <value>")
  .action((key: string, value: string) => {
    try {
      if (!hasConfigKey(key)) {
        throw new Error(`Unknown config key: ${key}`);
      }
      setConfigValue(key, parseConfigInput(value));
      console.log(chalk.green(`Config ${key} updated`));
    } catch (err) {
      fail(`Error: ${err instanceof Error ? err.message : err}`);
    }
  });

config.command("reset").action(() => {
  resetConfig();
  console.log(chalk.green("Config reset to defaults"));
});

// --- Stats ---
program.command("stats").action(() => {
  const stats = getSearchStats();
  console.log(chalk.bold("Search Statistics"));
  console.log(`  Total searches: ${stats.totalSearches}`);
  console.log(`  Total results:  ${stats.totalResults}`);
  console.log();
  if (Object.keys(stats.providerBreakdown).length > 0) {
    console.log(chalk.bold("  Results by Provider:"));
    for (const [provider, count] of Object.entries(stats.providerBreakdown)) {
      console.log(`    ${provider.padEnd(14)} ${count}`);
    }
  }
});

// --- Helper: Print results ---
function printResults(
  results: import("../types/index.js").SearchResult[],
  duration: number,
  errors: Array<{ provider: SearchProviderName; error: string }>,
  opts: { verbose?: boolean; total?: number; offset?: number } = {},
): void {
  if (results.length === 0) {
    console.log(chalk.yellow("No results found"));
    for (const e of errors) {
      console.error(`  ${chalk.red(e.provider)}: ${e.error}`);
    }
    return;
  }

  const total = opts.total ?? results.length;
  const offset = opts.offset ?? 0;
  const visible = opts.verbose ? results : results.slice(0, DEFAULT_COMPACT_LIMIT);
  console.log(
    chalk.bold(`${total} results`) +
      chalk.dim(` (${duration}ms, showing ${visible.length}${offset ? ` from offset ${offset}` : ""})`),
  );
  console.log();

  for (const r of visible) {
    const badge = chalk.bgCyan.black(` ${r.source} `);
    const title = opts.verbose ? r.title : truncateText(r.title, 110);
    const url = opts.verbose ? r.url : truncateMiddle(r.url, 120);
    const snippet = opts.verbose ? r.snippet : truncateText(r.snippet, 160);
    console.log(`${chalk.dim(String(r.rank).padStart(3))} ${badge} ${chalk.bold.blue(title)}`);
    console.log(`     ${chalk.dim(url)}`);
    if (r.snippet) {
      console.log(`     ${snippet}`);
    }
    if (r.score !== null) {
      console.log(`     ${chalk.dim(`score: ${r.score.toFixed(3)}`)}`);
    }
    console.log();
  }

  if (errors.length > 0) {
    console.log(chalk.yellow("Errors:"));
    for (const e of errors) {
      console.log(`  ${chalk.red(e.provider)}: ${e.error}`);
    }
  }

  if (!opts.verbose && offset + visible.length < total) {
    console.log(chalk.dim("More results available. Use --verbose or a narrower --limit/filter for more detail."));
  }
}

// Default action: if first arg isn't a known command, treat it as a search query
program.action(async (queryParts: string[] = []) => {
  if (queryParts.length > 0) {
    // Treat as search query
    const query = queryParts.join(" ");
    try {
      const response = await unifiedSearch(query);
      printResults(response.results, response.search.duration, response.errors);
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  } else {
    program.help();
  }
});

// ── feedback ──────────────────────────────────────────────────────────────────

program
  .command("feedback <message>")
  .description("Send feedback about this service")
  .option("-e, --email <email>", "Contact email")
  .option("-c, --category <cat>", "Category: bug, feature, general", "general")
  .action(async (message: string, opts: { email?: string; category?: string }) => {
    const { getDb } = await import("../db/database.js");
    const db = getDb();
    const pkg = require("../../package.json");
    db.run(
      "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
      [message, opts.email || null, opts.category || "general", pkg.version]
    );
    console.log(chalk.green("✓") + " Feedback saved. Thank you!");
  });

program.parse();
