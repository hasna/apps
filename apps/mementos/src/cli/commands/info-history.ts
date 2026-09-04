import type { Command } from "commander";
import chalk from "chalk";
import { listMemoryHistoryPage } from "../../db/memories.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import {
  DEFAULT_SEARCH_LIMIT,
  outputJson,
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

export function registerHistoryCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("history")
    .description("List memories sorted by most recently accessed")
    .option("--limit <n>", "Max results (compact default: 10)", parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--verbose", "Show wider memory snippets")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const isJson = Boolean(globalOpts.json);
        // Same contract as `list`: a structured read with no --limit returns
        // the full population (a bare array cannot carry a truncation marker).
        const requestedLimit = opts.limit as number | undefined;
        const limit =
          requestedLimit === undefined
            ? isJson
              ? undefined
              : DEFAULT_SEARCH_LIMIT
            : positiveIntOrDefault(requestedLimit, isJson ? 20 : DEFAULT_SEARCH_LIMIT);
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;

        const { rows: collected, hasMore } = collectPagedRows(
          (cursor, pageLimit) => {
            const page = listMemoryHistoryPage({ limit: pageLimit, offset: cursor });
            return {
              rows: page.rows,
              has_more: page.has_more,
              next_cursor: page.next_cursor,
            };
          },
          limit,
          offset,
        );
        const memories =
          hasMore && limit !== undefined
            ? collected.slice(0, limit)
            : collected;

        // Read-path redaction (todos e12c7659): `history` is a read verb whose
        // rows carry the raw stored key/value, so a credential-shaped key
        // stored by any write path reaches stdout verbatim across both
        // formats. Project the display copy once before any format branch so
        // JSON and human both emit value-safe text while coordination metadata
        // (id, scope, category, importance, timestamps, attribution) survives.
        const sanitized = memories.map(redactMemoryForOutput);

        if (globalOpts.json) {
          outputJson(sanitized);
          return;
        }

        if (sanitized.length === 0) {
          console.log(chalk.yellow("No recently accessed memories."));
          return;
        }

        console.log(
          chalk.bold(
            `${sanitized.length} recently accessed memor${sanitized.length === 1 ? "y" : "ies"}:`
          )
        );
        for (const m of sanitized) {
          const id = chalk.dim(m.id.slice(0, 8));
          const scope = colorScope(m.scope);
          const cat = colorCategory(m.category);
          const value = truncateText(m.value, opts.verbose ? 120 : 64);
          const accessed = m.accessed_at
            ? chalk.dim(m.accessed_at)
            : chalk.dim("never");
          console.log(
            `${id} [${scope}/${cat}] ${chalk.bold(m.key)} = ${value}  ${accessed}`
          );
        }
        printPageHint({
          shown: sanitized.length,
          limit: limit ?? sanitized.length,
          offset,
          hasMore,
          command: "mementos history",
          detailHint: "use mementos show <id> for full details or --json for full objects",
        });
      } catch (e) {
        handleError(e);
      }
    });
}
