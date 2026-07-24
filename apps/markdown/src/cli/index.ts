#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
// OMP CLI — omp validate|run|compile|lint|init|inspect
import { Command } from "commander";
import chalk from "chalk";
import { parseFromFile, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";
import { createLLMClient } from "../lib/llm-client.js";
import { getPackageVersion } from "../lib/package-version.js";
import { storagePull, storagePush, storageStatus, storageSync } from "../storage.js";
import {
  DEFAULT_OUTPUT_LIMIT,
  normalizeLimit,
  summarizeDocument,
  summarizeExecutionPlan,
} from "../lib/compact-output.js";
import { writeFileSync, existsSync } from "fs";
import type { OmpError, LLMClientOptions } from "../types/index.js";

const program = new Command();

program
  .name("omp")
  .description("Open Markdown Protocol — parse, validate, and execute .omp.md files")
  .version(getPackageVersion());

// ─── validate ────────────────────────────────────────────────

program
  .command("validate <file>")
  .description("Validate an OMP document against the spec")
  .option("-j, --json", "Output result as JSON")
  .action(async (file: string, opts: { json?: boolean }) => {
    try {
      const doc = parseFromFile(file);
      const errors = validate(doc);

      const errorCount = errors.filter((e) => e.level === "error").length;
      const warnCount = errors.filter((e) => e.level === "warning").length;
      const payload = {
        valid: errorCount === 0,
        cards: doc.cards.length,
        errorCount,
        warningCount: warnCount,
        errors: errors.filter((e) => e.level === "error"),
        warnings: errors.filter((e) => e.level === "warning"),
      };

      if (opts.json) {
        printJson(payload);
        if (errorCount > 0) process.exit(1);
        return;
      }

      printErrors(errors);

      console.log(`\n${chalk.bold(doc.cards.length)} cards parsed`);

      if (errorCount === 0) {
        console.log(chalk.green("✓ Document is valid"));
      } else {
        console.log(chalk.red(`✗ ${errorCount} error(s), ${warnCount} warning(s)`));
        process.exit(1);
      }
    } catch (err) {
      if (opts.json) {
        printJson({ error: err instanceof Error ? err.message : String(err) });
      } else {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
      process.exit(1);
    }
  });

// ─── run ─────────────────────────────────────────────────────

program
  .command("run <file>")
  .description("Execute an OMP document through the full pipeline")
  .option("--dry-run", "Show what would be done without executing")
  .option("--llm <model>", "LLM provider:model (e.g., anthropic:haiku, openai:gpt-4o-mini, ollama:llama3)")
  .option("--output-dir <dir>", "Output directory", ".")
  .option("--verbose", "Verbose output")
  .option("-j, --json", "Output result as JSON")
  .action(async (file: string, opts: { dryRun?: boolean; llm?: string; outputDir: string; verbose?: boolean; json?: boolean }) => {
    try {
      const llm = opts.llm ? parseLLMOption(opts.llm) : undefined;

      const result = await run(file, {
        outputDir: opts.outputDir,
        dryRun: opts.dryRun,
        llm: llm ? createLLMClient(llm) : undefined,
        onProgress: (msg) => {
          if (opts.verbose) console.log(chalk.dim(msg));
        },
      });

      if (opts.json) {
        printJson(result);
        if (!result.success) process.exit(1);
        return;
      }

      console.log();
      if (result.success) {
        console.log(chalk.green.bold("✓ Execution complete"));
      } else {
        console.log(chalk.red.bold("✗ Execution failed"));
      }

      console.log(`  Cards: ${result.cardsExecuted}/${result.cardsTotal}`);
      console.log(`  LLM calls: ${result.llmCalls}`);
      console.log(`  Files created: ${result.filesCreated.length}`);
      console.log(`  Duration: ${result.durationMs}ms`);

      if (result.errors.length > 0) {
        printErrors(result.errors);
      }

      if (!result.success) process.exit(1);
    } catch (err) {
      if (opts.json) {
        printJson({ error: err instanceof Error ? err.message : String(err) });
      } else {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
      process.exit(1);
    }
  });

// ─── compile ─────────────────────────────────────────────────

program
  .command("compile <file>")
  .description("Parse and summarize the execution plan")
  .option("-j, --json", "Output full execution plan as JSON")
  .option("--verbose", "Show all execution steps")
  .option("--limit <n>", `Maximum rows to show in compact output (default: ${DEFAULT_OUTPUT_LIMIT})`)
  .action(async (file: string, opts: { json?: boolean; verbose?: boolean; limit?: string }) => {
    try {
      const doc = parseFromFile(file);
      const plan = compile(doc);

      if (opts.json) {
        printJson(plan);
        return;
      }

      console.log(summarizeExecutionPlan(plan, {
        limit: normalizeLimit(opts.limit),
        verbose: opts.verbose,
      }));
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

// ─── lint ────────────────────────────────────────────────────

program
  .command("lint <file>")
  .description("Validate + best practice checks")
  .option("-j, --json", "Output result as JSON")
  .action(async (file: string, opts: { json?: boolean }) => {
    try {
      const doc = parseFromFile(file);
      const errors = validateAndLint(doc);

      const errorCount = errors.filter((e) => e.level === "error").length;
      const warnCount = errors.filter((e) => e.level === "warning").length;
      const infoCount = errors.filter((e) => e.level === "info").length;
      const payload = {
        cards: doc.cards.length,
        errorCount,
        warningCount: warnCount,
        infoCount,
        errors: errors.filter((e) => e.level === "error"),
        warnings: errors.filter((e) => e.level === "warning"),
        info: errors.filter((e) => e.level === "info"),
      };

      if (opts.json) {
        printJson(payload);
        if (errorCount > 0) process.exit(1);
        return;
      }

      printErrors(errors);

      console.log(`\n${errorCount} error(s), ${warnCount} warning(s), ${infoCount} info(s)`);

      if (errorCount > 0) process.exit(1);
    } catch (err) {
      if (opts.json) {
        printJson({ error: err instanceof Error ? err.message : String(err) });
      } else {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
      process.exit(1);
    }
  });

// ─── inspect ─────────────────────────────────────────────────

program
  .command("inspect <file>")
  .description("Show parsed AST, card count, DAG visualization")
  .option("-j, --json", "Output result as JSON")
  .option("--verbose", "Show all cards and header keys")
  .option("--limit <n>", `Maximum cards/steps to show in compact output (default: ${DEFAULT_OUTPUT_LIMIT})`)
  .action(async (file: string, opts: { json?: boolean; verbose?: boolean; limit?: string }) => {
    try {
      const doc = parseFromFile(file);
      const plan = compile(doc);
      const payload = {
        title: doc.title,
        cards: doc.cards.map((card) => ({
          type: card.type,
          id: card.id,
          depends: card.depends,
          accepts: card.accepts,
          headers: card.headers,
          inlineDirectives: card.body.inlineDirectives.length,
        })),
        patterns: doc.patterns.length,
        executionPlan: plan,
      };

      if (opts.json) {
        printJson(payload);
        return;
      }

      console.log(summarizeDocument(doc, plan, {
        limit: normalizeLimit(opts.limit),
        verbose: opts.verbose,
      }));
    } catch (err) {
      if (opts.json) {
        printJson({ error: err instanceof Error ? err.message : String(err) });
      } else {
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
      }
      process.exit(1);
    }
  });

// ─── init ────────────────────────────────────────────────────

program
  .command("init [name]")
  .description("Create a starter .omp.md file")
  .action(async (name: string = "app") => {
    const filename = `${name}.omp.md`;

    if (existsSync(filename)) {
      console.error(chalk.red(`File ${filename} already exists`));
      process.exit(1);
    }

    const template = `# ${name}

---

type: project
id: init
name: ${name}
framework: nextjs@15
router: app
language: typescript
styling: tailwind
pkg: bun

Create the project scaffolding with TypeScript and Tailwind CSS.

---

type: database
id: db
engine: sqlite
orm: drizzle
file: data/${name}.db
depends: init

Configure the database connection using Drizzle ORM.

---

type: table
id: items
db: db

| column     | type     | constraints        |
|-----------|----------|--------------------|
| id        | text     | primary key, uuid  |
| name      | text     | not null           |
| created_at| datetime | default now        |

Define the items table.

accepts: id auto-generated; created_at defaults to now

---

type: endpoint
id: list-items
method: GET
path: /api/items
auth: none
depends: db

Return all items sorted by created_at descending.

accepts: returns array; sorted newest first

---

type: seed
id: seed
depends: db
sample-items: 3

Create {{random(1, numeric)}} sample items with {{generate realistic item names for a ${name} app}}.

accepts: items created; visible in list endpoint
`;

    writeFileSync(filename, template);
    console.log(chalk.green(`✓ Created ${filename}`));
    console.log(`  Run ${chalk.cyan(`omp validate ${filename}`)} to check it`);
    console.log(`  Run ${chalk.cyan(`omp inspect ${filename}`)} to see the structure`);
    console.log(`  Run ${chalk.cyan(`omp run ${filename}`)} to execute it`);
  });

// ─── storage ─────────────────────────────────────────────────

const storage = program
  .command("storage")
  .description("Inspect and sync markdown-owned local storage");

storage
  .command("status")
  .description("Show local SQLite path, machine identity, and optional remote status")
  .option("-j, --json", "Output result as JSON")
  .action((opts: { json?: boolean }) => {
    const status = storageStatus();
    if (opts.json) {
      printJson(status);
      return;
    }

    console.log(chalk.bold("Markdown storage"));
    console.log(`  Local: ${status.localPath}`);
    console.log(`  Machine: ${status.machineId}`);
    console.log(`  Runtime: ${status.runtimeStorage}`);
    console.log(`  Remote: ${status.remoteConfigured ? `${status.remoteRole} (${status.remoteEnv})` : "not configured"}`);
    console.log(`  Tables: ${status.tables.join(", ")}`);
    console.log(`  Conflict policy: ${status.conflictPolicy}`);
  });

storage
  .command("push")
  .description("Push local feedback rows to the optional Postgres mirror")
  .option("-j, --json", "Output result as JSON")
  .action(async (opts: { json?: boolean }) => {
    await printStorageResult(await storagePush(), opts);
  });

storage
  .command("pull")
  .description("Pull feedback rows from the optional Postgres mirror")
  .option("-j, --json", "Output result as JSON")
  .action(async (opts: { json?: boolean }) => {
    await printStorageResult(await storagePull(), opts);
  });

storage
  .command("sync")
  .description("Push local feedback, then pull remote feedback")
  .option("-j, --json", "Output result as JSON")
  .action(async (opts: { json?: boolean }) => {
    await printStorageResult(await storageSync(), opts);
  });

// ─── Helpers ─────────────────────────────────────────────────

function printErrors(errors: OmpError[]) {
  for (const err of errors) {
    const prefix =
      err.level === "error" ? chalk.red("ERROR") :
      err.level === "warning" ? chalk.yellow("WARN") :
      chalk.dim("INFO");
    const loc = err.card ? ` [${err.card}]` : "";
    const line = err.line ? `:${err.line}` : "";
    console.log(`  ${prefix}${loc}${line}: ${err.message}`);
  }
}

function printJson(payload: unknown) {
  console.log(JSON.stringify(payload, null, 2));
}

async function printStorageResult(
  result: Awaited<ReturnType<typeof storagePush>>,
  opts: { json?: boolean }
) {
  if (opts.json) {
    printJson(result);
  } else {
    console.log(chalk.bold(`Storage ${result.direction}`));
    console.log(`  Local: ${result.localPath}`);
    console.log(`  Machine: ${result.machineId}`);
    console.log(`  Remote: ${result.remoteConfigured ? result.remoteEnv : "not configured"}`);
    console.log(`  Rows read: ${result.rowsRead}`);
    console.log(`  Rows written: ${result.rowsWritten}`);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.error(chalk.red(`  Error: ${error}`));
      }
    }
  }

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

function parseLLMOption(opt: string): LLMClientOptions {
  const normalized = opt.trim();
  if (!normalized) {
    throw new Error("Invalid --llm value. Expected provider:model or model alias.");
  }

  const providerAliases: Record<string, "anthropic" | "openai" | "ollama"> = {
    anthropic: "anthropic",
    openai: "openai",
    ollama: "ollama",
  };

  const modelAliases: Record<string, LLMClientOptions> = {
    haiku: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  };

  if (normalized.includes(":")) {
    const [providerRaw, modelRaw] = normalized.split(":", 2);
    const providerKey = providerRaw.toLowerCase();
    const provider = providerAliases[providerKey];

    if (!provider) {
      throw new Error(
        `Unsupported LLM provider: ${providerRaw}. Supported providers: anthropic, openai, ollama.`
      );
    }

    if (!modelRaw || !modelRaw.trim()) {
      throw new Error(`Missing model for provider ${providerRaw}. Example: ${providerRaw}:model-name`);
    }

    return { provider, model: modelRaw.trim() };
  }

  if (modelAliases[normalized]) {
    return modelAliases[normalized];
  }

  return {
    provider: "anthropic",
    model: normalized,
  };
}
registerEventsCommands(program, { source: "markdown" });

program.parse();
