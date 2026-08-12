import {
  DEFAULT_COMPACT_LIMIT,
  pageQueriedItems,
  resolveOutputWindow,
  summarizeAgent,
  summarizeChannel,
  summarizeMessage,
  summarizeProject,
  summarizeSearchMessage,
  summarizeSession,
  summarizeTask,
  windowItems,
} from "../lib/compact-output.js";
import {
  AGENT_LIST_ORDER,
  CHANNEL_LIST_ORDER,
  PROJECT_LIST_ORDER,
  SESSION_LIST_ORDER,
  type SortDescriptor,
} from "../lib/list-order.js";
import { getStore } from "../lib/store/index.js";

/**
 * The MCP tools do NOT share the CLI's rendering path — this file is a second,
 * parallel implementation — so a CLI-only ordering disclosure would leave every
 * MCP caller exactly as blind as the CLI was. That gap is why MCP surfaces are
 * treated as a separate rung on this fleet rather than assumed to inherit a CLI
 * fix.
 *
 * These envelopes already carried `count`, `total`, `limit`, `cursor`,
 * `next_cursor` and `has_more`. The one thing missing was WHICH rows, which is
 * the field a caller needs to know it is holding the start of a window.
 */
function orderFields(sort: SortDescriptor) {
  return { sort: sort.sort, direction: sort.direction };
}
import type {
  AgentPresence,
  ChannelInfo,
  Message,
  MessagePreviewPage,
  ProjectInfo,
  SearchResult,
  SearchResultTask,
  Session,
  TaskInfo,
} from "../types.js";

export function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function resolveMcpWindow(args: Record<string, unknown>, defaultLimit = DEFAULT_COMPACT_LIMIT) {
  return resolveOutputWindow({
    limit: args.limit,
    cursor: args.cursor ?? args.offset,
    defaultLimit,
  });
}

/**
 * `sort` is REQUIRED and has no default, deliberately.
 *
 * This helper serves four tools with three different orderings —
 * `read_messages` and `read_channel` (message order, which `latest` can
 * invert), `get_pinned_messages` (`pinned_at DESC`) and `get_unread_blockers`
 * (`created_at ASC`). It previously derived one descriptor internally from
 * `args.order`, which made it right for the first two only when `latest` was
 * absent, and wrong in BOTH field and direction for pinned. A default here is
 * what let a shared helper state one query's ordering over another's, so the
 * caller that issues the query must now name the ordering it issued, and a new
 * call site cannot compile without doing so.
 *
 * `pageOpts.newestWindow` says the rows are a NEWEST-anchored window, so an
 * over-fetched page keeps its TAIL rather than its head. Keeping the head is
 * what dropped the newest message a recency read had just gone to fetch
 * (todos 2c25973b). It is separate from `sort`: `sort` states the direction the
 * returned rows are in, `newestWindow` states which end of the window they came
 * from, and a reader needs both.
 */
export function compactQueriedMessages(
  messages: Message[],
  args: Record<string, unknown>,
  sort: SortDescriptor,
  pageOpts: { newestWindow?: boolean } = {},
) {
  const window = resolveMcpWindow(args);
  const page = pageQueriedItems(messages, window, pageOpts);
  return {
    messages: page.items.map((message) => summarizeMessage(message)),
    ...orderFields(sort),
    count: page.count,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    hint: "Use verbose:true for full records or get_message with an id for one full message.",
  };
}

/**
 * Emit a store `MessagePreviewPage` as an MCP envelope WITHOUT re-deriving any
 * of its bounds.
 *
 * The adapters used to take a `Message[]`, re-count it, and compute `has_more`
 * from whether an over-fetch returned one extra row. That silently discarded
 * four fields the store had already decided — `skipped_count`, `byte_length`,
 * `max_bytes`, `timeout_ms` — and, worse, got `has_more` WRONG in the one case
 * it matters: when the store dropped rows to stay under its byte cap, the
 * over-fetch count said "no more" and the client stopped paging on a page the
 * store knew was partial. A confident complete answer over a truncated read is
 * the failure mode; the store is the only layer that knows, so it is the only
 * layer that gets to say.
 *
 * `page.messages` is already the bounded, redacted projection and is a strict
 * superset of what `summarizeMessage` emitted, so no consumer loses a field.
 */
export function compactPreviewPage(
  page: MessagePreviewPage,
  sort: SortDescriptor,
  opts: { key?: string; hint?: string; query?: string } = {},
) {
  const key = opts.key ?? "messages";
  return {
    [key]: page.messages,
    ...orderFields(sort),
    count: page.count,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    skipped_count: page.skipped_count,
    byte_length: page.byte_length,
    max_bytes: page.max_bytes,
    timeout_ms: page.timeout_ms,
    ...(opts.query ? { query: opts.query } : {}),
    compact: true,
    detail_path: page.detail_path,
    hint: opts.hint
      ?? "Preview page. Use get_message with an id for one full message; page with cursor until has_more is false.",
  };
}

/** The collection options every preview-page tool accepts, parsed strictly. */
export function resolveMcpPageOptions(args: Record<string, unknown>): {
  limit: number;
  offset: number;
  max_bytes: number | undefined;
  preview_bytes: number | undefined;
  timeout_ms: number | undefined;
} {
  const window = resolveMcpWindow(args);
  return {
    limit: window.limit,
    offset: window.offset,
    max_bytes: typeof args.max_bytes === "number" ? args.max_bytes : undefined,
    preview_bytes: typeof args.preview_bytes === "number" ? args.preview_bytes : undefined,
    timeout_ms: typeof args.timeout_ms === "number" ? args.timeout_ms : undefined,
  };
}

export function compactQueriedSearchMessages(messages: SearchResult[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = pageQueriedItems(messages, window);
  return {
    results: page.items.map((message) => summarizeSearchMessage(message)),
    ...orderFields(getStore().describeListOrder("search", { sort: typeof args.sort === "string" ? args.sort : undefined })),
    count: page.count,
    query: args.query,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    hint: "Use verbose:true for full records or get_message with an id for one full message.",
  };
}

export function compactWindowedSessions(sessions: Session[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = windowItems(sessions, window);
  return {
    sessions: page.items.map(summarizeSession),
    ...orderFields(SESSION_LIST_ORDER),
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    compact: true,
    hint: "Use verbose:true for full session records.",
  };
}

export function compactWindowedChannels(channels: ChannelInfo[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = windowItems(channels, window);
  return {
    channels: page.items.map(summarizeChannel),
    ...orderFields(CHANNEL_LIST_ORDER),
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    compact: true,
    hint: "Use verbose:true for full channel records; use read_channel for messages.",
  };
}

export function compactWindowedProjects(projects: ProjectInfo[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = windowItems(projects, window);
  return {
    projects: page.items.map(summarizeProject),
    ...orderFields(PROJECT_LIST_ORDER),
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    compact: true,
    hint: "Use verbose:true for full project records or get_project for one project.",
  };
}

export function compactWindowedAgents(agents: AgentPresence[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = windowItems(agents, window);
  return {
    agents: page.items.map(summarizeAgent),
    ...orderFields(AGENT_LIST_ORDER),
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    compact: true,
    hint: "Use verbose:true for full agent presence records.",
  };
}

export function compactQueriedTasks(tasks: Array<TaskInfo | SearchResultTask>, args: Record<string, unknown>, key = "tasks") {
  const window = resolveMcpWindow(args);
  const page = pageQueriedItems(tasks, window);
  return {
    [key]: page.items.map((task) => summarizeTask(task)),
    count: page.count,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    hint: "Use verbose:true for full task records or get_task with an id for one task.",
  };
}
