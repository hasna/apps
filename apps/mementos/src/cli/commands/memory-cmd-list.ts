import type { Command } from "commander";
import chalk from "chalk";
import { resolve } from "node:path";
import { getProject } from "../../db/projects.js";
import { listMemoriesPage } from "../../db/memories.js";
import type { Memory, MemoryScope, MemoryCategory, MemoryStatus, MemoryFilter } from "../../types/index.js";
import { redactMemoryForOutput } from "../../lib/redact.js";
import {
  resolveAgentFilter,
  DEFAULT_COMPACT_LIMIT,
  outputYaml,
  getOutputFormat,
  formatMemoryLine,
  makeHandleError,
  cursorOrOffset,
  positiveIntOrDefault,
  printPageHint,
  collectPagedRows,
  truncateText,
  type GlobalOpts,
} from "../helpers.js";

export const STRUCTURED_PAGE_MAX_ROWS = 1_000;
export const STRUCTURED_ALL_MAX_ROWS = 5_000;
export const STRUCTURED_DEFAULT_MAX_BYTES = 32 * 1024;
export const STRUCTURED_FULL_MAX_BYTES = 64 * 1024;
export const STRUCTURED_ALL_MAX_BYTES = 1024 * 1024;
const STRUCTURED_MIN_MAX_BYTES = 1024;

export type StructuredMemoryDetail = "compact" | "full";

interface StructuredPageMeta {
  receipt: string;
  count: number;
  limit: number | null;
  offset: number;
  next_cursor: number | null;
  has_more: boolean;
  complete: boolean;
  all: boolean;
  detail: StructuredMemoryDetail;
  max_rows: number;
  max_bytes: number;
  response_bytes: number;
  truncated: boolean;
  truncation_reason: "limit" | "cursor" | "max_bytes" | null;
  omitted_from_page: number;
  next_arguments: Record<string, unknown> | null;
}

interface StructuredPageEnvelope {
  memories: Array<Memory | Record<string, unknown>>;
  _meta: StructuredPageMeta;
}

export function structuredMaxBytes(
  value: unknown,
  opts: { all: boolean; detail: StructuredMemoryDetail },
): number {
  const fallback = opts.all
    ? STRUCTURED_ALL_MAX_BYTES
    : opts.detail === "full"
      ? STRUCTURED_FULL_MAX_BYTES
      : STRUCTURED_DEFAULT_MAX_BYTES;
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(parsed)
    || parsed < STRUCTURED_MIN_MAX_BYTES
    || parsed > STRUCTURED_ALL_MAX_BYTES
  ) {
    throw new Error(
      `--max-bytes must be an integer from ${STRUCTURED_MIN_MAX_BYTES} to ${STRUCTURED_ALL_MAX_BYTES}`,
    );
  }
  return parsed;
}

export function compactMemoryForStructuredOutput(
  memory: Memory,
  opts: { history?: boolean } = {},
): Record<string, unknown> {
  const value = truncateText(memory.value, 160);
  const summary = memory.summary ? truncateText(memory.summary, 160) : null;
  return {
    id: memory.id,
    key: memory.key,
    value,
    ...(summary ? { summary } : {}),
    scope: memory.scope,
    category: memory.category,
    importance: memory.importance,
    status: memory.status,
    pinned: memory.pinned,
    ...(Array.isArray(memory.tags) && memory.tags.length ? { tags: memory.tags.slice(0, 10) } : {}),
    ...(memory.agent_id ? { agent_id: memory.agent_id } : {}),
    ...(memory.project_id ? { project_id: memory.project_id } : {}),
    ...(memory.session_id ? { session_id: memory.session_id } : {}),
    ...(opts.history && memory.accessed_at ? { accessed_at: memory.accessed_at } : {}),
    updated_at: memory.updated_at,
  };
}

function withResponseBytes(envelope: StructuredPageEnvelope): StructuredPageEnvelope {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = Buffer.byteLength(`${JSON.stringify(envelope)}\n`);
    if (bytes === envelope._meta.response_bytes) return envelope;
    envelope._meta.response_bytes = bytes;
  }
  return envelope;
}

