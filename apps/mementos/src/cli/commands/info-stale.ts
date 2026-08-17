import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { getStaleMemoriesPage } from "../../db/analytics.js";
import { getProject } from "../../db/projects.js";
import {
  resolveAgentFilter,
  DEFAULT_COMPACT_LIMIT,
  outputJson,
  getOutputFormat,
  colorScope,
  colorCategory,
  makeHandleError,
  cursorOrOffset,
  positiveIntOrDefault,
  printPageHint,
  truncateText,
  collectPagedRows,
  type GlobalOpts,
} from "../helpers.js";

export function registerStaleCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("stale")
    .description("Find memories not accessed recently (for cleanup/review)")
    .option("--days <n>", "Stale threshold in days (default: 30)", parseInt)
    .option("--project <path>", "Project filter")
    .option("--agent <name>", "Agent filter")
    .option("--limit <n>", "Max results (default: 20)", parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--format <fmt>", "Output format: compact (default), json")
    .option("--verbose", "Show wider memory snippets")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const days = (opts.days as number | undefined) || 30;
        const fmt = getOutputFormat(program, opts.format as string | undefined);
        const isJson = fmt === "json";
        const limit = positiveIntOrDefault(opts.limit, isJson ? 20 : DEFAULT_COMPACT_LIMIT);
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        const projectPath = (opts.project as string | undefined) || globalOpts.project;
        let projectId: string | undefined;
        if (projectPath) {
          const project = getProject(resolve(projectPath));
          if (project) projectId = project.id;
        }
        // Same drop-on-miss widening as `search` had; see resolveAgentFilter.
        const agentId = resolveAgentFilter(
          (opts.agent as string | undefined) || globalOpts.agent
        );

        // Collect bounded pages (server caps single responses at 1000 rows)
        // up to the requested limit. `stale_count` is the TRUE total from the
        // first page — never the returned page length (BUG 2796806b).
        let staleTotal = 0;
        let firstPage = true;
        const { rows: collected, hasMore } = collectPagedRows(
          (cursor, pageLimit) => {
            const page = getStaleMemoriesPage({
              days,
              project_id: projectId,
              agent_id: agentId,
              limit: pageLimit,
              offset: cursor,
            });
            if (firstPage) {
              staleTotal = page.total;
              firstPage = false;
            }
            return {
              rows: page.rows,
              has_more: page.has_more,
              next_cursor: page.next_cursor,
            };
          },
          limit,
          offset,
        );
        const displayRows = hasMore ? collected.slice(0, limit) : collected;

        if (fmt === "json") {
          outputJson({
            stale_count: staleTotal,
            returned: displayRows.length,
            threshold_days: days,
            has_more: hasMore,
            next_cursor: hasMore ? offset + displayRows.length : null,
            memories: displayRows,
          });
          return;
        }

        if (displayRows.length === 0) {
          console.log(chalk.yellow(`No stale memories found (threshold: ${days} days).`));
          return;
        }

        console.log(chalk.bold(`\n  ${displayRows.length}${hasMore ? "+" : ""} stale memor${displayRows.length === 1 ? "y" : "ies"} (not accessed in ${days}+ days):`));
        for (const row of displayRows) {
          const accessed = row.accessed_at
            ? chalk.dim(row.accessed_at.split("T")[0])
            : chalk.red("never");
          const value = truncateText(row.value, opts.verbose ? 120 : 64);
          console.log(`  ${chalk.red(String(row.importance))} ${colorScope(row.scope as never)}/${colorCategory(row.category as never)} ${chalk.bold(row.key)} = ${value} ${chalk.dim(`(${accessed}, ${row.access_count} accesses)`)}`);
        }
        printPageHint({
          shown: displayRows.length,
          limit,
          offset,
          hasMore,
          command: "mementos stale",
          detailHint: "use mementos show <id> for full details or --json for full objects",
        });
        console.log();
      } catch (e) {
        handleError(e);
      }
    });
}
