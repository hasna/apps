import type { Command } from "commander";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { getDb, fineTunedModels, trainingJobs, trainingDatasets } from "../../db/index.js";
import * as openaiProvider from "../../lib/providers/openai.js";
import { ThinkerLabsProvider } from "../../lib/providers/thinker-labs.js";
import { printStatus, printJson, printError, printSuccess, printInfo, printTable } from "../ui.js";

export function registerFinetuneCommands(program: Command): void {
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
          if (result.fineTunedModel) console.log(`  Fine-tuned model: ${result.fineTunedModel}`);
          if (result.error) console.log(`  Error:            ${result.error}`);
          console.log();
        }

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
        if (jobs.length === 0) { printInfo("No fine-tuning jobs found."); return; }

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
}