function makeStructuredEnvelope(args: {
  memories: Array<Memory | Record<string, unknown>>;
  receipt: string;
  offset: number;
  limit: number;
  sourceHasMore: boolean;
  all: boolean;
  detail: StructuredMemoryDetail;
  maxBytes: number;
  byteTruncated: boolean;
  omittedFromPage: number;
}): StructuredPageEnvelope {
  const hasMore = args.byteTruncated || args.sourceHasMore;
  const complete = args.offset === 0 && !hasMore;
  const nextCursor = hasMore ? args.offset + args.memories.length : null;
  const truncationReason = args.byteTruncated
    ? "max_bytes"
    : args.sourceHasMore
      ? "limit"
      : args.offset > 0
        ? "cursor"
        : null;
  return withResponseBytes({
    memories: args.memories,
    _meta: {
      receipt: args.receipt,
      count: args.memories.length,
      limit: args.all ? null : args.limit,
      offset: args.offset,
      next_cursor: nextCursor,
      has_more: hasMore,
      complete,
      all: args.all,
      detail: args.detail,
      max_rows: args.all ? STRUCTURED_ALL_MAX_ROWS : STRUCTURED_PAGE_MAX_ROWS,
      max_bytes: args.maxBytes,
      response_bytes: 0,
      truncated: !complete,
      truncation_reason: truncationReason,
      omitted_from_page: args.omittedFromPage,
      next_arguments: nextCursor === null
        ? null
        : {
            cursor: nextCursor,
            limit: args.limit,
            format: "json",
            ...(args.detail === "full" ? { full: true } : {}),
            max_bytes: args.maxBytes,
          },
    },
  });
}

export function structuredMemoryOutput(args: {
  memories: Memory[];
  receipt: string;
  offset: number;
  limit: number;
  sourceHasMore: boolean;
  all: boolean;
  detail: StructuredMemoryDetail;
  maxBytes: number;
  history?: boolean;
}): string {
  const projected: Array<Memory | Record<string, unknown>> = args.detail === "full"
    ? args.memories
    : args.memories.map((memory) => compactMemoryForStructuredOutput(memory, { history: args.history }));

  const completeEnvelope = makeStructuredEnvelope({
    memories: projected,
    receipt: args.receipt,
    offset: args.offset,
    limit: args.limit,
    sourceHasMore: args.sourceHasMore,
    all: args.all,
    detail: args.detail,
    maxBytes: args.maxBytes,
    byteTruncated: false,
    omittedFromPage: 0,
  });
  const completeText = `${JSON.stringify(completeEnvelope)}\n`;
  if (Buffer.byteLength(completeText) <= args.maxBytes) return completeText;

  if (args.all) {
    throw new Error(
      `Exhaustive structured output exceeds the hard safety limit of ${args.maxBytes} bytes; use paginated JSON output instead`,
    );
  }

  for (let count = projected.length - 1; count >= 0; count -= 1) {
    const envelope = makeStructuredEnvelope({
      memories: projected.slice(0, count),
      receipt: args.receipt,
      offset: args.offset,
      limit: args.limit,
      sourceHasMore: true,
      all: false,
      detail: args.detail,
      maxBytes: args.maxBytes,
      byteTruncated: true,
      omittedFromPage: projected.length - count,
    });
    const text = `${JSON.stringify(envelope)}\n`;
    if (Buffer.byteLength(text) > args.maxBytes) continue;
    if (count === 0 && projected.length > 0) {
      throw new Error(
        `One structured memory row exceeds --max-bytes=${args.maxBytes}; use compact detail, a larger --max-bytes value, or mementos show <id>`,
      );
    }
    return text;
  }

  throw new Error(`Structured output metadata exceeds --max-bytes=${args.maxBytes}`);
}

