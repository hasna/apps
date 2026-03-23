// styles brains — Training data and fine-tuning subcommand.
// Subcommands: gather, train, model, model set

import { Command } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import chalk from "chalk";
import { gatherTrainingData } from "../lib/gatherer.js";
import {
  getActiveModel,
  setActiveModel,
  clearActiveModel,
  DEFAULT_MODEL,
} from "../lib/model-config.js";

const isTTY = (process.stdout.isTTY ?? false) && (process.stdin.isTTY ?? false);

function jsonOut(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function registerBrainsCommand(program: Command): void {
  const brainsCmd = program
    .command("brains")
    .description("Fine-tuning integration with @hasna/brains");

  // ── styles brains gather ──────────────────────────────────────────────────

  brainsCmd
    .command("gather")
    .description("Gather training data from styles profiles, preferences, and templates")
    .option("-l, --limit <n>", "Max number of training examples", "500")
    .option("-o, --output <dir>", "Output directory (default: ~/.styles/training/)")
    .action(async (opts: { limit?: string; output?: string }) => {
      const limit = parseInt(opts.limit ?? "500", 10);
      const outputDir = opts.output ?? join(homedir(), ".styles", "training");

      if (isTTY) {
        process.stdout.write(chalk.dim("Gathering training data from styles...\n"));
      }

      try {
        const result = await gatherTrainingData({ limit });

        // Write JSONL output
        await mkdir(outputDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = join(outputDir, `styles-training-${timestamp}.jsonl`);
        const jsonl = result.examples.map((ex) => JSON.stringify(ex)).join("\n");
        await writeFile(outputPath, jsonl, "utf-8");

        if (!isTTY) {
          jsonOut({
            ok: true,
            source: result.source,
            count: result.count,
            path: outputPath,
          });
          return;
        }

        console.log(chalk.green(`✔ Gathered ${result.count} training examples`));
        console.log(chalk.dim(`  Written to: ${outputPath}`));
        console.log(chalk.dim(`  Run: styles brains train --dataset ${outputPath}`));
      } catch (err) {
        if (isTTY) {
          console.error(chalk.red(`✖ Gather failed: ${(err as Error).message}`));
        } else {
          jsonOut({ error: (err as Error).message });
        }
        process.exit(1);
      }
    });

  // ── styles brains train ───────────────────────────────────────────────────

  brainsCmd
    .command("train")
    .description("Start a fine-tuning job using @hasna/brains")
    .option("--base-model <model>", "Base model to fine-tune", DEFAULT_MODEL)
    .option("--name <name>", "Name for the fine-tuned model", "styles-v1")
    .option("--dataset <path>", "Path to JSONL dataset (default: latest in ~/.styles/training/)")
    .option("--provider <provider>", "Provider: openai or thinker-labs", "openai")
    .action(async (opts: { baseModel: string; name: string; dataset?: string; provider: string }) => {
      if (isTTY) {
        console.log(chalk.dim("Starting fine-tune job..."));
        console.log(chalk.dim(`  Base model: ${opts.baseModel}`));
        console.log(chalk.dim(`  Name: ${opts.name}`));
        console.log(chalk.dim(`  Provider: ${opts.provider}`));
      }

      // Try to import @hasna/brains SDK
      let brains: Record<string, unknown>;
      try {
        // @ts-ignore — optional peer dependency
        brains = await import("@hasna/brains") as Record<string, unknown>;
      } catch {
        const msg =
          "@hasna/brains is not installed. Install it with:\n  bun add @hasna/brains\n\nThen re-run: styles brains train";
        if (isTTY) {
          console.error(chalk.yellow("⚠ " + msg));
        } else {
          jsonOut({ error: msg });
        }
        process.exit(1);
      }

      // Find dataset path
      let datasetPath = opts.dataset;
      if (!datasetPath) {
        // Use latest file in ~/.styles/training/
        const trainingDir = join(homedir(), ".styles", "training");
        try {
          const { readdirSync, statSync } = await import("fs");
          const files = readdirSync(trainingDir)
            .filter((f: string) => f.endsWith(".jsonl"))
            .map((f: string) => ({
              name: f,
              mtime: statSync(join(trainingDir, f)).mtimeMs,
            }))
            .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

          if (files.length === 0) {
            const msg = "No JSONL datasets found in ~/.styles/training/. Run: styles brains gather";
            if (isTTY) console.error(chalk.red("✖ " + msg));
            else jsonOut({ error: msg });
            process.exit(1);
          }

          datasetPath = join(trainingDir, (files[0] as { name: string }).name);
          if (isTTY) {
            console.log(chalk.dim(`  Dataset: ${datasetPath}`));
          }
        } catch {
          const msg =
            "Could not find a dataset. Run: styles brains gather --output <dir> first.";
          if (isTTY) console.error(chalk.red("✖ " + msg));
          else jsonOut({ error: msg });
          process.exit(1);
        }
      }

      try {
        // Attempt to call startFinetune if the SDK exposes it
        const startFn =
          typeof brains["startFinetune"] === "function"
            ? (brains["startFinetune"] as Function)
            : null;

        if (!startFn) {
          const msg =
            "@hasna/brains does not export startFinetune. Check the installed version.";
          if (isTTY) console.error(chalk.yellow("⚠ " + msg));
          else jsonOut({ error: msg });
          process.exit(1);
        }

        const job = await startFn({
          provider: opts.provider,
          baseModel: opts.baseModel,
          dataset: datasetPath,
          name: opts.name,
        });

        if (!isTTY) {
          jsonOut({ ok: true, job });
          return;
        }

        const j = job as Record<string, unknown>;
        console.log(chalk.green("✔ Fine-tune job started"));
        if (j["id"]) console.log(chalk.dim(`  Job ID: ${String(j["id"])}`));
        if (j["status"]) console.log(chalk.dim(`  Status: ${String(j["status"])}`));
        console.log(
          chalk.dim("\n  When complete, set the model with:") +
            chalk.cyan("\n  styles brains model set <model-id>")
        );
      } catch (err) {
        if (isTTY) console.error(chalk.red(`✖ ${(err as Error).message}`));
        else jsonOut({ error: (err as Error).message });
        process.exit(1);
      }
    });

  // ── styles brains model ───────────────────────────────────────────────────

  const modelCmd = brainsCmd
    .command("model")
    .description("Show or set the active fine-tuned model for styles")
    .action(() => {
      const active = getActiveModel();
      const isDefault = active === DEFAULT_MODEL;

      if (!isTTY) {
        jsonOut({ activeModel: active, isDefault });
        return;
      }

      console.log();
      console.log(chalk.bold("Active model: ") + chalk.cyan(active));
      if (isDefault) {
        console.log(chalk.dim("  (using default — no fine-tuned model set)"));
        console.log(chalk.dim("  Run: styles brains train  to create a fine-tuned model"));
        console.log(chalk.dim("  Then: styles brains model set <model-id>"));
      } else {
        console.log(chalk.dim("  (fine-tuned model)"));
        console.log(chalk.dim("  To reset to default: styles brains model clear"));
      }
      console.log();
    });

  modelCmd
    .command("set <id>")
    .description("Set the active fine-tuned model ID")
    .action((id: string) => {
      setActiveModel(id);

      if (!isTTY) {
        jsonOut({ ok: true, activeModel: id });
        return;
      }

      console.log(chalk.green(`✔ Active model set to: ${id}`));
      console.log(chalk.dim("  Styles AI calls will now use this model."));
    });

  modelCmd
    .command("clear")
    .description("Clear the active model (revert to default)")
    .action(() => {
      clearActiveModel();

      if (!isTTY) {
        jsonOut({ ok: true, activeModel: DEFAULT_MODEL });
        return;
      }

      console.log(chalk.green(`✔ Active model cleared — using default: ${DEFAULT_MODEL}`));
    });
}
