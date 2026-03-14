#!/usr/bin/env bun
// brains CLI entry point

import { Command } from "commander";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getDb, fineTunedModels, trainingJobs, trainingDatasets } from "../db/index.js";
import * as openaiProvider from "../lib/providers/openai.js";
import { ThinkerLabsProvider } from "../lib/providers/thinker-labs.js";
import { printTable, printStatus, printJson, printError, printSuccess, printInfo } from "./ui.js";

const program = new Command();

program
  .name("brains")
  .description("Fine-tuned model tracker and trainer")
  .version("0.0.1");

// ── models ────────────────────────────────────────────────────────────────────

const modelsCmd = program.command("models").description("Manage tracked fine-tuned models");

modelsCmd
  .command("list")
  .description("List all tracked fine-tuned models")
  .action(async () => {
    try {
      const db = getDb();
      const models = await db.select().from(fineTunedModels);
      if (models.length === 0) {
        printInfo("No models tracked yet. Use 'brains finetune start' to train one.");
        return;
      }
      printTable(
        ["ID", "Name", "Provider", "Status", "Base Model"],
        models.map((m) => [m.id, m.name, m.provider, printStatus(m.status), m.baseModel])
      );
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command("show <id>")
  .description("Show details of a specific model")
  .action(async (id: string) => {
    try {
      const db = getDb();
      const [model] = await db
        .select()
        .from(fineTunedModels)
        .where(eq(fineTunedModels.id, id));
      if (!model) {
        printError(`Model not found: ${id}`);
        process.exit(1);
      }
      console.log();
      console.log(`  ID:            ${model.id}`);
      console.log(`  Name:          ${model.name}`);
      console.log(`  Provider:      ${model.provider}`);
      console.log(`  Status:        ${printStatus(model.status)}`);
      console.log(`  Base Model:    ${model.baseModel}`);
      console.log(`  Job ID:        ${model.fineTuneJobId ?? "(none)"}`);
      console.log(`  Created:       ${new Date(model.createdAt).toISOString()}`);
      console.log(`  Updated:       ${new Date(model.updatedAt).toISOString()}`);
      console.log();
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── finetune ──────────────────────────────────────────────────────────────────

const finetuneCmd = program.command("finetune").description("Manage fine-tuning jobs");

finetuneCmd
  .command("start")
  .description("Start a fine-tuning job")
  .requiredOption("--provider <provider>", "Provider to use (openai|thinker-labs)")
  .requiredOption("--base-model <model>", "Base model to fine-tune (e.g. gpt-4o-mini-2024-07-18)")
  .requiredOption("--dataset <path>", "Path to the JSONL training dataset")
  .requiredOption("--name <name>", "Human-readable name for this fine-tuned model")
  .action(async (opts: { provider: string; baseModel: string; dataset: string; name: string }) => {
    try {
      if (opts.provider !== "openai" && opts.provider !== "thinker-labs") {
        printError(`Unknown provider: ${opts.provider}. Use 'openai' or 'thinker-labs'.`);
        process.exit(1);
      }
      if (!existsSync(opts.dataset)) {
        printError(`Dataset file not found: ${opts.dataset}`);
        process.exit(1);
      }

      printInfo(`Uploading training file: ${opts.dataset} …`);
      let fileId: string;
      let jobId: string;
      let jobStatus: string;

      if (opts.provider === "openai") {
        ({ fileId } = await openaiProvider.uploadTrainingFile(opts.dataset));
        printSuccess(`File uploaded. fileId = ${fileId}`);
        printInfo(`Creating fine-tune job on OpenAI …`);
        ({ jobId, status: jobStatus } = await openaiProvider.createFineTuneJob(
          fileId,
          opts.baseModel,
          opts.name
        ));
      } else {
        const tl = new ThinkerLabsProvider();
        ({ fileId } = await tl.uploadTrainingFile(opts.dataset));
        printSuccess(`File uploaded. fileId = ${fileId}`);
        printInfo(`Creating fine-tune job on Thinker Labs …`);
        ({ jobId, status: jobStatus } = await tl.createFineTuneJob(
          fileId,
          opts.baseModel,
          opts.name
        ));
      }

      // Persist model record
      const db = getDb();
      const modelId = randomUUID();
      const now = Date.now();
      await db.insert(fineTunedModels).values({
        id: modelId,
        name: opts.name,
        provider: opts.provider as "openai" | "thinker-labs",
        baseModel: opts.baseModel,
        status: "running",
        fineTuneJobId: jobId,
        createdAt: now,
        updatedAt: now,
      });

      const trainingJobId = randomUUID();
      await db.insert(trainingJobs).values({
        id: trainingJobId,
        modelId,
        provider: opts.provider,
        status: jobStatus,
        startedAt: now,
      });

      printSuccess(`Fine-tune job started!`);
      console.log();
      console.log(`  Model ID:   ${modelId}`);
      console.log(`  Job ID:     ${jobId}`);
      console.log(`  Status:     ${printStatus(jobStatus)}`);
      console.log();
      printInfo(`Use 'brains finetune status ${jobId}' to check progress.`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

finetuneCmd
  .command("status <job-id>")
  .description("Get the status of a fine-tuning job")
  .option("--provider <provider>", "Provider (openai|thinker-labs)", "openai")
  .action(async (jobId: string, opts: { provider: string }) => {
    try {
      let result: { jobId: string; status: string; fineTunedModel?: string; error?: string };

      if (opts.provider === "openai") {
        result = await openaiProvider.getFineTuneStatus(jobId);
      } else {
        const tl = new ThinkerLabsProvider();
        result = await tl.getFineTuneStatus(jobId);
      }

      console.log();
      console.log(`  Job ID:           ${result.jobId}`);
      console.log(`  Status:           ${printStatus(result.status)}`);
      if (result.fineTunedModel) {
        console.log(`  Fine-tuned model: ${result.fineTunedModel}`);
      }
      if (result.error) {
        console.log(`  Error:            ${result.error}`);
      }
      console.log();

      // Update DB if we have a record
      const db = getDb();
      const [model] = await db
        .select()
        .from(fineTunedModels)
        .where(eq(fineTunedModels.fineTuneJobId, jobId));
      if (model) {
        const status = result.status as typeof model.status;
        await db
          .update(fineTunedModels)
          .set({ status, updatedAt: Date.now() })
          .where(eq(fineTunedModels.fineTuneJobId, jobId));
      }
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

finetuneCmd
  .command("list")
  .description("List all fine-tuning jobs")
  .option("--provider <provider>", "Provider to query (openai|thinker-labs)", "openai")
  .action(async (opts: { provider: string }) => {
    try {
      let jobs: Array<{ id: string; model: string; status: string; created: number }>;

      if (opts.provider === "openai") {
        jobs = await openaiProvider.listFineTunedModels();
      } else {
        const tl = new ThinkerLabsProvider();
        jobs = await tl.listFineTunedModels();
      }

      if (jobs.length === 0) {
        printInfo("No fine-tuning jobs found.");
        return;
      }

      printTable(
        ["Job ID", "Model", "Status", "Created"],
        jobs.map((j) => [
          j.id,
          j.model,
          printStatus(j.status),
          new Date(j.created * 1000).toISOString().split("T")[0] ?? "",
        ])
      );
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── data ──────────────────────────────────────────────────────────────────────

const DEFAULT_DATASETS_DIR = join(homedir(), ".brains", "datasets");

const dataCmd = program.command("data").description("Manage training datasets");

dataCmd
  .command("gather")
  .description("Gather training data from agent memory sources")
  .option(
    "--source <source>",
    "Data source: todos|mementos|conversations|sessions|all",
    "all"
  )
  .option("--output <dir>", "Output directory", DEFAULT_DATASETS_DIR)
  .option("--limit <n>", "Maximum number of examples to gather", "500")
  .action(async (opts: { source: string; output: string; limit: string }) => {
    const validSources = ["todos", "mementos", "conversations", "sessions", "all"];
    if (!validSources.includes(opts.source)) {
      printError(`Invalid source: ${opts.source}. Choose one of: ${validSources.join(", ")}`);
      process.exit(1);
    }

    const limit = parseInt(opts.limit, 10);
    if (isNaN(limit) || limit <= 0) {
      printError(`Invalid --limit value: ${opts.limit}`);
      process.exit(1);
    }

    try {
      mkdirSync(opts.output, { recursive: true });

      // Dynamically import gatherers — they may depend on external MCPs
      const sources = opts.source === "all"
        ? ["todos", "mementos", "conversations", "sessions"]
        : [opts.source];

      let totalExamples = 0;
      const now = Date.now();
      const db = getDb();

      for (const source of sources) {
        printInfo(`Gathering from ${source} …`);
        try {
          const gathererPath = new URL(`../lib/gatherers/${source}.js`, import.meta.url);
          const mod = await import(gathererPath.pathname).catch(() => null);
          if (!mod || typeof mod.gather !== "function") {
            printInfo(`  No gatherer found for source '${source}', skipping.`);
            continue;
          }

          const result = await mod.gather({ limit, outputDir: opts.output });
          const count: number = result?.count ?? 0;
          const examples: unknown[] = result?.examples ?? [];
          totalExamples += count;

          if (count === 0) {
            printInfo(`  No examples gathered from ${source}.`);
            continue;
          }

          // Write JSONL
          const fileName = `${source}-${now}.jsonl`;
          const filePath = join(opts.output, fileName);
          writeFileSync(
            filePath,
            examples.map((e) => JSON.stringify(e)).join("\n") + "\n",
            "utf8"
          );

          // Record in DB
          const datasetId = randomUUID();
          await db.insert(trainingDatasets).values({
            id: datasetId,
            source: source as "todos" | "mementos" | "conversations" | "sessions" | "mixed",
            filePath,
            exampleCount: count,
            createdAt: now,
          });

          printSuccess(`  ${count} examples → ${filePath}`);
        } catch (innerErr) {
          printError(
            `  Failed to gather from ${source}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`
          );
        }
      }

      console.log();
      printSuccess(`Total examples gathered: ${totalExamples}`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

dataCmd
  .command("preview <file>")
  .description("Preview a JSONL training file")
  .option("-n, --count <n>", "Number of examples to show", "5")
  .action((file: string, opts: { count: string }) => {
    if (!existsSync(file)) {
      printError(`File not found: ${file}`);
      process.exit(1);
    }

    const n = parseInt(opts.count, 10);
    if (isNaN(n) || n <= 0) {
      printError(`Invalid --count value: ${opts.count}`);
      process.exit(1);
    }

    try {
      const content = readFileSync(file, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      const total = lines.length;
      const preview = lines.slice(0, n);

      console.log();
      printInfo(`File: ${file}`);
      printInfo(`Total examples: ${total}`);
      printInfo(`Showing first ${Math.min(n, total)}:`);
      console.log();

      preview.forEach((line, idx) => {
        try {
          const parsed = JSON.parse(line);
          console.log(`─── Example ${idx + 1} ───`);
          printJson(parsed);
          console.log();
        } catch {
          printError(`  Line ${idx + 1} is not valid JSON: ${line.slice(0, 80)}…`);
        }
      });
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

dataCmd
  .command("list")
  .description("List all gathered datasets")
  .action(async () => {
    try {
      const db = getDb();
      const datasets = await db.select().from(trainingDatasets);
      if (datasets.length === 0) {
        printInfo("No datasets found. Use 'brains data gather' to create one.");
        return;
      }
      printTable(
        ["ID", "Source", "Examples", "File", "Created"],
        datasets.map((d) => [
          d.id,
          d.source,
          String(d.exampleCount),
          d.filePath ?? "",
          new Date(d.createdAt).toISOString().split("T")[0] ?? "",
        ])
      );
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
