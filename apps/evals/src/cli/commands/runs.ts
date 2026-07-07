import { Command } from "commander";
import {
  formatRunList,
  parseDisplayLimit,
  printTerminalReport,
  summarizeRun,
  toJson,
  toMarkdown,
} from "../../core/reporter.js";
import { countRuns, getRun, listRuns } from "../../db/store.js";

function parseCursor(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function addShowCommand(parent: Command, name: "show" | "inspect"): void {
  parent
    .command(`${name} <id>`)
    .description(name === "show" ? "Show a saved run summary" : "Inspect a saved run")
    .option("--limit <n>", "Max result rows in compact output", String(20))
    .option("--verbose", "Show all result rows in human output")
    .option("--markdown", "Output a full markdown report")
    .option("-j, --json", "Output full JSON run data")
    .action((id: string, opts: { limit?: string; verbose?: boolean; markdown?: boolean; json?: boolean }) => {
      let run;
      try {
        run = getRun(id);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      if (!run) {
        console.error(`Run not found: ${id}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(toJson(run));
      } else if (opts.markdown) {
        console.log(toMarkdown(run));
      } else {
        printTerminalReport(run, {
          limit: parseDisplayLimit(opts.limit),
          verbose: opts.verbose,
          detailHint: `use evals runs ${name} ${run.id.slice(0, 8)} --verbose for all rows`,
          jsonHint: "use --json for full machine-readable run data",
        });
      }
    });
}

export function runsCommand(): Command {
  const cmd = new Command("runs")
    .description("List and inspect saved eval runs");

  cmd
    .command("list")
    .description("List saved runs compactly")
    .option("--limit <n>", "Max runs to show", String(20))
    .option("--cursor <n>", "Pagination offset from a previous list")
    .option("--dataset <path>", "Filter by dataset path")
    .option("-j, --json", "Output compact JSON summaries")
    .action((opts: { limit?: string; cursor?: string; dataset?: string; json?: boolean }) => {
      const limit = parseDisplayLimit(opts.limit);
      const cursor = parseCursor(opts.cursor);
      const runs = listRuns(limit, opts.dataset, cursor);
      const total = countRuns(opts.dataset);
      const nextCursor = cursor + runs.length < total ? cursor + runs.length : null;

      if (opts.json) {
        console.log(JSON.stringify({
          runs: runs.map(summarizeRun),
          total,
          limit,
          cursor,
          nextCursor,
        }, null, 2));
        return;
      }

      console.log(formatRunList(runs, {
        total,
        cursor,
        limit,
        nextCursor,
      }));
    });

  addShowCommand(cmd, "show");
  addShowCommand(cmd, "inspect");

  return cmd;
}
