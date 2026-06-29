import {
  parseContract,
  SCHEMA_IDS,
  type ProjectPanel,
  type ProjectPanelInput,
} from "@hasna/contracts";
import { getDb } from "./db.js";
import { listChannels } from "./channels.js";
import { normalizeChannelName } from "./channel-names.js";
import { readMessages } from "./messages.js";
import { listAgents } from "./presence.js";
import { getProject, getProjectByName, listProjects } from "./projects.js";
import { getChannelTopics } from "./topics.js";
import type { ChannelInfo, Message, ProjectInfo } from "../types.js";

export interface ConversationsProjectPanelOptions {
  limit?: number;
}

const SOURCE_PACKAGE = "@hasna/conversations";

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? 0)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 20)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "project";
}

function resolveProject(ref: string): ProjectInfo | null {
  const direct = getProject(ref) ?? getProjectByName(ref);
  if (direct) return direct;
  const wanted = slugify(ref);
  return listProjects().find((project) => slugify(project.name) === wanted) ?? null;
}

function toTimestamp(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function projectPanelId(project: ProjectInfo | null, projectRef: string): string {
  return slugify(project?.name ?? projectRef);
}

function projectResource(projectId: string, projectName: string, externalId: string) {
  return {
    kind: "project" as const,
    id: projectId,
    name: projectName,
    uri: `project://${projectId}`,
    externalId,
    sourcePackage: SOURCE_PACKAGE,
  };
}

function channelResource(channel: ChannelInfo) {
  return {
    kind: "conversation" as const,
    id: channel.name,
    name: `#${channel.name}`,
    uri: `conversation://channel/${channel.name}`,
    externalId: channel.name,
    sourcePackage: SOURCE_PACKAGE,
    tags: channel.tags,
  };
}

function messageResource(message: Message) {
  return {
    kind: "comment" as const,
    id: String(message.id),
    name: message.channel ? `#${message.channel} message ${message.id}` : `message ${message.id}`,
    uri: `conversation://messages/${message.id}`,
    externalId: String(message.id),
    sourcePackage: SOURCE_PACKAGE,
  };
}

function actionResource(id: string, name: string) {
  return {
    kind: "action" as const,
    id,
    name,
    sourcePackage: SOURCE_PACKAGE,
    externalId: id,
  };
}

function preview(content: string, max = 180): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function priorityForMessage(message: Message): "low" | "medium" | "high" | "critical" | "unknown" {
  if (message.blocking || message.priority === "urgent") return "critical";
  if (message.priority === "high") return "high";
  if (message.priority === "normal") return "medium";
  if (message.priority === "low") return "low";
  return "unknown";
}

function stateForConversation(channels: ChannelInfo[], messages: Message[]): ProjectPanelInput["state"] {
  return channels.length === 0 && messages.length === 0 ? "empty" : "ready";
}

function countMessages(projectId: string | null, channelNames: string[]): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];
  const scope: string[] = [];
  if (projectId) {
    scope.push("project_id = ?");
    params.push(projectId);
  }
  if (channelNames.length > 0) {
    scope.push(`channel IN (${channelNames.map(() => "?").join(",")})`);
    params.push(...channelNames);
  }
  if (scope.length === 0) {
    return 0;
  }
  conditions.push(`(${scope.join(" OR ")})`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  const row = db.prepare(`SELECT COUNT(*) AS total FROM messages ${where}`).get(...params) as { total: number } | null;
  return row?.total ?? 0;
}

function countBlocking(projectId: string | null, channelNames: string[]): number {
  const db = getDb();
  const conditions = ["blocking = 1"];
  const params: string[] = [];
  const scope: string[] = [];
  if (projectId) {
    scope.push("project_id = ?");
    params.push(projectId);
  }
  if (channelNames.length > 0) {
    scope.push(`channel IN (${channelNames.map(() => "?").join(",")})`);
    params.push(...channelNames);
  }
  if (scope.length === 0) {
    return 0;
  }
  conditions.push(`(${scope.join(" OR ")})`);
  const row = db.prepare(`SELECT COUNT(*) AS total FROM messages WHERE ${conditions.join(" AND ")}`).get(...params) as { total: number } | null;
  return row?.total ?? 0;
}

