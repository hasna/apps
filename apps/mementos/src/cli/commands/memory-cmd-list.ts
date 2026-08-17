import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { getProject } from "../../db/projects.js";
import { listMemoriesPage } from "../../db/memories.js";
import type { MemoryScope, MemoryCategory, MemoryStatus, MemoryFilter } from "../../types/index.js";
import {
  resolveAgentFilter,
  DEFAULT_COMPACT_LIMIT,
  outputJson,
  outputYaml,
  getOutputFormat,
  formatMemoryLine,
  makeHandleError,
  cursorOrOffset,
  positiveIntOrDefault,
  printPageHint,
  collectPagedRows,
  type GlobalOpts,
} from "../helpers.js";

export function registerListCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("list")
    .description("List memories with optional filters")
    .option("--scope <scope>", "Scope filter")
    .option("-c, --category <cat>", "Category filter")
    .option("--tags <tags>", "Comma-separated tags filter")
    .option("--importance-min <n>", "Minimum importance", parseInt)
    .option("--pinned", "Show only pinned")
    .option("--agent <name>", "Agent filter")
    .option("--project <path>", "Project filter")
    .option("--session <id>", "Session ID filter")
    .option("--limit <n>", "Max results", parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--status <status>", "Status filter: active, archived, expired")
    .option("--format <fmt>", "Output format: compact (default), json, csv, yaml")
    .option("--verbose", "Show wider memory snippets in human output")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const fmt = getOutputFormat(program, opts.format as string | undefined);
        const isStructured = fmt === "json" || fmt === "csv" || fmt === "yaml";
        const requestedLimit = opts.limit as number | undefined;
        // Structured formats emit a bare array / rows and cannot carry a
        // truncation marker, so no --limit means the FULL population — a
        // silent default page was the defect (BUG 2796806b). Compact keeps
        // its default page plus the "has more" hint.
        const limit =
          requestedLimit === undefined
            ? isStructured
              ? undefined
              : DEFAULT_COMPACT_LIMIT
            : positiveIntOrDefault(
                requestedLimit,
                isStructured ? 50 : DEFAULT_COMPACT_LIMIT
              );
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        const agentId = resolveAgentFilter((opts.agent as string | undefined) || globalOpts.agent);
        const projectPath = (opts.project as string | undefined) || globalOpts.project;
        let projectId: string | undefined;
        if (projectPath) {
          const project = getProject(resolve(projectPath));
          if (!project) {
            throw new Error(`Project not found: ${projectPath}`);
          }
          projectId = project.id;
        }

        const filter: MemoryFilter = {
          scope: opts.scope as MemoryScope | undefined,
          category: opts.category as MemoryCategory | undefined,
          tags: opts.tags
            ? (opts.tags as string).split(",").map((t: string) => t.trim())
            : undefined,
          min_importance: opts.importanceMin as number | undefined,
          pinned: opts.pinned ? true : undefined,
          agent_id: agentId,
          project_id: projectId,
          status: opts.status as MemoryStatus | undefined,
          session_id: (opts.session as string | undefined) || globalOpts.session,
        };

        // Collect bounded pages (1000 rows max per server response) until the
        // requested limit or the full population is assembled. This is also
        // what keeps `--limit 40000` from ever issuing one giant request that
        // a proxy could truncate mid-body.
        const { rows: collected, hasMore } = collectPagedRows(
          (cursor, pageLimit) => {
            const page = listMemoriesPage({
              ...filter,
              limit: pageLimit,
              offset: cursor,
            });
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

        if (fmt === "json") {
          outputJson(memories);
          return;
        }

        if (fmt === "csv") {
          console.log("key,value,scope,category,importance,id");
          for (const m of memories) {
            const v = m.value.replace(/"/g, '""');
            console.log(`"${m.key}","${v}",${m.scope},${m.category},${m.importance},${m.id.slice(0, 8)}`);
          }
          return;
        }

        if (fmt === "yaml") {
          outputYaml(memories);
          return;
        }

        if (memories.length === 0) {
          console.log(chalk.yellow("No memories found."));
          return;
        }

        console.log(chalk.bold(`${memories.length}${hasMore ? "+" : ""} memor${memories.length === 1 ? "y" : "ies"}:`));
        for (const m of memories) {
          console.log(formatMemoryLine(m, {
            valueLength: opts.verbose ? 120 : 64,
            preferSummary: !opts.verbose,
          }));
        }
        printPageHint({
          shown: memories.length,
          limit: limit ?? memories.length,
          offset,
          hasMore,
          command: "mementos list",
          detailHint: "use mementos show <id> for full details or --json for full objects",
        });
      } catch (e) {
        handleError(e);
      }
    });
}
