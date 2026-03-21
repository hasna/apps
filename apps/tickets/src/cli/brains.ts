// tickets brains — fine-tuning CLI subcommand for @hasna/tickets

import { Command } from "commander";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { gatherTrainingData } from "../lib/gatherer.ts";
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from "../lib/model-config.ts";

export function registerBrainsCommand(program: Command): void {
  const brainsCmd = program
    .command("brains")
    .description("Fine-tune an AI model on your tickets data");

  // ── gather ──────────────────────────────────────────────────────────────────

  brainsCmd
    .command("gather")
    .description("Gather training data from tickets and write to ~/.tickets/training/")
    .option("--limit <n>", "Maximum number of training examples", "500")
    .option("--output <path>", "Output file path (default: ~/.tickets/training/training-<timestamp>.jsonl)")
    .action(async (opts: { limit?: string; output?: string }) => {
      const limit = opts.limit ? parseInt(opts.limit, 10) : 500;
      console.log(`Gathering up to ${limit} training examples from tickets...`);

      try {
        const result = await gatherTrainingData({ limit });

        if (result.count === 0) {
          console.log("No training examples found. Make sure you have tickets in your database.");
          console.log("Run: tickets project add <name> && tickets open <title>");
          return;
        }

        // Determine output path
        const defaultDir = join(homedir(), ".tickets", "training");
        await mkdir(defaultDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = opts.output ?? join(defaultDir, `training-${timestamp}.jsonl`);

        // Write JSONL
        const jsonl = result.examples.map((ex) => JSON.stringify(ex)).join("\n");
        await writeFile(outputPath, jsonl, "utf-8");

        console.log(`✓ Gathered ${result.count} training examples`);
        console.log(`  Written to: ${outputPath}`);
        console.log(`\nNext step: tickets brains train --base-model gpt-4o-mini`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ── train ───────────────────────────────────────────────────────────────────

  brainsCmd
    .command("train")
    .description("Start a fine-tuning job using gathered training data")
    .option("--base-model <model>", "Base model to fine-tune", "gpt-4o-mini")
    .option("--name <name>", "Name for the fine-tuned model", "tickets-assistant")
    .option("--dataset <path>", "Path to JSONL training file (default: latest in ~/.tickets/training/)")
    .action(async (opts: { baseModel?: string; name?: string; dataset?: string }) => {
      const baseModel = opts.baseModel ?? "gpt-4o-mini";
      const name = opts.name ?? "tickets-assistant";

      console.log(`Starting fine-tuning job...`);
      console.log(`  Base model: ${baseModel}`);
      console.log(`  Name: ${name}`);

      // Resolve dataset path
      let datasetPath = opts.dataset;
      if (!datasetPath) {
        const { readdirSync } = await import("fs");
        const trainingDir = join(homedir(), ".tickets", "training");
        try {
          const files = readdirSync(trainingDir)
            .filter((f) => f.endsWith(".jsonl"))
            .sort()
            .reverse();
          if (files.length === 0) {
            console.error("No training data found. Run: tickets brains gather");
            process.exit(1);
          }
          datasetPath = join(trainingDir, files[0]!);
          console.log(`  Dataset: ${datasetPath}`);
        } catch {
          console.error("Training directory not found. Run: tickets brains gather");
          process.exit(1);
        }
      }

      try {
        // @ts-ignore — optional peer dependency
        const brains = await import("@hasna/brains") as Record<string, unknown>;
        const startFinetune = brains["startFinetune"] ?? brains["start_finetune"];
        if (typeof startFinetune !== "function") {
          console.error("@hasna/brains not found or startFinetune not exported.");
          console.error("Install with: bun add @hasna/brains");
          process.exit(1);
        }

        const job = await (startFinetune as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
          provider: "openai",
          baseModel,
          name,
          dataset: datasetPath,
        });

        const jobId = job["id"] ?? job["fine_tune_job_id"] ?? job["jobId"];
        console.log(`✓ Fine-tuning job started: ${String(jobId ?? "unknown")}`);
        console.log(`\nCheck status: tickets brains status ${String(jobId ?? "")}`);
        console.log(`When complete, set model: tickets brains model set <model-id>`);
      } catch (e) {
        console.error(`Error starting fine-tune: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ── model ───────────────────────────────────────────────────────────────────

  const modelCmd = brainsCmd
    .command("model")
    .description("View or set the active fine-tuned model")
    .action(() => {
      const active = getActiveModel();
      const isDefault = active === DEFAULT_MODEL;
      console.log(`Active model: ${active}${isDefault ? " (default)" : " (fine-tuned)"}`);
      if (isDefault) {
        console.log(`\nTo set a fine-tuned model: tickets brains model set <model-id>`);
      }
    });

  modelCmd
    .command("set <id>")
    .description("Set the active fine-tuned model ID")
    .action((id: string) => {
      setActiveModel(id);
      console.log(`✓ Active model set to: ${id}`);
      console.log(`  Tickets AI features will now use this model.`);
    });

  modelCmd
    .command("clear")
    .description(`Reset to default model (${DEFAULT_MODEL})`)
    .action(() => {
      clearActiveModel();
      console.log(`✓ Active model cleared, using default: ${DEFAULT_MODEL}`);
    });

  // ── status ──────────────────────────────────────────────────────────────────

  brainsCmd
    .command("status [job-id]")
    .description("Check the status of a fine-tuning job")
    .option("--provider <provider>", "Provider: openai|thinker-labs", "openai")
    .action(async (jobId: string | undefined, opts: { provider?: string }) => {
      if (!jobId) {
        console.error("Usage: tickets brains status <job-id>");
        process.exit(1);
      }

      try {
        // @ts-ignore — optional peer dependency
        const brains = await import("@hasna/brains") as Record<string, unknown>;
        const getFinetuneStatus = brains["getFinetuneStatus"] ?? brains["get_finetune_status"];
        if (typeof getFinetuneStatus !== "function") {
          console.error("@hasna/brains not installed. Run: bun add @hasna/brains");
          process.exit(1);
        }

        const status = await (getFinetuneStatus as (opts: Record<string, unknown>) => Promise<Record<string, unknown>>)({
          jobId,
          provider: opts.provider ?? "openai",
        });

        console.log(`Job ${jobId}:`);
        console.log(`  Status: ${String(status["status"] ?? "unknown")}`);
        if (status["fine_tuned_model"]) {
          console.log(`  Fine-tuned model: ${String(status["fine_tuned_model"])}`);
          console.log(`\nSet it active: tickets brains model set ${String(status["fine_tuned_model"])}`);
        }
        if (status["error"]) {
          console.log(`  Error: ${String(status["error"])}`);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
