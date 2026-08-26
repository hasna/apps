import type { Command } from "commander";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { getDb, trainingDatasets } from "../../db/index.js";
import { getBrainsDatasetsDir } from "../../lib/app-home.js";
import { ensurePrivateDirectory, writePrivateTextFile } from "../../lib/private-files.js";
import { printJson, printError, printSuccess, printInfo, printTable, printHint } from "../ui.js";
import {
  DEFAULT_LIST_LIMIT,
  formatDate,
  formatShortId,
  limitItems,
  parsePositiveIntegerOption,
  summarizeTrainingExample,
  truncateMiddle,
  truncateText,
} from "../../lib/compact-output.js";

const DEFAULT_DATASETS_DIR = getBrainsDatasetsDir();

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
        ensurePrivateDirectory(opts.output);

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
            writePrivateTextFile(filePath, examples.map((e) => JSON.stringify(e)).join("\n") + "\n");

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
    .option("--verbose", "Show full JSON for each previewed example")
    .option("--json", "Output preview examples as JSON")
    .action((file: string, opts: { count: string; verbose?: boolean; json?: boolean }) => {
      if (!existsSync(file)) { printError(`File not found: ${file}`); process.exit(1); }

      let n: number;
      try {
        n = parsePositiveIntegerOption(opts.count, "--count", 5) ?? 5;
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      try {
        const content = readFileSync(file, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        const total = lines.length;
        const preview = lines.slice(0, n);
        const parsedPreview: unknown[] = [];

        preview.forEach((line, idx) => {
          try {
            parsedPreview.push(JSON.parse(line));
          } catch {
            parsedPreview.push({ error: `Line ${idx + 1} is not valid JSON`, line: truncateText(line, 160) });
          }
        });

        if (opts.json) {
          printJson({ file, total, shown: parsedPreview.length, examples: parsedPreview });
          return;
        }

        console.log();
        printInfo(`File: ${truncateMiddle(file, opts.verbose ? 120 : 72)}`);
        printInfo(`Total examples: ${total}`);
        printInfo(`Showing first ${Math.min(n, total)} ${opts.verbose ? "full example(s)" : "compact preview(s)"}:`);
        console.log();

        parsedPreview.forEach((parsed, idx) => {
          console.log(`─── Example ${idx + 1} ───`);
          if (opts.verbose) {
            printJson(parsed);
            console.log();
            return;
          }

          const compact = summarizeTrainingExample(parsed);
          if (compact.messages.length === 0) {
            console.log(`  ${truncateText(JSON.stringify(parsed), 180)}`);
          } else {
            for (const message of compact.messages) {
              console.log(`  ${message.role.padEnd(10)} ${message.content}`);
            }
          }
          if (compact.metadata) {
            const metadata = Object.entries(compact.metadata)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ");
            console.log(`  metadata   ${metadata}`);
          }
          if (compact.omitted_messages || compact.omitted_metadata_keys || compact.truncated) {
            const omitted = [
              compact.omitted_messages ? `${compact.omitted_messages} message(s)` : "",
              compact.omitted_metadata_keys ? `${compact.omitted_metadata_keys} metadata key(s)` : "",
            ].filter(Boolean).join(", ");
            console.log(`  omitted    ${omitted || "long fields truncated"}`);
          }
          console.log();
        });

        if (total > preview.length) {
          printHint(`Showing ${preview.length} of ${total}. Increase --count to preview more examples.`);
        }
        printHint("Use --verbose for full example JSON or --json for machine-readable output.");
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

        ensurePrivateDirectory(getMergeOutputDirectory(opts.output));

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

        writePrivateTextFile(opts.output, finalLines.join("\n") + "\n");

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
    .option("--limit <n>", `Maximum rows to show (default: ${DEFAULT_LIST_LIMIT})`)
    .option("--verbose", "Show full IDs and file paths")
    .option("--json", "Output as JSON")
    .action(async (opts: { limit?: string; verbose?: boolean; json?: boolean }) => {
      try {
        const db = getDb();
        const datasets = await db.select().from(trainingDatasets);
        if (opts.json) { printJson(datasets); return; }
        if (datasets.length === 0) { printInfo("No datasets found. Use 'brains data gather' to create one."); return; }
        const limit = parsePositiveIntegerOption(opts.limit, "--limit", DEFAULT_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;
        const limited = limitItems(datasets, limit);
        printTable(
          ["ID", "Source", "Examples", "File", "Created"],
          limited.items.map((d) => [
            formatShortId(d.id, opts.verbose),
            d.source,
            String(d.exampleCount),
            opts.verbose ? d.filePath ?? "" : truncateMiddle(d.filePath ?? "", 56),
            formatDate(d.createdAt),
          ])
        );
        if (limited.hidden > 0) {
          printHint(`Showing ${limited.shown} of ${limited.total} datasets. Use --limit ${limited.total} to show all.`);
        }
        printHint("Use --verbose for full paths or --json for full records.");
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
