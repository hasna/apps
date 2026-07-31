// ── ApiStore: the self_hosted / cloud HTTP transport ─────────────────────────
//
// Implements {@link ConversationsStore} against the app's own `/v1` HTTP API with
// a bearer key. Both `self_hosted` and `cloud` use this identical client code;
// only the URL/key differ (server-side tenancy). Every method here is a network
// call — there is NO local sqlite fallback (that was the split-brain bug). When a
// server endpoint is missing the call surfaces as a `HasnaHttpError`, never a
// silent local write.
//
// SAFETY: the bearer key lives only inside the transport; it is never logged,
// returned, or embedded in any value produced here.

import type { HasnaStorageClient } from "../contracts-client/storage.js";
import type { ConversationsStore } from "./index.js";
import { normalizeChannelName } from "../channel-names.js";
import { AGENT_LIST_ORDER, CHANNEL_LIST_ORDER, SEARCH_RECENT_ORDER, describeMessageOrder } from "../list-order.js";
import { normalizeSince } from "../since.js";
import { resolveReadLimit, resolveReadWindow } from "../message-window.js";
import { parseProject } from "../projects.js";
import { attachSendRedaction } from "../content-safety.js";
import {
  parseMessage,
  compactMessage,
  resolveDigestMaxBytes,
  resolveDigestLimit,
  resolveDigestCursor,
  assembleDigest,
  type DigestNorm,
} from "../messages.js";

type Q = Record<string, string | number | boolean | undefined | null>;

function prune(q: Q): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

/** Duck-typed HasnaHttpError status check (class identity differs across bundles). */
function isHttpStatus(error: unknown, status: number): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "HasnaHttpError" &&
      (error as { status?: number }).status === status,
  );
}

export class ApiStore implements ConversationsStore {
  readonly transport = "cloud-http" as const;
  constructor(private readonly client: HasnaStorageClient) {}

  /**
   * The ordering this client ASKS the server for, which is what a caller must
   * disclose. Note the divergence from LocalStore on `search`: the `/messages`
   * search path offers no relevance ranking, so this transport requests
   * `created_at DESC` and says so rather than repeating LocalStore's
   * "relevance". A CLI footer that hardcoded either one would be true on one
   * transport and a lie on the other, which is why the descriptor is asked of
   * the store.
   */
  describeListOrder: ConversationsStore["describeListOrder"] = (kind, opts) => {
    switch (kind) {
      case "messages": return describeMessageOrder(opts?.order);
      case "search": return SEARCH_RECENT_ORDER;
      case "channels": return CHANNEL_LIST_ORDER;
      case "agents": return AGENT_LIST_ORDER;
    }
  };

  private get t() {
    return this.client.transport;
  }

