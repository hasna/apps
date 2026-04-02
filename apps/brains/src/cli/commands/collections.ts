import type { Command } from "commander";
import { eq, sql } from "drizzle-orm";
import { getDb, fineTunedModels } from "../../db/index.js";
import { printTable, printStatus, printJson, printError, printSuccess, printInfo } from "../ui.js";

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
      printInfo("No collections found. Set a collection with 'brains models collection <model-id> <name>'.");
      return;
    }
    printTable(
      ["Collection", "Model Count", "Models"],
      rows.map((r) => [r.collection ?? "(none)", String(r.count), r.names ?? ""])
    );
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

export function registerCollectionsCommands(program: Command): void {
  const collectionsCmd = program.command("collections").description("Manage model collections");

  // bare `brains collections` → show table (use `collections list --json` for JSON)
  collectionsCmd
    .action(async () => {
      await listCollections(false);
    });

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
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      try {
        const db = getDb();
        const models = await db
          .select()
          .from(fineTunedModels)
          .where(eq(fineTunedModels.collection, name));

        if (models.length === 0) { if (opts.json) { printJson([]); return; } printInfo(`No models found in collection '${name}'.`); return; }
        if (opts.json) { printJson(models); return; }
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
