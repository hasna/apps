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
} from "../db/providers.js";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  getProfileByName,
} from "../db/profiles.js";
import { getIndexDbPath } from "../db/index-db.js";
import { getDbPath } from "../db/database.js";

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
registerLocalCommands(program);
registerEventsCommands(program, { source: "search" });

program
  .command("doctor")
  .description("Check local search configuration and storage paths")
  .option("--json", "Output as JSON")
  .action((opts) => {
    const diagnostics = getConfigDiagnostics();
    const providers = listProviders().map((provider) => ({
      name: provider.name,
      enabled: provider.enabled,
      configured: isProviderConfigured(provider),
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
    if (!diagnostics.valid) process.exitCode = 1;
  });

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

      printResults(response.results, response.search.duration, response.errors);
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
    .action(async (queryParts: string[], opts) => {
      const query = queryParts.join(" ");

      try {
        if (providerName === "youtube" && opts.transcribe) {
          const deep = await youtubeDeepSearch(query, {
            limit: parseInt(opts.limit),
            transcribeTop: 3,
          });
          printResults(deep.videoResults, 0, []);
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

        printResults(response.results, response.search.duration, response.errors);
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
  .option("-q, --query <query>", "Filter by query")
  .action((opts) => {
    const { searches, total } = listSearches({
      limit: parseInt(opts.limit),
      query: opts.query,
    });
    console.log(chalk.bold(`Search History (${total} total)`));
    console.log();
    for (const s of searches) {
      console.log(
        `${chalk.dim(s.id.substring(0, 8))}  ${chalk.white(s.query)}  ${chalk.cyan(s.providers.join(","))}  ${chalk.green(String(s.resultCount) + " results")}  ${chalk.dim(s.createdAt)}`,
      );
    }
  });

history
  .command("show <id>")
  .action((id: string) => {
    const search = getSearch(id);
    if (!search) {
      fail(`Search not found: ${id}`);
      return;
    }
    console.log(chalk.bold(`Query: ${search.query}`));
    console.log(`Providers: ${search.providers.join(", ")}`);
    console.log(`Results: ${search.resultCount} | Duration: ${search.duration}ms`);
    console.log();
    const results = listResults(search.id);
    printResults(results, search.duration, []);
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

saved.command("list").alias("ls").action(() => {
  const items = listSavedSearches();
  if (items.length === 0) {
    console.log(chalk.dim("No saved searches"));
    return;
  }
  for (const s of items) {
    console.log(
      `${chalk.dim(s.id.substring(0, 8))}  ${chalk.yellow(s.name)}  ${chalk.white(s.query)}  ${chalk.cyan(s.providers.join(","))}  ${chalk.dim(s.lastRunAt ?? "never run")}`,
    );
  }
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
  .action(async (id: string) => {
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
    printResults(response.results, response.search.duration, response.errors);
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

providers.command("list").alias("ls").action(() => {
  const all = listProviders();
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

profiles.command("list").alias("ls").action(() => {
  const all = listProfiles();
  for (const p of all) {
    console.log(
      `${chalk.dim(p.id.substring(0, 12))}  ${chalk.yellow(p.name.padEnd(12))} ${chalk.white(p.providers.join(", "))}  ${chalk.dim(p.description ?? "")}`,
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
  .action(async (name: string, queryParts: string[]) => {
    const query = queryParts.join(" ");
    const profile = getProfileByName(name);
    if (!profile) {
      fail(`Profile not found: ${name}`);
      return;
    }
    const response = await unifiedSearch(query, { profile: name });
    printResults(response.results, response.search.duration, response.errors);
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
): void {
  if (results.length === 0) {
    console.log(chalk.yellow("No results found"));
    for (const e of errors) {
      console.error(`  ${chalk.red(e.provider)}: ${e.error}`);
    }
    return;
  }

  console.log(chalk.bold(`${results.length} results`) + chalk.dim(` (${duration}ms)`));
  console.log();

  for (const r of results) {
    const badge = chalk.bgCyan.black(` ${r.source} `);
    console.log(`${chalk.dim(String(r.rank).padStart(3))} ${badge} ${chalk.bold.blue(r.title)}`);
    console.log(`     ${chalk.dim(r.url)}`);
    if (r.snippet) {
      console.log(`     ${r.snippet.substring(0, 200)}`);
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