  private async get<T>(path: string, query?: Q): Promise<T> {
    return this.t.get<T>(path, query ? { query: prune(query) } : undefined);
  }
  private async post<T>(path: string, body?: unknown, query?: Q): Promise<T> {
    return this.t.post<T>(path, body, query ? { query: prune(query) } : undefined);
  }
  private async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.t.patch<T>(path, body);
  }
  private async del(path: string, query?: Q): Promise<void> {
    await this.t.del(path, undefined, query ? { query: prune(query) } : undefined);
  }

  // ── health ──────────────────────────────────────────────────────────────────
  // Cloud-mode probe for `doctor`: an authenticated, cheap count round-trips the
  // /v1 API so a flipped client verifies reachability AND that its bearer key
  // works. The base URL (no secret) is surfaced; the key never leaves the transport.
  health: ConversationsStore["health"] = async () => {
    try {
      await this.get<{ count?: number }>("/messages", { count: 1, limit: 1 });
      return [{ name: "Cloud API", ok: true, message: `OK — reachable at ${this.client.baseUrl}` }];
    } catch (e) {
      return [{ name: "Cloud API", ok: false, message: `Unreachable/unauthorized at ${this.client.baseUrl}: ${(e as Error).message}` }];
    }
  };

  // ── channels ────────────────────────────────────────────────────────────────
  createChannel: ConversationsStore["createChannel"] = async (name, createdBy, options) => {
    const body = await this.post<{ channel: unknown }>("/channels", { name, created_by: createdBy, ...(options ?? {}) });
    return body.channel as never;
  };
  listChannels: ConversationsStore["listChannels"] = async (options) => {
    const body = await this.get<{ channels?: unknown[] }>("/channels", {
      project_id: options?.project_id,
      include_archived: options?.include_archived ? true : undefined,
      tag: options?.tag,
    });
    return (body.channels ?? []) as never;
  };
  getChannel: ConversationsStore["getChannel"] = async (name) => {
    try {
      const body = await this.get<{ channel: unknown } | null>(`/channels/${encodeURIComponent(normalizeChannelName(name))}`);
      return (body?.channel ?? null) as never;
    } catch (e) {
      // The server 404s a missing channel; the LocalStore contract is null.
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  joinChannel: ConversationsStore["joinChannel"] = async (channelName, agent) => {
    const body = await this.post<{ joined?: boolean }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members`, { agent });
    return Boolean(body?.joined) as never;
  };
  leaveChannel: ConversationsStore["leaveChannel"] = async (channelName, agent) => {
    try {
      await this.del(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  getChannelMembers: ConversationsStore["getChannelMembers"] = async (channelName) => {
    const body = await this.get<{ members?: unknown[] }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members`);
    return (body.members ?? []) as never;
  };
  getMemberChannels: ConversationsStore["getMemberChannels"] = async (agent) => {
    const body = await this.get<{ channels?: Array<Record<string, unknown>> }>("/channels/mine", { agent });
    return (body.channels ?? []).map((r) => ({
      name: String(r.name),
      description: (r.description as string) ?? null,
      unread: Number(r.unread ?? 0),
    })) as never;
  };
  updateChannel: ConversationsStore["updateChannel"] = async (name, updates) => {
    const body = await this.patch<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}`, updates);
    return body.channel as never;
  };
  renameChannel: ConversationsStore["renameChannel"] = async (oldName, newName) => {
    const body = await this.patch<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(oldName))}`, { name: newName });
    return body.channel as never;
  };
  archiveChannel: ConversationsStore["archiveChannel"] = async (name) => {
    const body = await this.post<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}/archive`);
    return body.channel as never;
  };
  unarchiveChannel: ConversationsStore["unarchiveChannel"] = async (name) => {
    const body = await this.post<{ channel: unknown }>(`/channels/${encodeURIComponent(normalizeChannelName(name))}/unarchive`);
    return body.channel as never;
  };
  isChannelMember: ConversationsStore["isChannelMember"] = async (channelName, agent) => {
    const body = await this.get<{ member?: boolean }>(`/channels/${encodeURIComponent(normalizeChannelName(channelName))}/members/${encodeURIComponent(agent)}`);
    return Boolean(body?.member) as never;
  };

  // ── channel notifications ─────────────────────────────────────────────────────
  subscribeToChannelNotifications: ConversationsStore["subscribeToChannelNotifications"] = async (channel, agent, opts) => {
    const body = await this.post<{ subscription: unknown }>("/channel-notifications", { channel: normalizeChannelName(channel), agent, ...(opts ?? {}) });
    return body.subscription as never;
  };
  unsubscribeFromChannelNotifications: ConversationsStore["unsubscribeFromChannelNotifications"] = async (channel, agent) => {
    try {
      await this.del(`/channel-notifications/${encodeURIComponent(normalizeChannelName(channel))}/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  listChannelNotificationSubscriptions: ConversationsStore["listChannelNotificationSubscriptions"] = async (agent) => {
    const body = await this.get<{ subscriptions?: unknown[] }>("/channel-notifications", { agent });
    return (body.subscriptions ?? []) as never;
  };
  getSubscribedChannels: ConversationsStore["getSubscribedChannels"] = async (agent) => {
    const body = await this.get<{ channels?: string[] }>("/channel-notifications/subscribed", { agent });
    return (body.channels ?? []) as never;
  };
  readChannelNotifications: ConversationsStore["readChannelNotifications"] = async (opts) => {
    const body = await this.get<{ notifications?: unknown[] }>("/channel-notifications/inbox", {
      agent: opts.agent,
      channel: opts.channel ? normalizeChannelName(opts.channel) : undefined,
      unread_only: opts.unread_only ? true : undefined,
      limit: opts.limit,
      since: normalizeSince(opts.since),
    });
    return (body.notifications ?? []) as never;
  };
  markChannelNotificationsRead: ConversationsStore["markChannelNotificationsRead"] = async (agent, messageIds) => {
    const body = await this.post<{ marked?: number }>("/channel-notifications/read", { agent, message_ids: messageIds });
    return Number(body?.marked ?? 0) as never;
  };
  markAllChannelNotificationsRead: ConversationsStore["markAllChannelNotificationsRead"] = async (agent, channel) => {
    const body = await this.post<{ marked?: number }>("/channel-notifications/read-all", { agent, channel: channel ? normalizeChannelName(channel) : undefined });
    return Number(body?.marked ?? 0) as never;
  };

  // ── tasks ─────────────────────────────────────────────────────────────────────
  createTask: ConversationsStore["createTask"] = async (opts) => {
    const body = await this.post<{ task: unknown }>("/tasks", opts);
    return body.task as never;
  };
  getTask: ConversationsStore["getTask"] = async (idOrUuid) => {
    const body = await this.get<{ task: unknown } | null>(`/tasks/${encodeURIComponent(String(idOrUuid))}`);
    return (body?.task ?? null) as never;
  };
  listTasks: ConversationsStore["listTasks"] = async (opts) => {
    const o = opts ?? {};
    const body = await this.get<{ tasks?: unknown[] }>("/tasks", {
      status: o.status, assignee: o.assignee, reporter: o.reporter, project_id: o.project_id,
      channel: o.channel, priority: o.priority, tag: o.tag, limit: o.limit, offset: o.offset,
      include_archived: o.include_archived ? true : undefined,
      parent_id: o.parent_id === null ? "null" : o.parent_id,
    });
    return (body.tasks ?? []) as never;
  };
  private async taskAction(id: number | string, action: string, body?: unknown): Promise<unknown> {
    const res = await this.post<{ task: unknown } | null>(`/tasks/${encodeURIComponent(String(id))}/${action}`, body);
    return res?.task ?? null;
  }
  startTask: ConversationsStore["startTask"] = async (id, agent) => (await this.taskAction(id, "start", { agent })) as never;
  completeTask: ConversationsStore["completeTask"] = async (id, agent, opts) => (await this.taskAction(id, "complete", { agent, ...(opts ?? {}) })) as never;
  cancelTask: ConversationsStore["cancelTask"] = async (id, agent, opts) => (await this.taskAction(id, "cancel", { agent, ...(opts ?? {}) })) as never;
  blockTask: ConversationsStore["blockTask"] = async (id, agent, opts) => (await this.taskAction(id, "block", { agent, ...(opts ?? {}) })) as never;
  unblockTask: ConversationsStore["unblockTask"] = async (id, agent) => (await this.taskAction(id, "unblock", { agent })) as never;
  reopenTask: ConversationsStore["reopenTask"] = async (id, agent) => (await this.taskAction(id, "reopen", { agent })) as never;
  assignTask: ConversationsStore["assignTask"] = async (id, assignee, agent) => (await this.taskAction(id, "assign", { assignee, agent })) as never;
  setTaskPriority: ConversationsStore["setTaskPriority"] = async (id, priority, agent) => (await this.taskAction(id, "priority", { priority, agent })) as never;
  addTaskComment: ConversationsStore["addTaskComment"] = async (taskId, agent, content) => {
    const body = await this.post<{ comment: unknown }>(`/tasks/${encodeURIComponent(String(taskId))}/comments`, { agent, content });
    return body.comment as never;
  };
  getTaskComments: ConversationsStore["getTaskComments"] = async (taskId) => {
    const body = await this.get<{ comments?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/comments`);
    return (body.comments ?? []) as never;
  };
  getSubtasks: ConversationsStore["getSubtasks"] = async (parentId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(parentId))}/subtasks`);
    return (body.tasks ?? []) as never;
  };
  getTaskTree: ConversationsStore["getTaskTree"] = async (parentId, maxDepth) => {
    const body = await this.get<{ tree: unknown }>(`/tasks/${encodeURIComponent(String(parentId))}/tree`, { max_depth: maxDepth });
    return body.tree as never;
  };
  addDependency: ConversationsStore["addDependency"] = async (taskId, dependsOnId) => {
    await this.post(`/tasks/${encodeURIComponent(String(taskId))}/dependencies`, { depends_on: dependsOnId });
    return undefined as never;
  };
  removeDependency: ConversationsStore["removeDependency"] = async (taskId, dependsOnId) => {
    await this.del(`/tasks/${encodeURIComponent(String(taskId))}/dependencies/${encodeURIComponent(String(dependsOnId))}`);
    return undefined as never;
  };
  getDependencies: ConversationsStore["getDependencies"] = async (taskId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/dependencies`);
    return (body.tasks ?? []) as never;
  };
  getDependents: ConversationsStore["getDependents"] = async (taskId) => {
    const body = await this.get<{ tasks?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/dependents`);
    return (body.tasks ?? []) as never;
  };
  getTaskActivity: ConversationsStore["getTaskActivity"] = async (taskId, limit) => {
    const body = await this.get<{ activity?: unknown[] }>(`/tasks/${encodeURIComponent(String(taskId))}/activity`, { limit });
    return (body.activity ?? []) as never;
  };
  deleteTask: ConversationsStore["deleteTask"] = async (id, agent) => {
    try {
      await this.del(`/tasks/${encodeURIComponent(String(id))}`, { agent });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  searchTasks: ConversationsStore["searchTasks"] = async (opts) => {
    const body = await this.get<{ tasks?: unknown[] }>("/tasks/search", {
      q: opts.query, status: opts.status, assignee: opts.assignee, project_id: opts.project_id,
      channel: opts.channel, priority: opts.priority, limit: opts.limit, offset: opts.offset,
      sort: opts.sort, include_archived: opts.include_archived ? true : undefined,
    });
    return (body.tasks ?? []) as never;
  };
  getDueTasks: ConversationsStore["getDueTasks"] = async (opts) => {
    const body = await this.get<{ tasks?: unknown[] }>("/tasks/due", opts as Q);
    return (body.tasks ?? []) as never;
  };
  getTaskSummary: ConversationsStore["getTaskSummary"] = async (idOrUuid) => {
    const body = await this.get<{ summary: unknown } | null>(`/tasks/${encodeURIComponent(String(idOrUuid))}/summary`);
    return (body?.summary ?? null) as never;
  };

  // ── locks ─────────────────────────────────────────────────────────────────────
  acquireLock: ConversationsStore["acquireLock"] = async (resourceType, resourceId, agentId, lockType, expiryMs) => {
    const body = await this.post<{ acquired: boolean; lock: unknown; held_by?: string }>("/locks", {
      resource_type: resourceType, resource_id: resourceId, agent_id: agentId, lock_type: lockType, expiry_ms: expiryMs,
    });
    return body as never;
  };
  bulkAcquireLock: ConversationsStore["bulkAcquireLock"] = async (resources, agentId) => {
    const body = await this.post<unknown>("/locks/bulk", { resources, agent_id: agentId });
    return body as never;
  };
  releaseLock: ConversationsStore["releaseLock"] = async (resourceType, resourceId, agentId) => {
    const body = await this.post<{ released?: boolean }>("/locks/release", { resource_type: resourceType, resource_id: resourceId, agent_id: agentId });
    return Boolean(body?.released) as never;
  };
  checkLock: ConversationsStore["checkLock"] = async (resourceType, resourceId) => {
    const body = await this.get<{ lock: unknown }>("/locks/check", { resource_type: resourceType, resource_id: resourceId });
    return (body?.lock ?? null) as never;
  };
  cleanExpiredLocks: ConversationsStore["cleanExpiredLocks"] = async () => {
    const body = await this.post<{ cleaned?: number }>("/locks/clean");
    return Number(body?.cleaned ?? 0) as never;
  };
  releaseStaleAgentLocks: ConversationsStore["releaseStaleAgentLocks"] = async () => {
    const body = await this.post<{ released?: number }>("/locks/release-stale");
    return Number(body?.released ?? 0) as never;
  };
  tryBulkAcquireLock: ConversationsStore["tryBulkAcquireLock"] = async (resources, agentId) => {
    const body = await this.post<unknown>("/locks/bulk", { resources, agent_id: agentId, try: true });
    return body as never;
  };
  listLocks: ConversationsStore["listLocks"] = async (opts) => {
    const body = await this.get<{ locks?: unknown[] }>("/locks", { resource_type: opts?.resource_type, agent_id: opts?.agent_id });
    return (body.locks ?? []) as never;
  };
  listLocksEnriched: ConversationsStore["listLocksEnriched"] = async (opts) => {
    const body = await this.get<{ locks?: unknown[] }>("/locks", { resource_type: opts?.resource_type, agent_id: opts?.agent_id, enriched: true });
    return (body.locks ?? []) as never;
  };

  // ── presence / agents ─────────────────────────────────────────────────────────
  registerAgent: ConversationsStore["registerAgent"] = async (name, sessionId, role, projectId) => {
    const body = await this.post<{ result: unknown }>("/agents", { name, session_id: sessionId, role, project_id: projectId });
    return body.result as never;
  };
  heartbeat: ConversationsStore["heartbeat"] = async (agent, status, metadata, sessionId, projectId) => {
    await this.post("/agents/heartbeat", { agent, status, metadata, session_id: sessionId, project_id: projectId });
    return undefined as never;
  };
  getPresence: ConversationsStore["getPresence"] = async (agent) => {
    const body = await this.get<{ presence: unknown } | null>(`/agents/${encodeURIComponent(agent)}`);
    return (body?.presence ?? null) as never;
  };
  listAgents: ConversationsStore["listAgents"] = async (opts) => {
    const body = await this.get<{ agents?: unknown[] }>("/agents", opts as Q);
    return (body.agents ?? []) as never;
  };
  removePresence: ConversationsStore["removePresence"] = async (agent) => {
    try {
      await this.del(`/agents/${encodeURIComponent(agent)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  renameAgent: ConversationsStore["renameAgent"] = async (oldName, newName) => {
    const body = await this.patch<{ renamed?: boolean }>(`/agents/${encodeURIComponent(oldName)}`, { name: newName });
    return Boolean(body?.renamed) as never;
  };
  setPresenceProject: ConversationsStore["setPresenceProject"] = async (agent, projectId) => {
    await this.patch(`/agents/${encodeURIComponent(agent)}`, { project_id: projectId });
    return undefined as never;
  };

  // ── projects ────────────────────────────────────────────────────────────────
  // Project rows come back raw from the API (tags/metadata/settings as JSON text).
  // Normalize through the shared `parseProject` so cloud mode returns the identical
  // contract as local — `tags` is always an array, never a raw string/null (that
  // mismatch crashed `project get`). `channel_count` is surfaced as ProjectInfo when
  // the server provides it, defaulting to 0.
  private static asProject(row: unknown): Record<string, unknown> {
    return parseProject((row ?? {}) as Record<string, unknown>) as unknown as Record<string, unknown>;
  }
  private static asProjectInfo(row: unknown): Record<string, unknown> {
    const r = (row ?? {}) as Record<string, unknown>;
    return { ...ApiStore.asProject(r), channel_count: Number(r.channel_count ?? 0) };
  }
  createProject: ConversationsStore["createProject"] = async (opts) => {
    const body = await this.post<{ project: unknown }>("/projects", opts);
    return ApiStore.asProject(body.project) as never;
  };
  listProjects: ConversationsStore["listProjects"] = async (opts) => {
    const body = await this.get<{ projects?: unknown[] }>("/projects", opts as Q);
    return (body.projects ?? []).map((p) => ApiStore.asProjectInfo(p)) as never;
  };
  getProject: ConversationsStore["getProject"] = async (id) => {
    try {
      const body = await this.get<{ project: unknown } | null>(`/projects/${encodeURIComponent(id)}`);
      return (body?.project ? ApiStore.asProjectInfo(body.project) : null) as never;
    } catch (e) {
      // The server 404s a missing project; the LocalStore contract is null.
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  getProjectByName: ConversationsStore["getProjectByName"] = async (name) => {
    const body = await this.get<{ project: unknown } | null>("/projects", { name, limit: 1 });
    const list = (body as { projects?: unknown[] } | null)?.projects;
    const row = (list && list[0]) ?? (body as { project?: unknown } | null)?.project ?? null;
    return (row ? ApiStore.asProjectInfo(row) : null) as never;
  };
  updateProject: ConversationsStore["updateProject"] = async (id, updates) => {
    const body = await this.patch<{ project: unknown }>(`/projects/${encodeURIComponent(id)}`, updates);
    return (body?.project ? ApiStore.asProject(body.project) : null) as never;
  };
  deleteProject: ConversationsStore["deleteProject"] = async (id) => {
    try {
      await this.del(`/projects/${encodeURIComponent(id)}`);
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };

  // ── reactions ────────────────────────────────────────────────────────────────
  addReaction: ConversationsStore["addReaction"] = async (messageId, agent, emoji) => {
    const body = await this.post<{ reaction: unknown }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { agent, emoji });
    return body.reaction as never;
  };
  removeReaction: ConversationsStore["removeReaction"] = async (messageId, agent, emoji) => {
    try {
      await this.del(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { agent, emoji });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  getReactions: ConversationsStore["getReactions"] = async (messageId) => {
    const body = await this.get<{ reactions?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`);
    return (body.reactions ?? []) as never;
  };
  getReactionSummary: ConversationsStore["getReactionSummary"] = async (messageId) => {
    const body = await this.get<{ summary?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/reactions`, { summary: true });
    return (body.summary ?? []) as never;
  };

  // ── sessions ────────────────────────────────────────────────────────────────
  listSessions: ConversationsStore["listSessions"] = async (agent) => {
    const body = await this.get<{ sessions?: unknown[] }>("/sessions", { agent });
    return (body.sessions ?? []) as never;
  };
  getSession: ConversationsStore["getSession"] = async (sessionId) => {
    const body = await this.get<{ session: unknown } | null>(`/sessions/${encodeURIComponent(sessionId)}`);
    return (body?.session ?? null) as never;
  };
  getSessionActivity: ConversationsStore["getSessionActivity"] = async (sessionId) => {
    const body = await this.get<{ activity: unknown } | null>(`/sessions/${encodeURIComponent(sessionId)}/activity`);
    return (body?.activity ?? null) as never;
  };

  // ── topics ────────────────────────────────────────────────────────────────────
  getChannelTopics: ConversationsStore["getChannelTopics"] = async (channelName, opts) => {
    const body = await this.get<{ topics?: unknown[] }>(`/topics/channel/${encodeURIComponent(normalizeChannelName(channelName))}`, { limit: opts?.limit, since: normalizeSince(opts?.since) });
    return (body.topics ?? []) as never;
  };
  getSessionTopics: ConversationsStore["getSessionTopics"] = async (sessionId, opts) => {
    const body = await this.get<{ topics?: unknown[] }>(`/topics/session/${encodeURIComponent(sessionId)}`, { limit: opts?.limit });
    return (body.topics ?? []) as never;
  };
  getTrendingTopics: ConversationsStore["getTrendingTopics"] = async (opts) => {
    const body = await this.get<{ topics?: unknown[] }>("/topics/trending", { project_id: opts?.project_id, hours: opts?.hours, top_n: opts?.top_n });
    return (body.topics ?? []) as never;
  };

  // ── graph ─────────────────────────────────────────────────────────────────────
  buildGraph: ConversationsStore["buildGraph"] = async () => {
    const body = await this.post<unknown>("/graph/build");
    return body as never;
  };
  getRelated: ConversationsStore["getRelated"] = async (entityType, entityId) => {
    const body = await this.get<{ related?: unknown[] }>("/graph/related", { entity_type: entityType, entity_id: entityId });
    return (body.related ?? []) as never;
  };
  getAgentNetwork: ConversationsStore["getAgentNetwork"] = async (agent) => {
    const body = await this.get<{ network: unknown }>(`/graph/network/${encodeURIComponent(agent)}`);
    return body.network as never;
  };
  getGraphStats: ConversationsStore["getGraphStats"] = async () => {
    const body = await this.get<unknown>("/graph/stats");
    return body as never;
  };

  // ── summary ───────────────────────────────────────────────────────────────────
  getConversationSummary: ConversationsStore["getConversationSummary"] = async (sessionOrChannel, opts) => {
    const body = await this.get<{ summary: unknown } | null>(`/summary/${encodeURIComponent(sessionOrChannel)}`, opts as Q);
    return (body?.summary ?? null) as never;
  };

  // ── hot ───────────────────────────────────────────────────────────────────────
  computeHotness: ConversationsStore["computeHotness"] = async (sessionId) => {
    const body = await this.get<{ session: unknown } | null>(`/hot/${encodeURIComponent(sessionId)}`);
    return (body?.session ?? null) as never;
  };
  listHotSessions: ConversationsStore["listHotSessions"] = async (opts) => {
    const body = await this.get<{ sessions?: unknown[] }>("/hot", opts as Q);
    return (body.sessions ?? []) as never;
  };

  // ── messages ────────────────────────────────────────────────────────────────
  sendMessage: ConversationsStore["sendMessage"] = async (opts) => {
    const body = await this.client.create<{ message: Record<string, unknown> }>("messages", {
      from: opts.from, to: opts.to, content: opts.content, channel: opts.channel,
      project_id: opts.project_id, session_id: opts.session_id, priority: opts.priority,
      blocking: opts.blocking === true,
      // This is an explicit field whitelist, so anything missing here is
      // silently dropped on the cloud path. reply_to was missing, which
      // unthreaded every reply sent in self_hosted/cloud mode while the local
      // SQLite path (and its tests) stayed correct.
      reply_to: opts.reply_to ?? undefined,
    });
    return attachSendRedaction(opts.content, parseMessage(body.message)) as never;
  };
  getMessageById: ConversationsStore["getMessageById"] = async (id) => {
    const body = await this.client.get<{ message: Record<string, unknown> }>("messages", String(id));
    return (body ? parseMessage(body.message) : null) as never;
  };
  deleteMessage: ConversationsStore["deleteMessage"] = async (id, agent) => {
    try {
      await this.del(`/messages/${encodeURIComponent(String(id))}`, { from: agent });
      return true as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return false as never;
      throw e;
    }
  };
  editMessage: ConversationsStore["editMessage"] = async (id, agent, newContent) => {
    try {
      const body = await this.client.update<{ message: Record<string, unknown> }>("messages", String(id), { from: agent, content: newContent });
      return (body ? attachSendRedaction(newContent, parseMessage(body.message)) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  readMessages: ConversationsStore["readMessages"] = async (opts) => {
    const o = opts ?? {};
    const since = normalizeSince(o.since);
    const limit = resolveReadLimit(o);
    // A bare `limit` — and a bare `since`, which falls back to the same default
    // cap — is a recency window: the server must SELECT the newest N. Asking for
    // `asc` returned the oldest N and no client-side sort could have repaired it:
    // the newest rows never left the server (todos 2c25973b).
    // Resolved against the NORMALIZED since, so the ordering decision matches the
    // filter the server actually receives ("7d" → an ISO stamp, blank → no filter).
    const window = resolveReadWindow({ ...o, since });
    const order = window.select;
    const res = await this.get<{ messages?: Record<string, unknown>[] }>("/messages", {
      limit, order, offset: o.offset, session: o.session_id, from: o.from, to: o.to,
      channel: o.channel ? normalizeChannelName(o.channel) : undefined, project_id: o.project_id,
      since, since_id: o.since_id, unread_only: o.unread_only ? true : undefined,
      threads_only: o.threads_only ? true : undefined,
      include_reply_counts: o.include_reply_counts ? true : undefined, mentions_only: o.mentions_only,
    });
    const rows = res?.messages ?? [];
    if (window.reverse) rows.reverse();
    let messages = rows.map(parseMessage);
    if (o.max_content_length && o.max_content_length > 0) {
      const max = o.max_content_length;
      messages = messages.map((m) => (m.content.length > max ? { ...m, content: m.content.slice(0, max) + "…", truncated: true } : m));
    }
    if (o.compact) return messages.map(compactMessage) as never;
    return messages as never;
  };
  searchMessages: ConversationsStore["searchMessages"] = async (opts) => {
    const since = normalizeSince(opts.since);
    const res = await this.get<{ messages?: Record<string, unknown>[] }>("/messages", {
      q: opts.query,
      limit: Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? Math.floor(opts.limit as number) : 20,
      offset: Number.isFinite(opts.offset) && (opts.offset as number) > 0 ? Math.floor(opts.offset as number) : undefined,
      order: "desc", channel: opts.channel ? normalizeChannelName(opts.channel) : undefined, from: opts.from, to: opts.to, since,
    });
    return (res?.messages ?? []).map((row) => ({ ...parseMessage(row), snippet: null, relevance_score: 0 })) as never;
  };
  readDigest: ConversationsStore["readDigest"] = async (opts) => {
    const o = opts ?? {};
    const since = normalizeSince(o.since);
    const maxBytes = resolveDigestMaxBytes(o.max_bytes);
    const limit = resolveDigestLimit(o.limit);
    const cursor = resolveDigestCursor(o.cursor);
    const channel = o.channel ? normalizeChannelName(o.channel) : null;
    const baseFilter: Q = { channel: channel ?? undefined, session: o.session_id, to: o.to, since, since_id: cursor, project_id: o.project_id };
    const [totalAvailable, totalUnread] = await Promise.all([
      this.messageCount(o.unread_only ? { ...baseFilter, unread_only: true } : baseFilter),
      this.messageCount({ ...baseFilter, unread_only: true }),
    ]);
    const listRes = await this.get<{ messages?: Record<string, unknown>[] }>("/messages", { ...baseFilter, order: "asc", limit, unread_only: o.unread_only ? true : undefined });
    const messages = (listRes?.messages ?? []).map(parseMessage);
    const norm: DigestNorm = { channel, session_id: o.session_id, to: o.to, since, cursor, maxBytes, limit };
    const assembly = assembleDigest(norm, { total_available: totalAvailable, total_unread: totalUnread }, messages, !!o.mark_read);
    let markedRead = 0;
    if (o.mark_read && assembly.markableEntries.length > 0) {
      markedRead = await this.markReadByIds(assembly.markableEntries.map((m) => m.id), o.reader);
    }
    return assembly.rebuild(markedRead) as never;
  };
  private async messageCount(query: Q): Promise<number> {
    const body = await this.get<{ count?: number }>("/messages", { ...query, count: 1 });
    return Number(body?.count ?? 0);
  }
  countMessages: ConversationsStore["countMessages"] = async (opts) => {
    const o = opts ?? {};
    return (await this.messageCount({
      session: o.session_id,
      from: o.from,
      to: o.to,
      channel: o.channel ? normalizeChannelName(o.channel) : undefined,
      project_id: o.project_id,
      since: normalizeSince(o.since),
      since_id: o.since_id,
      unread_only: o.unread_only ? true : undefined,
      blocking_only: o.blocking_only ? true : undefined,
    })) as never;
  };
  exportMessages: ConversationsStore["exportMessages"] = async (opts) => {
    const body = await this.get<{ export?: string }>("/messages/export", opts as Q);
    return String(body?.export ?? "") as never;
  };
  getThreadReplies: ConversationsStore["getThreadReplies"] = async (messageId) => {
    const body = await this.get<{ messages?: Record<string, unknown>[] }>(`/messages/${encodeURIComponent(String(messageId))}/replies`);
    return (body?.messages ?? []).map(parseMessage) as never;
  };
  getUnreadBlockers: ConversationsStore["getUnreadBlockers"] = async (agent, opts) => {
    const body = await this.get<{ messages?: Record<string, unknown>[] }>("/messages", { to: agent, unread_only: true, blocking_only: true, ...(opts as Q) });
    return (body?.messages ?? []).map(parseMessage) as never;
  };
  getMessagesForAgent: ConversationsStore["getMessagesForAgent"] = async (agent, opts) => {
    const body = await this.get<{ items?: Array<{ message: Record<string, unknown>; mention_id: number }> }>("/messages/for-agent", {
      agent, channel: opts?.channel, unread_only: opts?.unread_only ? true : undefined, limit: opts?.limit,
    });
    return (body?.items ?? []).map((r) => ({ message: parseMessage(r.message), mention_id: r.mention_id })) as never;
  };
  getMessageReadStatus: ConversationsStore["getMessageReadStatus"] = async (messageId, channel) => {
    const body = await this.get<{ receipts?: unknown[]; unread_by?: string[] }>(`/messages/${encodeURIComponent(String(messageId))}/read-status`, { channel });
    return { receipts: body?.receipts ?? [], unread_by: body?.unread_by ?? [] } as never;
  };
  private async markReadCall(body: { ids?: number[]; reader?: string; all?: boolean; channel?: string; session?: string }): Promise<number> {
    const res = await this.post<{ marked?: number }>("/messages/read", body);
    return Number(res?.marked ?? 0);
  }
  markRead: ConversationsStore["markRead"] = async (ids, reader) => (ids.length === 0 ? 0 : await this.markReadCall({ ids, reader })) as never;
  markReadByIds: ConversationsStore["markReadByIds"] = async (ids, agent) => (ids.length === 0 ? 0 : await this.markReadCall({ ids, reader: agent })) as never;
  markAllRead: ConversationsStore["markAllRead"] = async (agent) => (await this.markReadCall({ all: true, reader: agent })) as never;
  markChannelRead: ConversationsStore["markChannelRead"] = async (channelName, reader) => (await this.markReadCall({ channel: normalizeChannelName(channelName), reader })) as never;
  markSessionRead: ConversationsStore["markSessionRead"] = async (sessionId, reader) => (await this.markReadCall({ session: sessionId, reader })) as never;
  markUnread: ConversationsStore["markUnread"] = async (messageId) => {
    const res = await this.post<{ marked_unread?: number }>("/messages/unread", { ids: [messageId] });
    return Number(res?.marked_unread ?? 0) as never;
  };
  markUnreadByIds: ConversationsStore["markUnreadByIds"] = async (ids) => {
    if (ids.length === 0) return 0 as never;
    const res = await this.post<{ marked_unread?: number }>("/messages/unread", { ids });
    return Number(res?.marked_unread ?? 0) as never;
  };
  markMentionsRead: ConversationsStore["markMentionsRead"] = async (agent, channel) => {
    const res = await this.post<{ marked?: number }>("/messages/read", { reader: agent, mentions_only: true, channel: channel ? normalizeChannelName(channel) : undefined });
    return Number(res?.marked ?? 0) as never;
  };
  listUnreadCounts: ConversationsStore["listUnreadCounts"] = async (agent) => {
    const res = await this.get<{ counts?: Array<Record<string, unknown>> }>("/messages/unread-counts", { agent });
    return (res?.counts ?? []).map((r) => ({ channel: String(r.channel), unread_count: Number(r.unread_count ?? 0), latest_message_at: (r.latest_message_at as string) ?? null })) as never;
  };
  listUnreadCountsWithMentions: ConversationsStore["listUnreadCountsWithMentions"] = async (agent) => {
    const res = await this.get<{ counts?: Array<Record<string, unknown>> }>("/messages/unread-counts", { agent, with_mentions: true });
    return (res?.counts ?? []) as never;
  };
  pinMessage: ConversationsStore["pinMessage"] = async (id) => {
    try {
      const body = await this.post<{ message: Record<string, unknown> }>(`/messages/${encodeURIComponent(String(id))}/pin`);
      return (body ? parseMessage(body.message) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  unpinMessage: ConversationsStore["unpinMessage"] = async (id) => {
    try {
      const body = await this.post<{ message: Record<string, unknown> }>(`/messages/${encodeURIComponent(String(id))}/unpin`);
      return (body ? parseMessage(body.message) : null) as never;
    } catch (e) {
      if (isHttpStatus(e, 404)) return null as never;
      throw e;
    }
  };
  getPinnedMessages: ConversationsStore["getPinnedMessages"] = async (opts) => {
    const res = await this.get<{ messages?: Record<string, unknown>[] }>("/messages/pinned", {
      channel: opts?.channel ? normalizeChannelName(opts.channel) : undefined, session: opts?.session_id, limit: opts?.limit, offset: opts?.offset,
    });
    return (res?.messages ?? []).map(parseMessage) as never;
  };
  recordReadReceipt: ConversationsStore["recordReadReceipt"] = async (messageId, agent) => {
    await this.markReadCall({ ids: [messageId], reader: agent });
    return undefined as never;
  };
  recordReadReceiptsBatch: ConversationsStore["recordReadReceiptsBatch"] = async (messageIds, agent) => {
    if (messageIds.length && agent) await this.markReadCall({ ids: messageIds, reader: agent });
    return undefined as never;
  };
  getReadReceipts: ConversationsStore["getReadReceipts"] = async (messageId) => {
    const res = await this.get<{ receipts?: unknown[] }>(`/messages/${encodeURIComponent(String(messageId))}/receipts`);
    return (res?.receipts ?? []) as never;
  };
}
