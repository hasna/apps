import type {
  AgentPresence,
  ChannelInfo,
  Message,
  ProjectInfo,
  SearchResult,
  SearchResultTask,
  Session,
  TaskInfo,
} from "../types.js";
import { takeWindow } from "./message-window.js";

export const DEFAULT_COMPACT_LIMIT = 10;
export const DEFAULT_PREVIEW_CHARS = 160;
export const MAX_COMPACT_LIMIT = 100;

export interface OutputWindow {
  limit: number;
  offset: number;
  requestedLimit?: number;
  requestedOffset?: number;
  limitCapped: boolean;
}

export interface WindowedItems<T> extends OutputWindow {
  items: T[];
  total: number;
  count: number;
  hasMore: boolean;
  nextCursor: number | null;
}

export function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function parseNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function resolveOutputWindow(opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
} = {}): OutputWindow {
  const maxLimit = Math.max(1, Math.floor(opts.maxLimit ?? MAX_COMPACT_LIMIT));
  const defaultLimit = Math.max(1, Math.min(Math.floor(opts.defaultLimit ?? DEFAULT_COMPACT_LIMIT), maxLimit));
  const requestedLimit = parsePositiveInteger(opts.limit);
  const requestedOffset = parseNonNegativeInteger(opts.cursor);
  const rawLimit = requestedLimit ?? defaultLimit;
  const limit = Math.min(rawLimit, maxLimit);
  return {
    limit,
    offset: requestedOffset ?? 0,
    requestedLimit,
    requestedOffset,
    limitCapped: rawLimit > maxLimit,
  };
}

export function windowItems<T>(items: T[], opts: OutputWindow): WindowedItems<T> {
  const total = items.length;
  const start = Math.min(opts.offset, total);
  const end = Math.min(start + opts.limit, total);
  const page = items.slice(start, end);
  const hasMore = end < total;
  return {
    ...opts,
    items: page,
    total,
    count: page.length,
    hasMore,
    nextCursor: hasMore ? end : null,
  };
}

/**
 * Window an over-fetched (`limit + 1`) query result.
 *
 * `newestWindow` says the rows are the newest N+1 in chronological order, so the
 * page asked for is the TAIL — keeping the head would drop the newest row, which
 * is the whole point of a recency read (todos 2c25973b).
 */
export function pageQueriedItems<T>(items: T[], opts: OutputWindow, pageOpts: { newestWindow?: boolean } = {}) {
  const page = takeWindow(items, opts.limit, pageOpts.newestWindow === true);
  const hasMore = items.length > opts.limit;
  return {
    items: page,
    count: page.length,
    limit: opts.limit,
    cursor: opts.offset,
    next_cursor: hasMore ? opts.offset + page.length : null,
    has_more: hasMore,
    limit_capped: opts.limitCapped,
  };
}

export function previewText(value: string | null | undefined, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const max = Math.max(1, Math.floor(maxChars));
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  if (max <= 3) return normalized.slice(0, max);
  return `${normalized.slice(0, max - 3)}...`;
}

export function isPreviewTruncated(value: string | null | undefined, maxChars = DEFAULT_PREVIEW_CHARS): boolean {
  return (value ?? "").replace(/\s+/g, " ").trim().length > Math.max(1, Math.floor(maxChars));
}

export function summarizeMessage(msg: Message, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    id: msg.id,
    session_id: msg.session_id,
    from_agent: msg.from_agent,
    to_agent: msg.to_agent,
    channel: msg.channel,
    created_at: msg.created_at,
    priority: msg.priority,
    unread: !msg.read_at,
    blocking: msg.blocking,
    reply_to: msg.reply_to,
    reply_count: msg.reply_count,
    attachment_count: msg.attachments?.length ?? 0,
    preview: previewText(msg.content, maxChars),
    truncated: isPreviewTruncated(msg.content, maxChars),
  };
}

export function summarizeSearchMessage(msg: SearchResult, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    ...summarizeMessage(msg, maxChars),
    snippet: msg.snippet ? previewText(msg.snippet, maxChars) : null,
    relevance_score: msg.relevance_score,
  };
}

export function summarizeTask(task: TaskInfo | SearchResultTask, maxChars = DEFAULT_PREVIEW_CHARS) {
  const searchTask = task as SearchResultTask;
  return {
    id: task.id,
    uuid: task.uuid,
    subject: previewText(task.subject, maxChars),
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    reporter: task.reporter,
    project_id: task.project_id,
    channel: task.channel,
    due_at: task.due_at,
    subtask_count: task.subtask_count,
    comment_count: task.comment_count,
    dependency_count: task.dependency_count,
    blocker_count: task.blocker_info?.length ?? 0,
    description_preview: task.description ? previewText(task.description, maxChars) : null,
    snippet: searchTask.snippet ? previewText(searchTask.snippet, maxChars) : undefined,
    relevance_score: searchTask.relevance_score,
  };
}

export function summarizeChannel(channel: ChannelInfo, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    name: channel.name,
    description_preview: channel.description ? previewText(channel.description, maxChars) : null,
    topic_preview: channel.topic ? previewText(channel.topic, maxChars) : null,
    project_id: channel.project_id,
    archived: Boolean(channel.archived_at),
    member_count: channel.member_count,
    message_count: channel.message_count,
  };
}

export function summarizeProject(project: ProjectInfo, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    description_preview: project.description ? previewText(project.description, maxChars) : null,
    path: project.path ? previewText(project.path, 96) : null,
    repository: project.repository ? previewText(project.repository, 96) : null,
    tag_count: project.tags.length,
    channel_count: project.channel_count,
    created_by: project.created_by,
    created_at: project.created_at,
  };
}

export function summarizeAgent(agent: AgentPresence) {
  return {
    agent: agent.agent,
    role: agent.role,
    status: agent.status,
    online: agent.online,
    project_id: agent.project_id,
    last_seen_at: agent.last_seen_at,
  };
}

export function summarizeSession(session: Session) {
  const participantLimit = 8;
  return {
    session_id: session.session_id,
    participants: session.participants.slice(0, participantLimit),
    participant_count: session.participants.length,
    participants_truncated: session.participants.length > participantLimit,
    last_message_at: session.last_message_at,
    message_count: session.message_count,
    unread_count: session.unread_count,
  };
}

export function compactCollection<T>(items: T[], opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}) {
  const window = resolveOutputWindow(opts);
  const page = windowItems(items, window);
  return {
    items: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    limit_capped: page.limitCapped,
  };
}
