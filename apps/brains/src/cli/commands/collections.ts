import type { Command } from "commander";
import { eq, sql } from "drizzle-orm";
import { getDb, fineTunedModels } from "../../db/index.js";
import { printTable, printStatus, printJson, printError, printSuccess, printInfo, printHint } from "../ui.js";
import {
  DEFAULT_LIST_LIMIT,
  formatShortId,
  limitItems,
  parsePositiveIntegerOption,
  truncateMiddle,
  truncateText,
} from "../../lib/compact-output.js";

interface CollectionListOptions {
  json?: boolean;
  limit?: string;
  verbose?: boolean;
}

async function listCollections(opts: CollectionListOptions = {}) {
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

    if (opts.json) { printJson(rows); return; }
    if (rows.length === 0) {
      printInfo("No collections found. Set a collection with 'brains models collection <model-id> <name>'.");
      return;
    }
    const limit = parsePositiveIntegerOption(opts.limit, "--limit", DEFAULT_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;
    const limited = limitItems(rows, limit);
    printTable(
      ["Collection", "Model Count", "Models"],
      limited.items.map((r) => [
        truncateText(r.collection ?? "(none)", opts.verbose ? 80 : 32),
        String(r.count),
        opts.verbose ? r.names ?? "" : truncateText(r.names ?? "", 80),
      ])
    );
    if (limited.hidden > 0) {
      printHint(`Showing ${limited.shown} of ${limited.total} collections. Use --limit ${limited.total} to show all.`);
    }
    printHint("Use --verbose for full model name lists, --json for full records, or 'brains collections show <name>' for models.");
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function registerCollectionsCommands(program: Command): void {
  const collectionsCmd = program.command("collections").description("Manage model collections");

  // bare `brains collections` → show table (use `collections list --json` for JSON)
  collectionsCmd
    .option("--limit <n>", `Maximum rows to show (default: ${DEFAULT_LIST_LIMIT})`)
    .option("--verbose", "Show full model name lists")
    .option("--json", "Output as JSON")
    .action(async (opts: CollectionListOptions) => {
      await listCollections(opts);
    });

  collectionsCmd
    .command("list")
    .description("List all collections with model counts")
    .option("--limit <n>", `Maximum rows to show (default: ${DEFAULT_LIST_LIMIT})`)
    .option("--verbose", "Show full model name lists")
    .option("--json", "Output as JSON")
    .action(async (opts: CollectionListOptions) => {
      await listCollections(opts);
    });

  collectionsCmd
    .command("show <name>")
    .description("List all models in a collection")
    .option("--limit <n>", `Maximum rows to show (default: ${DEFAULT_LIST_LIMIT})`)
    .option("--verbose", "Show full IDs and base model names")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { limit?: string; verbose?: boolean; json?: boolean }) => {
      try {
        const db = getDb();
        const models = await db
          .select()
          .from(fineTunedModels)
          .where(eq(fineTunedModels.collection, name));

        if (models.length === 0) { if (opts.json) { printJson([]); return; } printInfo(`No models found in collection '${name}'.`); return; }
        if (opts.json) { printJson(models); return; }
        const limit = parsePositiveIntegerOption(opts.limit, "--limit", DEFAULT_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;
        const limited = limitItems(models, limit);
        printTable(
          ["ID", "Name", "Provider", "Status", "Base Model"],
          limited.items.map((m) => [
            formatShortId(m.id, opts.verbose),
            truncateText(m.name, opts.verbose ? 80 : 40),
            m.provider,
            printStatus(m.status),
            opts.verbose ? m.baseModel : truncateMiddle(m.baseModel, 36),
          ])
        );
        if (limited.hidden > 0) {
          printHint(`Showing ${limited.shown} of ${limited.total} models. Use --limit ${limited.total} to show all.`);
        }
        printHint("Use --verbose for full fields, --json for full records, or 'brains models show <id>' for details.");
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
        const affected = await db
          .select({ id: fineTunedModels.id })
          .from(fineTunedModels)
          .where(eq(fineTunedModels.collection, oldName));
        await db
          .update(fineTunedModels)
          .set({ collection: newName, updatedAt: Date.now() })
          .where(eq(fineTunedModels.collection, oldName));
        printSuccess(`Renamed collection '${oldName}' → '${newName}' (${affected.length} models updated)`);
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
