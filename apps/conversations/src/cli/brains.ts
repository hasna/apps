import { Command } from "commander";
import chalk from "chalk";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { gatherTrainingData } from "../lib/gatherer.js";
import { getActiveModel, setActiveModel, clearActiveModel, DEFAULT_MODEL } from "../lib/model-config.js";
import { getDataDir } from "../lib/db.js";
import { printErrorLine, printJsonLine, printLine } from "../lib/stdout.js";

export function registerBrainsCommand(program: Command): void {
  const brains = program
    .command("brains")
    .description("Training data and fine-tuning model management");

  // ---- gather ----
  brains
    .command("gather")
    .description("Gather training data from conversations and write JSONL")
    .option("--limit <n>", "Max number of examples", parseInt)
    .option("--since <iso>", "Only include messages after this ISO timestamp")
    .option("--output <path>", "Output JSONL file path")
    .option("--json", "Output stats as JSON")
    .action(async (opts: { limit?: number; since?: string; output?: string; json?: boolean }) => {
      try {
        const since = opts.since ? new Date(opts.since) : undefined;
        const result = await gatherTrainingData({ limit: opts.limit, since });

        const outputDir = join(getDataDir(), "training");
        mkdirSync(outputDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = opts.output ?? join(outputDir, `training-${timestamp}.jsonl`);

        const jsonl = result.examples.map((ex) => JSON.stringify(ex)).join("\n");
        writeFileSync(outputPath, jsonl, "utf-8");

        if (opts.json) {
          printJsonLine({ path: outputPath, count: result.count, source: result.source });
        } else {
          printLine(chalk.green(`Gathered ${result.count} training examples`));
          printLine(chalk.dim(`  Written to: ${outputPath}`));
        }
      } catch (err) {
        printErrorLine(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  // ---- train ----
  brains
    .command("train")
    .description("Start a fine-tuning job using the brains CLI")
    .option("--base-model <model>", "Base model to fine-tune", "gpt-4o-mini")
    .option("--dataset <path>", "Path to JSONL dataset (uses latest gathered if omitted)")
    .option("--name <name>", "Job name")
    .option("--provider <provider>", "Provider: openai or thinker-labs", "openai")
    .action((opts: { baseModel: string; dataset?: string; name?: string; provider: string }) => {
      const args = [
        "finetune", "start",
        "--provider", opts.provider,
        "--base-model", opts.baseModel,
        "--name", opts.name ?? `conversations-finetune-${Date.now()}`,
      ];
      if (opts.dataset) {
        args.push("--dataset", opts.dataset);
      }

      printLine(chalk.dim(`Running: brains ${args.join(" ")}`));
      const result = spawnSync("brains", args, { stdio: "inherit" });
      if (result.status !== 0) {
        process.exit(result.status ?? 1);
      }
    });

  // ---- model ----
  const modelCmd = brains
    .command("model")
    .description("Manage the active fine-tuned model")
    .action(() => {
      const active = getActiveModel();
      if (active === DEFAULT_MODEL) {
        printLine(chalk.dim(`Active model: ${active} (default)`));
      } else {
        printLine(chalk.green(`Active model: ${active}`));
      }
    });

  modelCmd
    .command("set <id>")
    .description("Set the active fine-tuned model ID")
    .action((id: string) => {
      setActiveModel(id);
      printLine(chalk.green(`Active model set to: ${id}`));
    });

  modelCmd
    .command("clear")
    .description("Clear the active model, reverting to default")
    .action(() => {
      clearActiveModel();
      printLine(chalk.dim(`Active model cleared. Using default: ${DEFAULT_MODEL}`));
    });
}