function selectMessages(projectId: string | null, channels: ChannelInfo[], limit: number): Message[] {
  const messagesById = new Map<number, Message>();
  if (projectId) {
    for (const message of readMessages({
      project_id: projectId,
      latest: limit,
      max_content_length: 200,
      include_reply_counts: true,
    })) {
      messagesById.set(message.id, message);
    }
  }

  const channelLimit = projectId ? limit : Math.max(1, Math.ceil(limit / Math.max(1, channels.length)));
  for (const channel of channels) {
    for (const message of readMessages({
      channel: channel.name,
      latest: channelLimit,
      max_content_length: 200,
      include_reply_counts: true,
    })) {
      messagesById.set(message.id, message);
    }
  }

  return [...messagesById.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
}

function projectChannels(project: ProjectInfo | null, projectRef: string, limit: number): ChannelInfo[] {
  if (project) return listChannels({ project_id: project.id }).slice(0, limit);
  const normalized = normalizeChannelName(projectRef);
  const iproj = `iproj-${normalized.replace(/^iproj-/, "")}`;
  const matches = listChannels().filter((channel) => channel.name === normalized || channel.name === iproj);
  return matches.slice(0, limit);
}

function collectTopics(channels: ChannelInfo[], limit: number): string[] {
  const topics = new Map<string, number>();
  for (const channel of channels.slice(0, Math.min(limit, 5))) {
    for (const topic of getChannelTopics(channel.name, { limit: 50 }).slice(0, 5)) {
      topics.set(topic.topic, (topics.get(topic.topic) ?? 0) + topic.count);
    }
  }
  return [...topics.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([topic]) => topic);
}

export function createConversationsProjectPanel(projectRef: string, options: ConversationsProjectPanelOptions = {}): ProjectPanel {
  const limit = clampLimit(options.limit);
  const generatedAt = new Date().toISOString();
  const project = resolveProject(projectRef);
  const projectId = projectPanelId(project, projectRef);
  const channels = projectChannels(project, projectRef, limit);
  const channelNames = channels.map((channel) => channel.name);
  const messages = selectMessages(project?.id ?? null, channels, limit);
  const messageCount = countMessages(project?.id ?? null, channelNames);
  const blockingCount = countBlocking(project?.id ?? null, channelNames);
  const unreadCount = messages.filter((message) => message.read_at === null).length;
  const onlineAgents = listAgents({ online_only: true }).filter((agent) => !project || agent.project_id === project.id || agent.project_id === null);
  const participants = new Set<string>(messages.flatMap((message) => [message.from_agent, message.to_agent]).filter(Boolean));
  for (const channel of channels) {
    if (channel.created_by) participants.add(channel.created_by);
  }
  const latest = messages[0] ?? null;
  const state = stateForConversation(channels, messages);
  const topics = collectTopics(channels, limit);
  const warnings = project ? [] : [
    `No conversations project matched "${projectRef}"; checked direct project refs and #iproj-${normalizeChannelName(projectRef).replace(/^iproj-/, "")}.`,
  ];

  const draft: ProjectPanelInput = {
    schema: SCHEMA_IDS.projectPanel,
    id: `conversations_panel_${projectId}`,
    createdAt: generatedAt,
    projectId,
    provider: {
      kind: "conversations",
      id: `conversations_${projectId}`,
      name: "Conversations",
      sourcePackage: SOURCE_PACKAGE,
      externalId: project?.id ?? projectId,
    },
    kind: "conversations",
    title: "Conversations",
    summary: state === "empty"
      ? "No project conversation channels or messages are available yet."
      : `${channels.length} channel${channels.length === 1 ? "" : "s"} and ${messageCount} message${messageCount === 1 ? "" : "s"} for project coordination.`,
    state,
    generatedAt,
    freshness: latest ? "fresh" : "unknown",
    metrics: [
      { id: "channels", label: "Channels", value: channels.length, status: channels.length > 0 ? "good" : "unknown" },
      { id: "messages", label: "Messages", value: messageCount, status: messageCount > 0 ? "good" : "unknown" },
      { id: "recent_items", label: "Recent items", value: messages.length, status: messages.length > 0 ? "good" : "unknown" },
      { id: "unread_recent", label: "Unread recent", value: unreadCount, status: unreadCount > 0 ? "warning" : "good" },
      { id: "blocking_messages", label: "Blocking", value: blockingCount, status: blockingCount > 0 ? "critical" : "good" },
      { id: "participants", label: "Participants", value: participants.size, status: participants.size > 0 ? "good" : "unknown" },
      { id: "online_agents", label: "Online agents", value: onlineAgents.length, status: onlineAgents.length > 0 ? "good" : "unknown" },
      { id: "topics", label: "Topics", value: topics.length, status: topics.length > 0 ? "good" : "unknown" },
    ],
    items: messages.map((message) => ({
      id: String(message.id),
      title: message.channel ? `#${message.channel}: ${message.from_agent}` : `${message.from_agent} -> ${message.to_agent}`,
      summary: preview(message.content),
      status: message.blocking ? "blocking" : message.read_at ? "read" : "unread",
      priority: priorityForMessage(message),
      timestamp: toTimestamp(message.created_at),
      resourceRefs: [
        messageResource(message),
        ...(message.channel ? channels.filter((channel) => channel.name === message.channel).slice(0, 1).map(channelResource) : []),
      ],
      metadata: {
        channel: message.channel,
        from_agent: message.from_agent,
        to_agent: message.to_agent,
        reply_to: message.reply_to,
        reply_count: message.reply_count ?? 0,
        has_attachments: Boolean(message.attachments?.length),
      },
    })),
    actions: [
      actionResource("conversations:read", "Read project messages"),
      actionResource("conversations:send", "Send project update"),
      actionResource("conversations:channel", "Manage channels"),
    ],
    resourceRefs: [
      projectResource(projectId, project?.name ?? projectRef, project?.id ?? projectId),
      ...channels.map(channelResource),
    ],
    renderFragment: {
      renderer: "json_render",
      title: "Conversations",
      spec: {
        component: "project.conversations.summary",
        metrics: ["channels", "messages", "blocking_messages", "participants", "online_agents"],
        topics,
        itemLimit: limit,
      },
    },
    warnings,
  };

  return parseContract(SCHEMA_IDS.projectPanel, draft);
}
