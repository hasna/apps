import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { getStaleMemoriesPage } from "../../db/analytics.js";
import { getProject } from "../../db/projects.js";
import { redactCredentialKey, redactSecrets } from "../../lib/redact.js";
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
    .option("--pinned", "Review stale PINNED memories (default view excludes pinned)")
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
              pinned: opts.pinned ? true : undefined,
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

        // Read-path redaction (todos e12c7659): `stale` is a read verb whose
        // rows carry the raw stored key/value, so a credential-shaped key
        // stored by any write path reaches stdout verbatim across both
        // formats. The stale query returns a StaleMemory subset (no
        // summary/tags/when_to_use/metadata), so the two free-text fields it
        // does carry are projected through the same read-path redactors used
        // everywhere else — conservative key/tag shape for the key, broad
        // inline-text shape for the value. Coordination metadata (id,
        // importance, scope, category, accessed_at, access_count, created_at)
        // is preserved.
        const sanitized = displayRows.map((row) => ({
          ...row,
          key: redactCredentialKey(row.key),
          value: redactSecrets(row.value),
        }));

        if (fmt === "json") {
          outputJson({
            stale_count: staleTotal,
            returned: sanitized.length,
            threshold_days: days,
            has_more: hasMore,
            next_cursor: hasMore ? offset + sanitized.length : null,
            memories: sanitized,
          });
          return;
        }

        if (sanitized.length === 0) {
          console.log(chalk.yellow(`No stale memories found (threshold: ${days} days).`));
          return;
        }

        console.log(chalk.bold(`\n  ${sanitized.length}${hasMore ? "+" : ""} stale memor${sanitized.length === 1 ? "y" : "ies"} (not accessed in ${days}+ days):`));
        for (const row of sanitized) {
          const accessed = row.accessed_at
            ? chalk.dim(row.accessed_at.split("T")[0])
            : chalk.red("never");
          const value = truncateText(row.value, opts.verbose ? 120 : 64);
          console.log(`  ${chalk.red(String(row.importance))} ${colorScope(row.scope as never)}/${colorCategory(row.category as never)} ${chalk.bold(row.key)} = ${value} ${chalk.dim(`(${accessed}, ${row.access_count} accesses)`)}`);
        }
        printPageHint({
          shown: sanitized.length,
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
