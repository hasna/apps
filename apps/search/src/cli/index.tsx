#!/usr/bin/env bun
import { Command } from "commander";
import { registerEventsCommands } from "@hasna/events/commander";
import chalk from "chalk";
import { registerStorageCommands } from "./storage.js";
import { registerLocalCommands } from "./local.js";
import { PROVIDER_NAMES, type SearchProviderName, type ExportFormat } from "../types/index.js";
import { unifiedSearch, searchSingleProvider } from "../lib/search.js";
import { youtubeDeepSearch } from "../lib/youtube-deep.js";
import { exportResults } from "../lib/export.js";
import { getConfig, setConfigValue, resetConfig } from "../lib/config.js";
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
} from "../db/providers.js";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  getProfileByName,
} from "../db/profiles.js";
import {
  DEFAULT_COMPACT_LIMIT,
  clampLimit,
  truncateMiddle,
  truncateText,
} from "../lib/compact-output.js";

const pkg = require("../../package.json") as { version: string };

const program = new Command();

program
  .name("search")
  .version(pkg.version)
  .description("Unified search — local file index + 12 web providers, one interface");

registerStorageCommands(program);
registerEventsCommands(program, { source: "search" });

registerLocalCommands(program);

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
  .option("--no-dedup", "Disable deduplication")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (queryParts: string[], opts) => {
    const query = queryParts.join(" ");
    const providers = opts.providers
      ? (opts.providers.split(",") as SearchProviderName[])
      : undefined;

    try {
      const response = await unifiedSearch(query, {
        providers,
        profile: opts.profile,
        options: { limit: parseInt(opts.limit) },
        dedup: opts.dedup,
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
      console.error(chalk.red(`Search not found: ${id}`));
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
      console.error(chalk.red(`Search not found: ${id}`));
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
    const providers = opts.providers
      ? (opts.providers.split(",") as SearchProviderName[])
      : [];
    const s = createSavedSearch({ name, query, providers, profileId: opts.profile });
    console.log(chalk.green(`Saved search created: ${s.id}`));
  });

saved
  .command("run <id>")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (id: string, opts) => {
    const s = getSavedSearch(id);
    if (!s) {
      console.error(chalk.red(`Saved search not found: ${id}`));
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
      console.error(chalk.red(`Not found: ${id}`));
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
      printJson(all.map((p) => ({ ...p, configured: isProviderConfigured(p) })));
      return;
    }
    console.log(chalk.bold("Search Providers"));
    console.log();
    for (const p of all) {
      const configured = isProviderConfigured(p);
      const status = p.enabled
        ? configured
          ? chalk.green("enabled")
          : chalk.yellow("enabled (no key)")
        : chalk.dim("disabled");
      const keyInfo = p.apiKeyEnv ? chalk.dim(` [${p.apiKeyEnv}]`) : chalk.dim(" [no key needed]");
      console.log(`  ${chalk.white(p.name.padEnd(14))} ${status}${keyInfo}  rate: ${p.rateLimit}/min`);
    }
  });

providers
  .command("enable <name>")
  .action((name: string) => {
    if (enableProvider(name)) {
      console.log(chalk.green(`Provider ${name} enabled`));
    } else {
      console.error(chalk.red(`Provider not found: ${name}`));
    }
  });

providers
  .command("disable <name>")
  .action((name: string) => {
    if (disableProvider(name)) {
      console.log(chalk.green(`Provider ${name} disabled`));
    } else {
      console.error(chalk.red(`Provider not found: ${name}`));
    }
  });

providers
  .command("configure <name>")
  .option("--key-env <env>", "API key env var name")
  .option("--rate-limit <n>", "Requests per minute")
  .action((name: string, opts) => {
    const updates: Record<string, unknown> = {};
    if (opts.keyEnv) updates.apiKeyEnv = opts.keyEnv;
    if (opts.rateLimit) updates.rateLimit = parseInt(opts.rateLimit);
    if (updateProvider(name, updates)) {
      console.log(chalk.green(`Provider ${name} updated`));
    } else {
      console.error(chalk.red(`Provider not found: ${name}`));
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
    const providerList = opts.providers
      ? (opts.providers.split(",") as SearchProviderName[])
      : [];
    const p = createProfile({ name, providers: providerList, description: opts.description });
    console.log(chalk.green(`Profile created: ${p.id}`));
  });

profiles
  .command("delete <id>")
  .action((id: string) => {
    if (deleteProfile(id)) {
      console.log(chalk.green("Profile deleted"));
    } else {
      console.error(chalk.red(`Profile not found: ${id}`));
    }
  });

profiles
  .command("use <name> <query...>")
  .option("--verbose", "Show every returned row with untruncated URLs/snippets")
  .action(async (name: string, queryParts: string[], opts) => {
    const query = queryParts.join(" ");
    const profile = getProfileByName(name);
    if (!profile) {
      console.error(chalk.red(`Profile not found: ${name}`));
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
    }
  });

// --- Config ---
const config = program.command("config").description("Configuration");

config.command("get [key]").action((key?: string) => {
  const cfg = getConfig();
  if (key) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (cfg as any)[key];
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(JSON.stringify(cfg, null, 2));
  }
});

config
  .command("set <key> <value>")
  .action((key: string, value: string) => {
    try {
      const parsed = JSON.parse(value);
      setConfigValue(key as keyof typeof import("../types/index.js").DEFAULT_CONFIG, parsed);
    } catch {
      setConfigValue(key as keyof typeof import("../types/index.js").DEFAULT_CONFIG, value);
    }
    console.log(chalk.green(`Config ${key} updated`));
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

  if (!opts.verbose && visible.length < total) {
    console.log(chalk.dim("More results available. Use --verbose or a narrower --limit/filter for more detail."));
  }
}

// Default action: if first arg isn't a known command, treat it as a search query
program.action(async (_, cmd) => {
  const args = cmd.args;
  if (args.length > 0) {
    // Treat as search query
    const query = args.join(" ");
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
