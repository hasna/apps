import type { Command } from "commander";
import chalk from "chalk";
import { listMemoryHistoryPage } from "../../db/memories.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import {
  DEFAULT_SEARCH_LIMIT,
  colorScope,
  colorCategory,
  makeHandleError,
  cursorOrOffset,
  positiveIntOrDefault,
  printPageHint,
  truncateText,
  collectPagedRows,
  getOutputFormat,
} from "../helpers.js";
import {
  STRUCTURED_PAGE_MAX_ROWS,
  STRUCTURED_ALL_MAX_ROWS,
  STRUCTURED_ALL_MAX_BYTES,
  structuredMaxBytes,
  structuredMemoryOutput,
  type StructuredMemoryDetail,
} from "./memory-cmd-list.js";

export function registerHistoryCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("history")
    .description("List memories sorted by most recently accessed")
    .option("--limit <n>", `Max results (default: ${DEFAULT_SEARCH_LIMIT}, JSON hard page max: ${STRUCTURED_PAGE_MAX_ROWS})`, parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--verbose", "Show wider memory snippets")
    .option("--all", `Exhaust JSON results from offset zero (hard max: ${STRUCTURED_ALL_MAX_ROWS} rows)`)
    .option("--full", "Emit full memory objects in JSON instead of compact projections")
    .option("--max-bytes <n>", `JSON response byte ceiling (hard max: ${STRUCTURED_ALL_MAX_BYTES})`, parseInt)
    .action((opts) => {
      try {
        const format = getOutputFormat(program);
        const isJson = format === "json";
        if (!isJson && (opts.all || opts.full || opts.maxBytes !== undefined)) {
          throw new Error("--all, --full, and --max-bytes require JSON output");
        }
        if (opts.all && opts.limit !== undefined) {
          throw new Error("--all cannot be combined with --limit");
        }

        const requestedLimit = opts.limit as number | undefined;
        const all = Boolean(opts.all);
        const detail: StructuredMemoryDetail = opts.full ? "full" : "compact";
        const limit = requestedLimit === undefined
          ? DEFAULT_SEARCH_LIMIT
          : positiveIntOrDefault(requestedLimit, DEFAULT_SEARCH_LIMIT);
        if (isJson && limit > STRUCTURED_PAGE_MAX_ROWS) {
          throw new Error(
            `--limit cannot exceed the hard page ceiling of ${STRUCTURED_PAGE_MAX_ROWS}; use --all for a bounded exhaustive read`,
          );
        }
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        if (all && offset !== 0) {
          throw new Error("--all requires --cursor/--offset 0");
        }

        const target = all ? STRUCTURED_ALL_MAX_ROWS : limit;
        const { rows: collected, hasMore } = collectPagedRows(
          (cursor, pageLimit) => {
            const page = listMemoryHistoryPage({ limit: pageLimit, offset: cursor });
            return {
              rows: page.rows,
              has_more: page.has_more,
              next_cursor: page.next_cursor,
            };
          },
          target,
          offset,
        );
        if (all && hasMore) {
          throw new Error(
            `Exhaustive structured output exceeds the hard safety limit of ${STRUCTURED_ALL_MAX_ROWS} rows; use paginated JSON output instead`,
          );
        }
        const memories = collected.slice(0, target);

        // Read-path redaction (todos e12c7659): project the display copy once
        // before JSON or human output so stored credential-shaped text cannot
        // reach stdout while coordination metadata remains usable.
        const sanitized = memories.map(redactMemoryForOutput);

        if (isJson) {
          process.stdout.write(structuredMemoryOutput({
            memories: sanitized,
            receipt: "mementos.history.page.v1",
            offset,
            limit,
            sourceHasMore: hasMore,
            all,
            detail,
            maxBytes: structuredMaxBytes(opts.maxBytes, { all, detail }),
            history: true,
          }));
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
          limit,
          offset,
          hasMore,
          command: "mementos history",
          detailHint: "use mementos show <id> for full details or --json --full for full objects",
        });
      } catch (e) {
        handleError(e);
      }
    });
}