function assertStructuredFlags(opts: Record<string, unknown>, isJson: boolean): void {
  if (!isJson && (opts.all || opts.full || opts.maxBytes !== undefined)) {
    throw new Error("--all, --full, and --max-bytes require JSON output");
  }
  if (opts.all && opts.limit !== undefined) {
    throw new Error("--all cannot be combined with --limit");
  }
}

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
    .option("--limit <n>", `Max results (default: ${DEFAULT_COMPACT_LIMIT}, JSON hard page max: ${STRUCTURED_PAGE_MAX_ROWS})`, parseInt)
    .option("--offset <n>", "Offset for pagination", parseInt)
    .option("--cursor <n>", "Cursor offset for the next page", parseInt)
    .option("--status <status>", "Status filter: active, archived, expired")
    .option("--format <fmt>", "Output format: compact (default), json, csv, yaml")
    .option("--verbose", "Show wider memory snippets in human output")
    .option("--all", `Exhaust JSON results from offset zero (hard max: ${STRUCTURED_ALL_MAX_ROWS} rows)`)
    .option("--full", "Emit full memory objects in JSON instead of compact projections")
    .option("--max-bytes <n>", `JSON response byte ceiling (hard max: ${STRUCTURED_ALL_MAX_BYTES})`, parseInt)
    .action((opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const fmt = getOutputFormat(program, opts.format as string | undefined);
        const isJson = fmt === "json";
        assertStructuredFlags(opts as Record<string, unknown>, isJson);

        const requestedLimit = opts.limit as number | undefined;
        const all = Boolean(opts.all);
        const detail: StructuredMemoryDetail = opts.full ? "full" : "compact";
        const limit = requestedLimit === undefined
          ? isJson || fmt === "compact"
            ? DEFAULT_COMPACT_LIMIT
            : undefined
          : positiveIntOrDefault(requestedLimit, DEFAULT_COMPACT_LIMIT);
        if (isJson && limit !== undefined && limit > STRUCTURED_PAGE_MAX_ROWS) {
          throw new Error(
            `--limit cannot exceed the hard page ceiling of ${STRUCTURED_PAGE_MAX_ROWS}; use --all for a bounded exhaustive read`,
          );
        }
        const offset = cursorOrOffset(opts.cursor, opts.offset) ?? 0;
        if (all && offset !== 0) {
          throw new Error("--all requires --cursor/--offset 0");
        }
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

        const target = all ? STRUCTURED_ALL_MAX_ROWS : limit;
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
          target,
          offset,
        );
        if (all && hasMore) {
          throw new Error(
            `Exhaustive structured output exceeds the hard safety limit of ${STRUCTURED_ALL_MAX_ROWS} rows; use paginated JSON output instead`,
          );
        }
        const memories = target === undefined ? collected : collected.slice(0, target);

        // Read-path redaction (I24-00018): sanitize the full projected page
        // before any format branch so every emitted representation is safe.
        const sanitized = memories.map(redactMemoryForOutput);

        if (isJson) {
          process.stdout.write(structuredMemoryOutput({
            memories: sanitized,
            receipt: "mementos.list.page.v1",
            offset,
            limit: limit ?? DEFAULT_COMPACT_LIMIT,
            sourceHasMore: hasMore,
            all,
            detail,
            maxBytes: structuredMaxBytes(opts.maxBytes, { all, detail }),
          }));
          return;
        }

        if (fmt === "csv") {
          console.log("key,value,scope,category,importance,id");
          for (const m of sanitized) {
            const v = m.value.replace(/"/g, '""');
            console.log(`"${m.key}","${v}",${m.scope},${m.category},${m.importance},${m.id.slice(0, 8)}`);
          }
          return;
        }

        if (fmt === "yaml") {
          outputYaml(sanitized);
          return;
        }

        if (sanitized.length === 0) {
          console.log(chalk.yellow("No memories found."));
          return;
        }

        console.log(chalk.bold(`${sanitized.length}${hasMore ? "+" : ""} memor${sanitized.length === 1 ? "y" : "ies"}:`));
        for (const m of sanitized) {
          console.log(formatMemoryLine(m, {
            valueLength: opts.verbose ? 120 : 64,
            preferSummary: !opts.verbose,
          }));
        }
        printPageHint({
          shown: sanitized.length,
          limit: limit ?? sanitized.length,
          offset,
          hasMore,
          command: "mementos list",
          detailHint: "use mementos show <id> for full details or --format json --full for full objects",
        });
      } catch (e) {
        handleError(e);
      }
    });
}
