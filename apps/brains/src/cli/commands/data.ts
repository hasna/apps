import type { Command } from "commander";
import { randomUUID } from "crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { getDb, trainingDatasets } from "../../db/index.js";
import { printJson, printError, printSuccess, printInfo, printTable } from "../ui.js";

const DEFAULT_DATASETS_DIR = join(homedir(), ".hasna", "brains", "datasets");

export function registerDataCommands(program: Command): void {
  const dataCmd = program.command("data").description("Manage training datasets");

  dataCmd
    .command("gather")
    .description("Gather training data from agent memory sources")
    .option("--source <source>", "Data source: todos|mementos|conversations|sessions|all", "all")
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

        const sources = opts.source === "all"
          ? ["todos", "mementos", "conversations", "sessions"]
          : [opts.source];

        const now = Date.now();
        const db = getDb();

        const gathererMap: Record<string, (opts: { limit: number }) => Promise<{ examples: { messages: unknown[] }[]; count: number }>> = {
          todos: (o) => import("../../lib/gatherers/todos.js").then(m => m.gatherFromTodos(o)),
          mementos: (o) => import("../../lib/gatherers/mementos.js").then(m => m.gatherFromMementos(o)),
          conversations: (o) => import("../../lib/gatherers/conversations.js").then(m => m.gatherFromConversations(o)),
          sessions: (o) => import("../../lib/gatherers/sessions.js").then(m => m.gatherFromSessions(o)),
        };

        let totalExamples = 0;
        let successfulSources = 0;

        for (const source of sources) {
          printInfo(`Gathering from ${source} …`);
          try {
            const gatherer = gathererMap[source];
            if (!gatherer) { printError(`  Unknown source: ${source}`); continue; }

            const { examples, count } = await gatherer({ limit });

            if (count === 0) { printInfo(`  No examples found in ${source}.`); continue; }

            const fileName = `${source}-${now}.jsonl`;
            const filePath = join(opts.output, fileName);
            writeFileSync(filePath, examples.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

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
      if (!existsSync(file)) { printError(`File not found: ${file}`); process.exit(1); }

      const n = parseInt(opts.count, 10);
      if (isNaN(n) || n <= 0) { printError(`Invalid --count value: ${opts.count}`); process.exit(1); }

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
    .option("--output <path>", "Output file path", join(DEFAULT_DATASETS_DIR, `merged-${Date.now()}.jsonl`))
    .option("--no-dedupe", "Skip deduplication")
    .action(async (files: string[], opts: { output: string; dedupe: boolean }) => {
      try {
        for (const f of files) {
          if (!existsSync(f)) { printError(`File not found: ${f}`); process.exit(1); }
        }

        mkdirSync(getMergeOutputDirectory(opts.output), { recursive: true });

        const allExamples: string[] = [];
        for (const f of files) {
          const lines = readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
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
        if (datasets.length === 0) { printInfo("No datasets found. Use 'brains data gather' to create one."); return; }
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
}

function getMergeOutputDirectory(outputPath: string): string {
  if (!outputPath) return DEFAULT_DATASETS_DIR;
  return dirname(outputPath);
}

export { getMergeOutputDirectory };
