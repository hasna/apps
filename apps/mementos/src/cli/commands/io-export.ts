import type { Command } from "commander";
import { resolve } from "node:path";
import { getProject } from "../../db/projects.js";
import { listMemoriesBounded } from "../../db/memories.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import type { MemoryCategory, MemoryScope, MemoryFilter } from "../../types/index.js";
import {
  resolveAgentFilter,
  outputJson,
  makeHandleError,
  cursorOrOffset,
  type GlobalOpts,
} from "../helpers.js";
import {
  structuredCollectionOutput,
  structuredMaxBytes,
  structuredPageLimit,
} from "../structured-json.js";

export function registerExportCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("export")
    .description("Export a truthful full-detail JSON page; use --all for the exhaustive legacy array")
    .option("--scope <scope>", "Scope filter")
    .option("-c, --category <cat>", "Category filter")
    .option("--agent <name>", "Agent filter")
    .option("--project <path>", "Project filter")
    .option("--limit <n>", "Page size (default: 100, maximum: 1000)", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--max-bytes <n>", "Paginated response byte ceiling (default: 65536)", parseInt)
    .option("--all", "Exhaust the complete query and emit the legacy full JSON array")
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const agentId = resolveAgentFilter((opts.agent as string | undefined) || globalOpts.agent);
        const projectPath =
          (opts.project as string | undefined) || globalOpts.project;
        let projectId: string | undefined;
        if (projectPath) {
          const project = getProject(resolve(projectPath));
          if (project) projectId = project.id;
        }

        const filter: MemoryFilter = {
          scope: opts.scope as MemoryScope | undefined,
          category: opts.category as MemoryCategory | undefined,
          agent_id: agentId,
          project_id: projectId,
        };
        const exhaustive = Boolean(opts.all);
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        if (exhaustive && opts.limit !== undefined) {
          throw new Error("--all cannot be combined with --limit");
        }
        if (exhaustive && offset !== 0) {
          throw new Error("--all requires --cursor/--offset 0");
        }
        if (exhaustive && opts.maxBytes !== undefined) {
          throw new Error("--max-bytes applies to paginated exports; exhaustive --all is an explicit unbounded compatibility escape");
        }

        if (exhaustive) {
          const complete = listMemoriesBounded(filter, undefined).rows.map(redactMemoryForOutput);
          outputJson(complete);
          return;
        }

        const limit = structuredPageLimit(opts.limit, 100);
        const page = listMemoriesBounded({ ...filter, offset }, limit);
        const sanitized = page.rows.map(redactMemoryForOutput);
        process.stdout.write(structuredCollectionOutput({
          collection: "memories",
          receipt: "mementos.export.page.v1",
          items: sanitized,
          offset,
          limit,
          sourceHasMore: page.has_more,
          all: false,
          detail: "full",
          maxBytes: structuredMaxBytes(opts.maxBytes, { all: false, detail: "full" }),
          nextArguments: {
            ...(opts.scope ? { scope: opts.scope as string } : {}),
            ...(opts.category ? { category: opts.category as string } : {}),
            ...(agentId ? { agent: agentId } : {}),
            ...(projectPath ? { project: projectPath } : {}),
          },
          includeDetailInNextArguments: false,
        }));
      } catch (e) {
        handleError(e);
      }
    });
}
