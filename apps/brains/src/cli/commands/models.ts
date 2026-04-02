import type { Command } from "commander";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb, fineTunedModels, trainingJobs } from "../../db/index.js";
import * as openaiProvider from "../../lib/providers/openai.js";
import { ThinkerLabsProvider } from "../../lib/providers/thinker-labs.js";
import { printTable, printStatus, printJson, printError, printSuccess, printInfo } from "../ui.js";

type ModelRow = typeof fineTunedModels.$inferSelect;
type Provider = ModelRow["provider"];
type ModelStatus = ModelRow["status"];

const VALID_STATUSES: ReadonlySet<ModelStatus> = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

interface ListModelsOptions {
  json?: boolean;
  provider?: string;
  status?: string;
  limit?: string;
}

function parseListLimit(rawLimit: string | undefined): number | undefined {
  if (!rawLimit) return undefined;
  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --limit value: ${rawLimit}. Use a positive integer.`);
  }
  return parsed;
}

function parseListFilters(opts: ListModelsOptions): { provider?: Provider; status?: ModelStatus; limit?: number } {
  const providerRaw = opts.provider?.trim();
  const statusRaw = opts.status?.trim();

  if (providerRaw && providerRaw !== "openai" && providerRaw !== "thinker-labs") {
    throw new Error(`Invalid --provider value: ${providerRaw}. Use openai or thinker-labs.`);
  }

  if (statusRaw && !VALID_STATUSES.has(statusRaw as ModelStatus)) {
    throw new Error(`Invalid --status value: ${statusRaw}. Use one of: ${Array.from(VALID_STATUSES).join(", ")}.`);
  }

  const limit = parseListLimit(opts.limit);
  const provider = providerRaw as Provider | undefined;
  const status = statusRaw as ModelStatus | undefined;

  return { provider, status, limit };
}

export function registerModelsCommands(program: Command): void {
  const modelsCmd = program.command("models").description("Manage tracked fine-tuned models");

  const ensureModelExists = async (id: string) => {
    const db = getDb();
    const [model] = await db.select({ id: fineTunedModels.id }).from(fineTunedModels).where(eq(fineTunedModels.id, id));
    if (!model) {
      printError(`Model not found: ${id}`);
      process.exit(1);
    }
    return db;
  };

  modelsCmd
    .command("list")
    .description("List all tracked fine-tuned models")
    .option("--provider <provider>", "Filter by provider (openai|thinker-labs)")
    .option("--status <status>", "Filter by status (pending|running|succeeded|failed|cancelled)")
    .option("--limit <n>", "Maximum number of results")
    .option("--json", "Output as JSON")
    .action(async (opts: ListModelsOptions) => {
      try {
        const db = getDb();
        const filters = parseListFilters(opts);

        const whereClause = filters.provider && filters.status
          ? and(eq(fineTunedModels.provider, filters.provider), eq(fineTunedModels.status, filters.status))
          : filters.provider
            ? eq(fineTunedModels.provider, filters.provider)
            : filters.status
              ? eq(fineTunedModels.status, filters.status)
              : undefined;

        const query = db.select().from(fineTunedModels).$dynamic();
        if (whereClause) query.where(whereClause);
        if (filters.limit) query.limit(filters.limit);

        const models = await query;
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
        const db = await ensureModelExists(id);
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
        const db = await ensureModelExists(id);
        await db
          .update(fineTunedModels)
          .set({ description, updatedAt: Date.now() })
          .where(eq(fineTunedModels.id, id));
        printSuccess("Description updated.");
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
        const db = await ensureModelExists(id);
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
          provider: opts.provider as Provider,
          baseModel: result.baseModel ?? "unknown",
          status: result.status as ModelStatus,
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

        printSuccess("Model imported successfully.");
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
}

export { parseListFilters, parseListLimit };
