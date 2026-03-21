#!/usr/bin/env bun
// brains CLI entry point

import { Command } from "commander";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getDb, fineTunedModels, trainingJobs, trainingDatasets } from "../db/index.js";
import * as openaiProvider from "../lib/providers/openai.js";
import { ThinkerLabsProvider } from "../lib/providers/thinker-labs.js";
import { printTable, printStatus, printJson, printError, printSuccess, printInfo } from "./ui.js";
import { gatherAll } from "../lib/gatherers/index.js";

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
        ["ID", "Display Name", "Provider", "Status", "Collection", "Base Model"],
        models.map((m) => [
          m.id,
          m.displayName ?? m.name,
          m.provider,
          printStatus(m.status),
          m.collection ?? "",
          m.baseModel,
        ])
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
      const tagsList = model.tags ? (JSON.parse(model.tags) as string[]).join(", ") : "(none)";
      console.log(`  ID:            ${model.id}`);
      console.log(`  Name:          ${model.name}`);
      console.log(`  Display Name:  ${model.displayName ?? "(none)"}`);
      console.log(`  Description:   ${model.description ?? "(none)"}`);
      console.log(`  Collection:    ${model.collection ?? "(none)"}`);
      console.log(`  Tags:          ${tagsList}`);
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

modelsCmd
  .command("rename <id> <displayName>")
  .description("Set the display name of a model")
  .action(async (id: string, displayName: string) => {
    try {
      const db = getDb();
      await db
        .update(fineTunedModels)
        .set({ displayName, updatedAt: Date.now() })
        .where(eq(fineTunedModels.id, id));
      printSuccess(`Display name set to "${displayName}"`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command("describe <id> <description>")
  .description("Set the description of a model")
  .action(async (id: string, description: string) => {
    try {
      const db = getDb();
      await db
        .update(fineTunedModels)
        .set({ description, updatedAt: Date.now() })
        .where(eq(fineTunedModels.id, id));
      printSuccess(`Description updated.`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command("tag <id> <tag>")
  .description("Add a tag to a model")
  .action(async (id: string, tag: string) => {
    try {
      const db = getDb();
      const [model] = await db.select().from(fineTunedModels).where(eq(fineTunedModels.id, id));
      if (!model) {
        printError(`Model not found: ${id}`);
        process.exit(1);
      }
      const existing: string[] = model.tags ? (JSON.parse(model.tags) as string[]) : [];
      if (!existing.includes(tag)) {
        existing.push(tag);
      }
      await db
        .update(fineTunedModels)
        .set({ tags: JSON.stringify(existing), updatedAt: Date.now() })
        .where(eq(fineTunedModels.id, id));
      printSuccess(`Tag "${tag}" added. Tags: ${existing.join(", ")}`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command("untag <id> <tag>")
  .description("Remove a tag from a model")
  .action(async (id: string, tag: string) => {
    try {
      const db = getDb();
      const [model] = await db.select().from(fineTunedModels).where(eq(fineTunedModels.id, id));
      if (!model) {
        printError(`Model not found: ${id}`);
        process.exit(1);
      }
      const existing: string[] = model.tags ? (JSON.parse(model.tags) as string[]) : [];
      const updated = existing.filter((t) => t !== tag);
      await db
        .update(fineTunedModels)
        .set({ tags: JSON.stringify(updated), updatedAt: Date.now() })
        .where(eq(fineTunedModels.id, id));
      printSuccess(`Tag "${tag}" removed. Tags: ${updated.join(", ") || "(none)"}`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelsCmd
  .command("collection <id> <collectionName>")
  .description("Set the collection of a model")
  .action(async (id: string, collectionName: string) => {
    try {
      const db = getDb();
      await db
        .update(fineTunedModels)
        .set({ collection: collectionName, updatedAt: Date.now() })
        .where(eq(fineTunedModels.id, id));
      printSuccess(`Collection set to "${collectionName}"`);
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

      const sources =
        opts.source === "all"
          ? ["todos", "mementos", "conversations", "sessions"]
          : [opts.source];

      const now = Date.now();
      const db = getDb();

      // Use gatherAll which correctly routes to gatherFromTodos, gatherFromMementos, etc.
      const results = await gatherAll(sources, { limit });

      let totalExamples = 0;
      for (const result of results) {
        const { source, examples, count } = result;
        printInfo(`Gathered from ${source} …`);

        if (count === 0) {
          printInfo(`  No examples gathered from ${source}.`);
          continue;
        }

        totalExamples += count;

        // Write JSONL
        const fileName = `${source}-${now}.jsonl`;
        const filePath = join(opts.output, fileName);
        writeFileSync(
          filePath,
          examples.map((e) => JSON.stringify(e)).join('\n') + '\n',
          'utf8'
        );

        // Record in DB
        const datasetId = randomUUID();
        await db.insert(trainingDatasets).values({
          id: datasetId,
          source: source as 'todos' | 'mementos' | 'conversations' | 'sessions' | 'mixed',
          filePath,
          exampleCount: count,
          createdAt: now,
        });

        printSuccess(`  ${count} examples → ${filePath}`);
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

// ── collections ───────────────────────────────────────────────────────────────

const collectionsCmd = program.command("collections").description("Manage model collections");

// brains collections (no subcommand) → list
collectionsCmd.action(async () => {
  await listCollections();
});

async function listCollections() {
  try {
    const db = getDb();
    const rows = await db
      .select({
        collection: fineTunedModels.collection,
        count: sql<number>`count(*)`.as("count"),
        names: sql<string>`group_concat(coalesce(${fineTunedModels.displayName}, ${fineTunedModels.name}), ', ')`.as("names"),
      })
      .from(fineTunedModels)
      .groupBy(fineTunedModels.collection);

    if (rows.length === 0) {
      printInfo("No collections found. Set a collection with 'brains models set-collection'.");
      return;
    }

    printTable(
      ["Collection", "Model Count", "Models"],
      rows.map((r) => [
        r.collection ?? "(none)",
        String(r.count),
        r.names ?? "",
      ])
    );
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

collectionsCmd
  .command("list")
  .description("List all collections with model counts")
  .action(async () => {
    await listCollections();
  });

collectionsCmd
  .command("show <name>")
  .description("List all models in a collection")
  .action(async (name: string) => {
    try {
      const db = getDb();
      const models = await db
        .select()
        .from(fineTunedModels)
        .where(eq(fineTunedModels.collection, name));

      if (models.length === 0) {
        printInfo(`No models found in collection '${name}'.`);
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

collectionsCmd
  .command("rename <oldName> <newName>")
  .description("Rename a collection across all models")
  .action(async (oldName: string, newName: string) => {
    try {
      const db = getDb();
      // Count first, then update
      const affected = await db
        .select({ id: fineTunedModels.id })
        .from(fineTunedModels)
        .where(eq(fineTunedModels.collection, oldName));
      const count = affected.length;
      await db
        .update(fineTunedModels)
        .set({ collection: newName, updatedAt: Date.now() })
        .where(eq(fineTunedModels.collection, oldName));
      printSuccess(`Renamed collection '${oldName}' → '${newName}' (${count} models updated)`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ── remove/uninstall ─────────────────────────────────────────────────────────

program
  .command("remove <id>")
  .alias("rm")
  .alias("uninstall")
  .description("Remove a fine-tuned model or training job by ID")
  .option("--type <type>", "Type: model | job (default: auto-detect)")
  .action(async (id: string, opts) => {
    const db = getDb();
    try {
      const type = opts.type?.toLowerCase();
      if (type === "job" || (!type && !type)) {
        // Try to delete as training job first if no type specified
        const job = db.select().from(trainingJobs).where(eq(trainingJobs.id, id)).get();
        if (job || type === "job") {
          if (!job) { printError(`Job not found: ${id}`); process.exit(1); }
          db.delete(trainingJobs).where(eq(trainingJobs.id, id)).run();
          printSuccess(`Training job ${id} removed`);
          return;
        }
      }
      if (type === "model" || !type) {
        const model = db.select().from(fineTunedModels).where(eq(fineTunedModels.id, id)).get();
        if (model) {
          db.delete(fineTunedModels).where(eq(fineTunedModels.id, id)).run();
          printSuccess(`Model ${id} removed`);
          return;
        }
      }
      printError(`Not found: ${id}. Use --type model|job`);
      process.exit(1);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
