#!/usr/bin/env bun
// brains CLI entry point

import { Command } from "commander";
import { eq, sql, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getDb, getRawDb, fineTunedModels, trainingJobs, trainingDatasets } from "../db/index.js";
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
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      const db = getDb();
      const models = await db.select().from(fineTunedModels);
      if (opts.json) { printJson(models); return; }
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
  .option("--json", "Output as JSON")
  .action(async (id: string, opts: { json?: boolean }) => {
    try {
      const db = getDb();
      const [model] = await db
        .select()
        .from(fineTunedModels)
        .where(eq(fineTunedModels.id, id));
      if (!model) {
        if (opts.json) { printJson({ error: `Model not found: ${id}` }); } else { printError(`Model not found: ${id}`); }
        process.exit(1);
      }
      if (opts.json) { printJson(model); return; }
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

modelsCmd
  .command("import <job-id>")
  .description("Import an externally created fine-tuned model into local tracking")
  .option("--provider <provider>", "Provider (openai|thinker-labs)", "openai")
  .option("--name <name>", "Display name for the model")
  .action(async (jobId: string, opts: { provider: string; name?: string }) => {
    try {
      let result: { jobId: string; status: string; fineTunedModel?: string; baseModel?: string; error?: string };
      if (opts.provider === "openai") {
        result = await openaiProvider.getFineTuneStatus(jobId);
      } else {
        const tl = new ThinkerLabsProvider();
        result = await tl.getFineTuneStatus(jobId);
      }

      const db = getDb();
      // Check if already imported
      const [existing] = await db
        .select()
        .from(fineTunedModels)
        .where(eq(fineTunedModels.fineTuneJobId, jobId));
      if (existing) {
        printInfo(`Model already tracked as: ${existing.id}`);
        return;
      }

      const modelId = randomUUID();
      const now = Date.now();
      const name = opts.name ?? result.fineTunedModel ?? `imported-${jobId}`;

      await db.insert(fineTunedModels).values({
        id: modelId,
        name,
        provider: opts.provider as "openai" | "thinker-labs",
        baseModel: result.baseModel ?? "unknown",
        status: result.status as "pending" | "running" | "succeeded" | "failed" | "cancelled",
        fineTuneJobId: jobId,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(trainingJobs).values({
        id: randomUUID(),
        modelId,
        provider: opts.provider,
        status: result.status,
        startedAt: now,
      });

      printSuccess(`Model imported successfully.`);
      console.log();
      console.log(`  Local ID:  ${modelId}`);
      console.log(`  Job ID:    ${jobId}`);
      console.log(`  Name:      ${name}`);
      console.log(`  Status:    ${printStatus(result.status)}`);
      if (result.fineTunedModel) console.log(`  Model:     ${result.fineTunedModel}`);
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
  .option("--dataset <path>", "Path to the JSONL training dataset (auto-detects latest if omitted)")
  .requiredOption("--name <name>", "Human-readable name for this fine-tuned model")
  .action(async (opts: { provider: string; baseModel: string; dataset?: string; name: string }) => {
    try {
      if (opts.provider !== "openai" && opts.provider !== "thinker-labs") {
        printError(`Unknown provider: ${opts.provider}. Use 'openai' or 'thinker-labs'.`);
        process.exit(1);
      }

      // Auto-detect latest dataset if not provided
      let datasetPath = opts.dataset;
      if (!datasetPath) {
        const db = getDb();
        const [latest] = await db
          .select()
          .from(trainingDatasets)
          .orderBy(desc(trainingDatasets.createdAt))
          .limit(1);
        if (!latest?.filePath) {
          printError("No datasets found. Run 'brains data gather' first.");
          process.exit(1);
        }
        datasetPath = latest.filePath;
        printInfo(`Using latest dataset: ${datasetPath} (${latest.exampleCount} examples)`);
      }

      if (!existsSync(datasetPath)) {
        printError(`Dataset file not found: ${datasetPath}`);
        process.exit(1);
      }

      printInfo(`Uploading training file: ${datasetPath} …`);
      let fileId: string;
      let jobId: string;
      let jobStatus: string;

      if (opts.provider === "openai") {
        ({ fileId } = await openaiProvider.uploadTrainingFile(datasetPath));
        printSuccess(`File uploaded. fileId = ${fileId}`);
        printInfo(`Creating fine-tune job on OpenAI …`);
        ({ jobId, status: jobStatus } = await openaiProvider.createFineTuneJob(
          fileId,
          opts.baseModel,
          opts.name
        ));
      } else {
        const tl = new ThinkerLabsProvider();
        ({ fileId } = await tl.uploadTrainingFile(datasetPath));
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
  .option("--json", "Output as JSON")
  .action(async (jobId: string, opts: { provider: string; json?: boolean }) => {
    try {
      let result: { jobId: string; status: string; fineTunedModel?: string; baseModel?: string; error?: string };

      if (opts.provider === "openai") {
        result = await openaiProvider.getFineTuneStatus(jobId);
      } else {
        const tl = new ThinkerLabsProvider();
        result = await tl.getFineTuneStatus(jobId);
      }

      if (opts.json) { printJson(result); } else {
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
      }

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
  .command("watch <job-id>")
  .description("Poll a fine-tuning job until it completes or fails")
  .option("--provider <provider>", "Provider (openai|thinker-labs)", "openai")
  .option("--interval <seconds>", "Poll interval in seconds", "30")
  .action(async (jobId: string, opts: { provider: string; interval: string }) => {
    const intervalMs = Math.max(5, parseInt(opts.interval, 10) || 30) * 1000;
    const terminalStates = new Set(["succeeded", "failed", "cancelled"]);

    printInfo(`Watching job ${jobId} (polling every ${intervalMs / 1000}s) …`);
    console.log();

    const poll = async (): Promise<boolean> => {
      try {
        let result: { jobId: string; status: string; fineTunedModel?: string; error?: string };
        if (opts.provider === "openai") {
          result = await openaiProvider.getFineTuneStatus(jobId);
        } else {
          const tl = new ThinkerLabsProvider();
          result = await tl.getFineTuneStatus(jobId);
        }

        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        process.stdout.write(`  [${ts}]  ${printStatus(result.status)}`);
        if (result.fineTunedModel) process.stdout.write(`  model: ${result.fineTunedModel}`);
        process.stdout.write("\n");

        // Update DB if we have a record
        const db = getDb();
        const [model] = await db
          .select()
          .from(fineTunedModels)
          .where(eq(fineTunedModels.fineTuneJobId, jobId));
        if (model) {
          await db
            .update(fineTunedModels)
            .set({ status: result.status as typeof model.status, updatedAt: Date.now() })
            .where(eq(fineTunedModels.fineTuneJobId, jobId));
        }

        if (terminalStates.has(result.status)) {
          console.log();
          if (result.status === "succeeded") {
            printSuccess(`Job completed successfully.`);
            if (result.fineTunedModel) printSuccess(`Fine-tuned model: ${result.fineTunedModel}`);
          } else if (result.status === "failed") {
            printError(`Job failed.${result.error ? " Error: " + result.error : ""}`);
          } else {
            printInfo(`Job ${result.status}.`);
          }
          return true;
        }
        return false;
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        return false;
      }
    };

    // Poll immediately, then on interval
    const done = await poll();
    if (!done) {
      await new Promise<void>((resolve) => {
        const timer = setInterval(async () => {
          const finished = await poll();
          if (finished) {
            clearInterval(timer);
            resolve();
          }
        }, intervalMs);
      });
    }
  });

finetuneCmd
  .command("list")
  .description("List all fine-tuning jobs")
  .option("--provider <provider>", "Provider to query (openai|thinker-labs)", "openai")
  .option("--json", "Output as JSON")
  .action(async (opts: { provider: string; json?: boolean }) => {
    try {
      let jobs: Array<{ id: string; model: string; status: string; created: number }>;

      if (opts.provider === "openai") {
        jobs = await openaiProvider.listFineTunedModels();
      } else {
        const tl = new ThinkerLabsProvider();
        jobs = await tl.listFineTunedModels();
      }

      if (opts.json) { printJson(jobs); return; }
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

const DEFAULT_DATASETS_DIR = join(homedir(), ".hasna", "brains", "datasets");

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

      // Gather sequentially so we can print per-source progress
      const gathererMap: Record<string, (opts: { limit: number }) => Promise<{ examples: { messages: unknown[] }[]; count: number }>> = {
        todos: (o) => import("../lib/gatherers/todos.js").then(m => m.gatherFromTodos(o)),
        mementos: (o) => import("../lib/gatherers/mementos.js").then(m => m.gatherFromMementos(o)),
        conversations: (o) => import("../lib/gatherers/conversations.js").then(m => m.gatherFromConversations(o)),
        sessions: (o) => import("../lib/gatherers/sessions.js").then(m => m.gatherFromSessions(o)),
      };

      let totalExamples = 0;
      let successfulSources = 0;

      for (const source of sources) {
        printInfo(`Gathering from ${source} …`);
        try {
          const gatherer = gathererMap[source];
          if (!gatherer) { printError(`  Unknown source: ${source}`); continue; }

          const { examples, count } = await gatherer({ limit });

          if (count === 0) {
            printInfo(`  No examples found in ${source}.`);
            continue;
          }

          // Write JSONL
          const fileName = `${source}-${now}.jsonl`;
          const filePath = join(opts.output, fileName);
          writeFileSync(filePath, examples.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

          // Record in DB
          await db.insert(trainingDatasets).values({
            id: randomUUID(),
            source: source as 'todos' | 'mementos' | 'conversations' | 'sessions' | 'mixed',
            filePath,
            exampleCount: count,
            createdAt: now,
          });

          printSuccess(`  ✓ ${count} examples → ${filePath}`);
          totalExamples += count;
          successfulSources++;
        } catch (sourceErr) {
          printError(`  ✗ ${source}: ${sourceErr instanceof Error ? sourceErr.message : String(sourceErr)}`);
        }
      }

      console.log();
      printSuccess(`Total: ${totalExamples} examples from ${successfulSources} source(s)`);
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
  .command("merge <files...>")
  .description("Merge multiple JSONL datasets into one")
  .option(
    "--output <path>",
    "Output file path",
    join(DEFAULT_DATASETS_DIR, `merged-${Date.now()}.jsonl`)
  )
  .option("--no-dedupe", "Skip deduplication")
  .action(async (files: string[], opts: { output: string; dedupe: boolean }) => {
    try {
      // Validate all input files exist
      for (const f of files) {
        if (!existsSync(f)) {
          printError(`File not found: ${f}`);
          process.exit(1);
        }
      }

      mkdirSync(join(opts.output, "..").replace(/\/\.\.$/, "") || DEFAULT_DATASETS_DIR, { recursive: true });

      const allExamples: string[] = [];
      for (const f of files) {
        const lines = readFileSync(f, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        allExamples.push(...lines);
        printInfo(`  Read ${lines.length} examples from ${f}`);
      }

      let finalLines = allExamples;
      let dupeCount = 0;

      if (opts.dedupe) {
        const seen = new Set<string>();
        finalLines = allExamples.filter((line) => {
          if (seen.has(line)) { dupeCount++; return false; }
          seen.add(line);
          return true;
        });
      }

      writeFileSync(opts.output, finalLines.join("\n") + "\n", "utf8");

      // Record in DB
      const db = getDb();
      await db.insert(trainingDatasets).values({
        id: randomUUID(),
        source: "mixed",
        filePath: opts.output,
        exampleCount: finalLines.length,
        createdAt: Date.now(),
      });

      console.log();
      printSuccess(`Merged ${files.length} files — ${finalLines.length} examples → ${opts.output}`);
      if (opts.dedupe && dupeCount > 0) printInfo(`  Removed ${dupeCount} duplicate(s)`);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

dataCmd
  .command("list")
  .description("List all gathered datasets")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      const db = getDb();
      const datasets = await db.select().from(trainingDatasets);
      if (opts.json) { printJson(datasets); return; }
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
collectionsCmd
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await listCollections(opts.json);
  });

async function listCollections(json = false) {
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

    if (json) { printJson(rows); return; }
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
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    await listCollections(opts.json);
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

// ── config ────────────────────────────────────────────────────────────────────

import { getConfigValue, setConfigValue, listConfig, deleteConfigValue, CONFIG_KEYS } from "../lib/config.js";
import type { ConfigKey } from "../lib/config.js";

const configCmd = program.command("config").description("Manage API keys and settings");

configCmd
  .command("list")
  .description("Show all config keys and their sources")
  .action(() => {
    const entries = listConfig();
    console.log();
    for (const { key, value, source } of entries) {
      const display = source === "unset"
        ? "(unset)"
        : value.length > 8
          ? value.slice(0, 4) + "****" + value.slice(-4)
          : "****";
      const src = source === "env" ? " [env]" : source === "file" ? " [file]" : "";
      console.log(`  ${key.padEnd(28)} ${display}${src}`);
    }
    console.log();
  });

configCmd
  .command("get <key>")
  .description("Get a config value")
  .action((key: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    const value = getConfigValue(key as ConfigKey);
    if (!value) {
      printInfo(`${key} is not set.`);
    } else {
      console.log(value);
    }
  });

configCmd
  .command("set <key> <value>")
  .description("Set a config value (stored in ~/.hasna/brains/config.json)")
  .action((key: string, value: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    setConfigValue(key as ConfigKey, value);
    printSuccess(`${key} saved to ~/.hasna/brains/config.json`);
  });

configCmd
  .command("unset <key>")
  .description("Remove a config value from the config file")
  .action((key: string) => {
    if (!CONFIG_KEYS.includes(key as ConfigKey)) {
      printError(`Unknown key: ${key}. Valid keys: ${CONFIG_KEYS.join(", ")}`);
      process.exit(1);
    }
    deleteConfigValue(key as ConfigKey);
    printSuccess(`${key} removed from config.`);
  });

// ── feedback ─────────────────────────────────────────────────────────────────

const feedbackCmd = program.command("feedback").description("Feedback commands");

feedbackCmd
  .command("send <message>")
  .description("Send feedback about brains")
  .option("--email <email>", "Contact email")
  .action(async (message: string, opts: { email?: string }) => {
    const { sendFeedback } = await import("@hasna/cloud");
    const rawDb = getRawDb();
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../../package.json"), "utf8"));
    const result = await sendFeedback({ service: "brains", message, email: opts.email, version: pkg.version }, rawDb);
    rawDb.close();
    if (result.sent) {
      printSuccess("Feedback sent. Thank you!");
    } else {
      printSuccess("Feedback saved locally. Thank you!");
    }
  });

feedbackCmd
  .command("list")
  .description("List locally saved feedback")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const { listFeedback } = await import("@hasna/cloud");
    const rawDb = getRawDb();
    const entries = listFeedback(rawDb);
    rawDb.close();
    if (opts.json) { console.log(JSON.stringify(entries, null, 2)); return; }
    if (entries.length === 0) { printInfo("No feedback saved yet."); return; }
    printTable(
      ["ID", "Message", "Email", "Version", "Created"],
      entries.map((e) => [
        ((e as { id?: string }).id ?? "").slice(0, 8),
        (e.message ?? "").slice(0, 60),
        (e as { email?: string }).email ?? "",
        (e as { version?: string }).version ?? "",
        (e as { created_at?: string }).created_at ?? "",
      ])
    );
  });

// ── cloud ─────────────────────────────────────────────────────────────────────

const cloudCmd = program.command("cloud").description("Cloud sync commands");

cloudCmd
  .command("status")
  .description("Show cloud config and connection health")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      const { getCloudConfig, getConnectionString, PgAdapterAsync, SqliteAdapter, getDbPath, listSqliteTables, ensureConflictsTable, listConflicts } = await import("@hasna/cloud");
      const config = getCloudConfig();
      const info: Record<string, unknown> = {
        mode: config.mode,
        service: "brains",
        rds_host: config.rds?.host || "(not configured)",
      };

      if (config.rds?.host && config.rds?.username) {
        try {
          const pg = new PgAdapterAsync(getConnectionString("postgres"));
          await pg.get("SELECT 1 as ok");
          info.postgresql = "connected";
          await pg.close();
        } catch (err) {
          info.postgresql = `failed — ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      const local = new SqliteAdapter(getDbPath("brains"));
      const tables = listSqliteTables(local).filter((t: string) => !t.startsWith("_"));
      const syncHealth: Array<{ table: string; total: number; unsynced: number }> = [];
      for (const table of tables) {
        try {
          const totalRow = local.get(`SELECT COUNT(*) as c FROM "${table}"`) as { c: number } | null;
          const unsyncedRow = local.get(`SELECT COUNT(*) as c FROM "${table}" WHERE synced_at IS NULL`) as { c: number } | null;
          syncHealth.push({ table, total: totalRow?.c ?? 0, unsynced: unsyncedRow?.c ?? 0 });
        } catch { /* table may lack synced_at */ }
      }
      info.sync_health = syncHealth.filter((s) => s.total > 0);

      try {
        ensureConflictsTable(local);
        const unresolved = listConflicts(local, { resolved: false });
        info.conflicts_unresolved = unresolved.length;
      } catch { /* ignore */ }
      local.close();

      if (opts.json) { console.log(JSON.stringify(info, null, 2)); return; }

      printInfo(`Mode: ${info.mode}`);
      printInfo(`RDS Host: ${info.rds_host}`);
      if (info.postgresql) printInfo(`PostgreSQL: ${info.postgresql}`);
      for (const s of (info.sync_health as typeof syncHealth)) {
        const pct = s.total > 0 ? Math.round(((s.total - s.unsynced) / s.total) * 100) : 100;
        printInfo(`  ${s.table}: ${pct}% synced (${s.unsynced} unsynced / ${s.total} total)`);
      }
      if (info.conflicts_unresolved) printInfo(`Conflicts: ${info.conflicts_unresolved} unresolved`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

cloudCmd
  .command("push")
  .description("Push local data to cloud PostgreSQL")
  .option("--tables <tables>", "Comma-separated table names (default: all)")
  .option("--json", "Output as JSON")
  .action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const { getCloudConfig, getConnectionString, syncPush, listSqliteTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
      const config = getCloudConfig();
      if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

      const local = new SqliteAdapter(getDbPath("brains"));
      const cloud = new PgAdapterAsync(getConnectionString("brains"));
      const tableList = opts.tables
        ? opts.tables.split(",").map((t) => t.trim())
        : listSqliteTables(local).filter((t: string) => !t.startsWith("_"));

      const results = await syncPush(local, cloud, {
        tables: tableList,
        onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
          if (!opts.json && p.phase === "done") printInfo(`  ${p.table}: ${p.rowsWritten} rows pushed`);
        },
      });

      local.close();
      await cloud.close();
      const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
      if (opts.json) { console.log(JSON.stringify({ total, tables: results })); return; }
      printSuccess(`Done. ${total} rows pushed.`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

cloudCmd
  .command("pull")
  .description("Pull cloud data to local — merges by primary key")
  .option("--tables <tables>", "Comma-separated table names (default: all)")
  .option("--json", "Output as JSON")
  .action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const { getCloudConfig, getConnectionString, syncPull, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
      const config = getCloudConfig();
      if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

      const local = new SqliteAdapter(getDbPath("brains"));
      const cloud = new PgAdapterAsync(getConnectionString("brains"));
      const tableList = opts.tables
        ? opts.tables.split(",").map((t) => t.trim())
        : (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));

      const results = await syncPull(cloud, local, {
        tables: tableList,
        onProgress: (p: { phase: string; table: string; rowsWritten: number }) => {
          if (!opts.json && p.phase === "done") printInfo(`  ${p.table}: ${p.rowsWritten} rows pulled`);
        },
      });

      local.close();
      await cloud.close();
      const total = results.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
      if (opts.json) { console.log(JSON.stringify({ total, tables: results })); return; }
      printSuccess(`Done. ${total} rows pulled.`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

cloudCmd
  .command("sync")
  .description("Bidirectional sync — pull then push")
  .option("--tables <tables>", "Comma-separated table names (default: all)")
  .option("--json", "Output as JSON")
  .action(async (opts: { tables?: string; json?: boolean }) => {
    try {
      const { getCloudConfig, getConnectionString, syncPush, syncPull, listSqliteTables, listPgTables, SqliteAdapter, PgAdapterAsync, getDbPath } = await import("@hasna/cloud");
      const config = getCloudConfig();
      if (config.mode === "local") { printError("Cloud mode not configured."); process.exit(1); }

      const local = new SqliteAdapter(getDbPath("brains"));
      const cloud = new PgAdapterAsync(getConnectionString("brains"));

      const localTables = listSqliteTables(local).filter((t: string) => !t.startsWith("_"));
      const remoteTables = (await listPgTables(cloud)).filter((t: string) => !t.startsWith("_"));
      const tableList = opts.tables
        ? opts.tables.split(",").map((t) => t.trim())
        : [...new Set([...localTables, ...remoteTables])];

      const pullResults = await syncPull(cloud, local, { tables: tableList.filter((t) => remoteTables.includes(t)) });
      const pushResults = await syncPush(local, cloud, { tables: tableList.filter((t) => localTables.includes(t)) });

      local.close();
      await cloud.close();
      const pulled = pullResults.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
      const pushed = pushResults.reduce((s: number, r: { rowsWritten: number }) => s + r.rowsWritten, 0);
      if (opts.json) { console.log(JSON.stringify({ pulled, pushed })); return; }
      printSuccess(`Sync done. Pulled ${pulled} rows, pushed ${pushed} rows.`);
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

cloudCmd
  .command("migrate-pg")
  .description("Apply PostgreSQL migrations to the cloud database")
  .requiredOption("--connection-string <connStr>", "PostgreSQL connection string")
  .option("--json", "Output as JSON")
  .action(async (opts: { connectionString: string; json?: boolean }) => {
    try {
      const { applyPgMigrations } = await import("../db/pg-migrate.js");
      const result = await applyPgMigrations(opts.connectionString);
      if (opts.json) { console.log(JSON.stringify(result)); return; }
      printSuccess(`Applied ${result.applied.length} migration(s), skipped ${result.alreadyApplied.length}.`);
      if (result.errors.length > 0) { printError(result.errors.join("\n")); process.exit(1); }
    } catch (e) {
      printError(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program.parse();
