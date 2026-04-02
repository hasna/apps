#!/usr/bin/env bun
// OMP CLI — omp validate|run|compile|lint|init|inspect
import { Command } from "commander";
import chalk from "chalk";
import { parseFromFile, validate, compile, run } from "../lib/pipeline.js";
import { validateAndLint } from "../validator/validate.js";
import { createLLMClient } from "../lib/llm-client.js";
import { writeFileSync, existsSync } from "fs";
import type { OmpError, LLMClientOptions } from "../types/index.js";

const program = new Command();

program
  .name("omp")
  .description("Open Markdown Protocol — parse, validate, and execute .omp.md files")
  .version("0.1.3");

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
  .description("Parse and output the execution plan as JSON")
  .action(async (file: string) => {
    try {
      const doc = parseFromFile(file);
      const plan = compile(doc);
      console.log(JSON.stringify(plan, null, 2));
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
  .action(async (file: string, opts: { json?: boolean }) => {
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

      console.log(chalk.bold(`Title: ${doc.title}`));
      console.log(chalk.bold(`Cards: ${doc.cards.length}`));
      console.log(chalk.bold(`Patterns: ${doc.patterns.length}`));
      console.log();

      for (const card of doc.cards) {
        const deps = card.depends.length > 0 ? ` → depends: [${card.depends.join(", ")}]` : "";
        const accepts = card.accepts.length > 0 ? ` (${card.accepts.length} criteria)` : "";
        const directives = card.body.inlineDirectives.length > 0 ? ` {{${card.body.inlineDirectives.length}}}` : "";
        console.log(`  ${chalk.cyan(card.type)}:${chalk.white(card.id)}${deps}${accepts}${directives}`);
      }

      console.log();
      console.log(chalk.bold("Execution Plan:"));
      for (const step of plan.steps) {
        console.log(`  ${step.description}`);
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

program.parse();
