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

export function compactQueriedMessages(messages: Message[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = pageQueriedItems(messages, window);
  return {
    messages: page.items.map((message) => summarizeMessage(message)),
    count: page.count,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    hint: "Use get_message with an id for one exact full message; collection reads remain preview-only.",
  };
}

export function compactQueriedSearchMessages(messages: SearchResult[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = pageQueriedItems(messages, window);
  return {
    results: page.items.map((message) => summarizeSearchMessage(message)),
    count: page.count,
    query: args.query,
    limit: page.limit,
    cursor: page.cursor,
    next_cursor: page.next_cursor,
    has_more: page.has_more,
    compact: true,
    hint: "Use get_message with an id for one exact full message; collection searches remain preview-only.",
  };
}

export function compactWindowedSessions(sessions: Session[], args: Record<string, unknown>) {
  const window = resolveMcpWindow(args);
  const page = windowItems(sessions, window);
  return {
    sessions: page.items.map(summarizeSession),
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
