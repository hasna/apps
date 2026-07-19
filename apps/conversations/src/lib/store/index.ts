// ── The conversations Store abstraction ──────────────────────────────────────
//
// ONE interface, TWO transports. EVERY CLI command, MCP tool, and SDK method that
// reads or writes conversations DATA goes through `ConversationsStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. Delegates to the domain helpers in ../*.ts
//     (channels, tasks, locks, presence, projects, reactions, sessions, topics,
//     graph, channel-notifications, summary, hot, messages). Those helpers are the
//     ONLY place that opens `bun:sqlite`; nothing else in the app may touch it.
//   • ApiStore — the self_hosted/cloud HTTP API at `<API_URL>/v1` with a bearer
//     key. Delegates to the vendored @hasna/contracts storage transport.
//
// `getStore()` resolves which transport to use from the client-flip env
// (HASNA_CONVERSATIONS_API_URL + HASNA_CONVERSATIONS_API_KEY /
// HASNA_CONVERSATIONS_STORAGE_MODE). Callers NEVER branch on mode themselves and
// NEVER touch sqlite or fetch directly — that was the split-brain bug this module
// eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL and
// key differ, and that distinction is server-side tenancy. `local` is first-class
// and fully functional.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned, or
// embedded in any value produced here. Only the HTTP transport ever holds it.

import { resolveStorageClient, type HasnaStorageClient } from "../contracts-client/storage.js";
import { normalizeChannelName } from "../channel-names.js";
import { localHealthChecks } from "../db.js";
import { ApiStore } from "./api-store.js";

import * as channelsLib from "../channels.js";
import * as tasksLib from "../tasks.js";
import * as locksLib from "../locks.js";
import * as presenceLib from "../presence.js";
import * as projectsLib from "../projects.js";
import * as reactionsLib from "../reactions.js";
import * as sessionsLib from "../sessions.js";
import * as topicsLib from "../topics.js";
import * as graphLib from "../graph.js";
import * as notificationsLib from "../channel-notifications.js";
import * as summaryLib from "../summary.js";
import * as hotLib from "../hot.js";
import * as messagesLib from "../messages.js";
import * as incidentProjectionsLib from "../incident-projections.js";
import type { IncidentProjectionRecord, IncidentProjectionRequestV1 } from "../../types.js";
import { previewAsCompatibilityMessage, COLLECTION_MAX_MAX_BYTES } from "../message-previews.js";
import { runLocalReadWorker } from "../local-read-runner.js";

const APP = "conversations";

type Env = Record<string, string | undefined>;

/** Lift a sync lib function's type into an async Store method signature. */
type Async<F extends (...args: never[]) => unknown> = (
  ...args: Parameters<F>
) => Promise<Awaited<ReturnType<F>>>;

// ── Mode resolution ───────────────────────────────────────────────────────────

/**
 * Return an env in which `self_hosted` is implied when the API url + key are
 * present but no explicit storage mode is set. Leaves an explicit mode (including
 * `local`) untouched, so the flip stays reversible. The fleet flip writes only the
 * two API URL + key vars; this makes that activate cloud. Never a DSN on the
 * client.
 */
export function conversationsCloudEnv(env: Env = process.env): Env {
  const url = env.HASNA_CONVERSATIONS_API_URL ?? env.CONVERSATIONS_API_URL;
  const key = env.HASNA_CONVERSATIONS_API_KEY ?? env.CONVERSATIONS_API_KEY;
  const mode = env.HASNA_CONVERSATIONS_STORAGE_MODE ?? env.HASNA_CONVERSATIONS_MODE;
  if (url && key && !mode) {
    return { ...env, HASNA_CONVERSATIONS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/** Resolve the cloud HTTP client, or `null` when the app should use local. */
export function resolveConversationsCloud(env: Env = process.env): HasnaStorageClient | null {
  const resolved = resolveStorageClient(APP, conversationsCloudEnv(env));
  return resolved.transport === "cloud-http" ? resolved.client : null;
}

/** True when reads/writes are routed to the cloud API. */
export function isCloudStore(env: Env = process.env): boolean {
  return resolveConversationsCloud(env) !== null;
}

/** The resolved cloud API base URL when in cloud mode (else null). */
export function cloudApiUrl(env: Env = process.env): string | null {
  if (!isCloudStore(env)) return null;
  return env.HASNA_CONVERSATIONS_API_URL ?? env.CONVERSATIONS_API_URL ?? null;
}

// ── The single data interface ────────────────────────────────────────────────

/**
 * The single data interface for conversations. Both {@link LocalStore} and
 * {@link ApiStore} implement it; callers hold a `ConversationsStore` and never
 * know (or branch on) which one. Method signatures mirror the domain helpers so
 * the local path is a pure delegation and the cloud path is HTTP.
 */
/** A single health-check row surfaced by the `doctor` command. */
export interface StoreHealthCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface ConversationsStore {
  readonly transport: "local" | "cloud-http";

  /**
   * Transport-appropriate health probe for the `doctor` diagnostic. LocalStore
   * checks the on-box sqlite (opens + WAL); ApiStore checks cloud API reachability
   * + auth. Routed through the Store so `doctor` never touches sqlite directly and
   * reports the store the client is ACTUALLY flipped to (not the stale local db).
   */
  health: () => Promise<StoreHealthCheck[]>;

  // channels
  createChannel: Async<typeof channelsLib.createChannel>;
  listChannels: Async<typeof channelsLib.listChannels>;
  getChannel: Async<typeof channelsLib.getChannel>;
  joinChannel: Async<typeof channelsLib.joinChannel>;
  leaveChannel: Async<typeof channelsLib.leaveChannel>;
  getChannelMembers: Async<typeof channelsLib.getChannelMembers>;
  getMemberChannels: Async<typeof channelsLib.getMemberChannels>;
  updateChannel: Async<typeof channelsLib.updateChannel>;
  renameChannel: Async<typeof channelsLib.renameChannel>;
  archiveChannel: Async<typeof channelsLib.archiveChannel>;
  unarchiveChannel: Async<typeof channelsLib.unarchiveChannel>;
  isChannelMember: Async<typeof channelsLib.isChannelMember>;

  // channel notifications
  subscribeToChannelNotifications: Async<typeof notificationsLib.subscribeToChannelNotifications>;
  unsubscribeFromChannelNotifications: Async<typeof notificationsLib.unsubscribeFromChannelNotifications>;
  listChannelNotificationSubscriptions: Async<typeof notificationsLib.listChannelNotificationSubscriptions>;
  getSubscribedChannels: Async<typeof notificationsLib.getSubscribedChannels>;
  readChannelNotifications: Async<typeof notificationsLib.readChannelNotifications>;
  markChannelNotificationsRead: Async<typeof notificationsLib.markChannelNotificationsRead>;
  markAllChannelNotificationsRead: Async<typeof notificationsLib.markAllChannelNotificationsRead>;

  // tasks
  createTask: Async<typeof tasksLib.createTask>;
  getTask: Async<typeof tasksLib.getTask>;
  listTasks: Async<typeof tasksLib.listTasks>;
  startTask: Async<typeof tasksLib.startTask>;
  completeTask: Async<typeof tasksLib.completeTask>;
  cancelTask: Async<typeof tasksLib.cancelTask>;
  blockTask: Async<typeof tasksLib.blockTask>;
  unblockTask: Async<typeof tasksLib.unblockTask>;
  reopenTask: Async<typeof tasksLib.reopenTask>;
  assignTask: Async<typeof tasksLib.assignTask>;
  setTaskPriority: Async<typeof tasksLib.setTaskPriority>;
  addTaskComment: Async<typeof tasksLib.addComment>;
  getTaskComments: Async<typeof tasksLib.getComments>;
  getSubtasks: Async<typeof tasksLib.getSubtasks>;
  getTaskTree: Async<typeof tasksLib.getTaskTree>;
  addDependency: Async<typeof tasksLib.addDependency>;
  removeDependency: Async<typeof tasksLib.removeDependency>;
  getDependencies: Async<typeof tasksLib.getDependencies>;
  getDependents: Async<typeof tasksLib.getDependents>;
  getTaskActivity: Async<typeof tasksLib.getTaskActivity>;
  deleteTask: Async<typeof tasksLib.deleteTask>;
  searchTasks: Async<typeof tasksLib.searchTasks>;
  getDueTasks: Async<typeof tasksLib.getDueTasks>;
  getTaskSummary: Async<typeof tasksLib.getTaskSummary>;

  // locks
  acquireLock: Async<typeof locksLib.acquireLock>;
  bulkAcquireLock: Async<typeof locksLib.bulkAcquireLock>;
  releaseLock: Async<typeof locksLib.releaseLock>;
  checkLock: Async<typeof locksLib.checkLock>;
  cleanExpiredLocks: Async<typeof locksLib.cleanExpiredLocks>;
  releaseStaleAgentLocks: Async<typeof locksLib.releaseStaleAgentLocks>;
  tryBulkAcquireLock: Async<typeof locksLib.tryBulkAcquireLock>;
  listLocks: Async<typeof locksLib.listLocks>;
  listLocksEnriched: Async<typeof locksLib.listLocksEnriched>;

  // presence / agents
  registerAgent: Async<typeof presenceLib.registerAgent>;
  heartbeat: Async<typeof presenceLib.heartbeat>;
  getPresence: Async<typeof presenceLib.getPresence>;
  listAgents: Async<typeof presenceLib.listAgents>;
  removePresence: Async<typeof presenceLib.removePresence>;
  renameAgent: Async<typeof presenceLib.renameAgent>;
  setPresenceProject: Async<typeof presenceLib.setPresenceProject>;

  // projects
  createProject: Async<typeof projectsLib.createProject>;
  listProjects: Async<typeof projectsLib.listProjects>;
  getProject: Async<typeof projectsLib.getProject>;
  getProjectByName: Async<typeof projectsLib.getProjectByName>;
  updateProject: Async<typeof projectsLib.updateProject>;
  deleteProject: Async<typeof projectsLib.deleteProject>;

  // reactions
  addReaction: Async<typeof reactionsLib.addReaction>;
  removeReaction: Async<typeof reactionsLib.removeReaction>;
  getReactions: Async<typeof reactionsLib.getReactions>;
  getReactionSummary: Async<typeof reactionsLib.getReactionSummary>;

  // sessions
  listSessions: Async<typeof sessionsLib.listSessions>;
  getSession: Async<typeof sessionsLib.getSession>;
  getSessionActivity: Async<typeof sessionsLib.getSessionActivity>;

  // topics
  getChannelTopics: Async<typeof topicsLib.getChannelTopics>;
  getSessionTopics: Async<typeof topicsLib.getSessionTopics>;
  getTrendingTopics: Async<typeof topicsLib.getTrendingTopics>;

  // graph
  buildGraph: Async<typeof graphLib.buildGraph>;
  getRelated: Async<typeof graphLib.getRelated>;
  getAgentNetwork: Async<typeof graphLib.getAgentNetwork>;
  getGraphStats: Async<typeof graphLib.getGraphStats>;

  // summary
  getConversationSummary: Async<typeof summaryLib.getConversationSummary>;

  // hot
  computeHotness: Async<typeof hotLib.computeHotness>;
  listHotSessions: Async<typeof hotLib.listHotSessions>;

  // messages
  sendMessage: Async<typeof messagesLib.sendMessage>;
  getMessageById: Async<typeof messagesLib.getMessageById>;
  deleteMessage: Async<typeof messagesLib.deleteMessage>;
  editMessage: Async<typeof messagesLib.editMessage>;
  readMessages: Async<typeof messagesLib.readMessages>;
  readMessagePreviews: Async<typeof messagesLib.readMessagePreviews>;
  countMessages: Async<typeof messagesLib.countMessages>;
  searchMessages: Async<typeof messagesLib.searchMessages>;
  searchMessagePreviews: Async<typeof messagesLib.searchMessagePreviews>;
  readDigest: Async<typeof messagesLib.readDigest>;
  exportMessages: Async<typeof messagesLib.exportMessages>;
  getThreadReplies: Async<typeof messagesLib.getThreadReplies>;
  getUnreadBlockers: Async<typeof messagesLib.getUnreadBlockers>;
  getUnreadBlockerPreviews: Async<typeof messagesLib.getUnreadBlockerPreviews>;
  readMentionPreviews: Async<typeof messagesLib.readMentionPreviews>;
  getMessagesForAgent: Async<typeof messagesLib.getMessagesForAgent>;
  getMessageReadStatus: Async<typeof messagesLib.getMessageReadStatus>;
  markRead: Async<typeof messagesLib.markRead>;
  markReadByIds: Async<typeof messagesLib.markReadByIds>;
  markAllRead: Async<typeof messagesLib.markAllRead>;
  markChannelRead: Async<typeof messagesLib.markChannelRead>;
  markSessionRead: Async<typeof messagesLib.markSessionRead>;
  markUnread: Async<typeof messagesLib.markUnread>;
  markUnreadByIds: Async<typeof messagesLib.markUnreadByIds>;
  markMentionsReadByIds: Async<typeof messagesLib.markMentionsReadByIds>;
  markMentionsRead: Async<typeof messagesLib.markMentionsRead>;
  listUnreadCounts: Async<typeof messagesLib.listUnreadCounts>;
  listUnreadCountsWithMentions: Async<typeof messagesLib.listUnreadCountsWithMentions>;
  pinMessage: Async<typeof messagesLib.pinMessage>;
  unpinMessage: Async<typeof messagesLib.unpinMessage>;
  getPinnedMessages: Async<typeof messagesLib.getPinnedMessages>;
  recordReadReceipt: Async<typeof messagesLib.recordReadReceipt>;
  recordReadReceiptsBatch: Async<typeof messagesLib.recordReadReceiptsBatch>;
  getReadReceipts: Async<typeof messagesLib.getReadReceipts>;

  // canonical incident projections (authority/tenant are transport-bound)
  appendIncidentProjection: (request: IncidentProjectionRequestV1) => Promise<IncidentProjectionRecord>;
  getIncidentProjection: (eventId: string) => Promise<IncidentProjectionRecord | null>;
}

// ── LocalStore ────────────────────────────────────────────────────────────────
// Pure delegation to the domain helpers (the only sqlite-touching code). Each
// method awaits nothing beyond wrapping the synchronous helper in a Promise so the
// interface is uniform across transports.

export class LocalStore implements ConversationsStore {
  readonly transport = "local" as const;

  health: ConversationsStore["health"] = async () => localHealthChecks();

  // channels
  createChannel: ConversationsStore["createChannel"] = async (...a) => channelsLib.createChannel(...a);
  listChannels: ConversationsStore["listChannels"] = async (...a) => channelsLib.listChannels(...a);
  getChannel: ConversationsStore["getChannel"] = async (...a) => channelsLib.getChannel(...a);
  joinChannel: ConversationsStore["joinChannel"] = async (...a) => channelsLib.joinChannel(...a);
  leaveChannel: ConversationsStore["leaveChannel"] = async (...a) => channelsLib.leaveChannel(...a);
  getChannelMembers: ConversationsStore["getChannelMembers"] = async (...a) => channelsLib.getChannelMembers(...a);
  getMemberChannels: ConversationsStore["getMemberChannels"] = async (...a) => channelsLib.getMemberChannels(...a);
  updateChannel: ConversationsStore["updateChannel"] = async (...a) => channelsLib.updateChannel(...a);
  renameChannel: ConversationsStore["renameChannel"] = async (...a) => channelsLib.renameChannel(...a);
  archiveChannel: ConversationsStore["archiveChannel"] = async (...a) => channelsLib.archiveChannel(...a);
  unarchiveChannel: ConversationsStore["unarchiveChannel"] = async (...a) => channelsLib.unarchiveChannel(...a);
  isChannelMember: ConversationsStore["isChannelMember"] = async (...a) => channelsLib.isChannelMember(...a);

  // channel notifications
  subscribeToChannelNotifications: ConversationsStore["subscribeToChannelNotifications"] = async (...a) => notificationsLib.subscribeToChannelNotifications(...a);
  unsubscribeFromChannelNotifications: ConversationsStore["unsubscribeFromChannelNotifications"] = async (...a) => notificationsLib.unsubscribeFromChannelNotifications(...a);
  listChannelNotificationSubscriptions: ConversationsStore["listChannelNotificationSubscriptions"] = async (...a) => notificationsLib.listChannelNotificationSubscriptions(...a);
  getSubscribedChannels: ConversationsStore["getSubscribedChannels"] = async (...a) => notificationsLib.getSubscribedChannels(...a);
  readChannelNotifications: ConversationsStore["readChannelNotifications"] = async (opts) =>
    runLocalReadWorker<ReturnType<typeof notificationsLib.readChannelNotifications>>(
      "readChannelNotifications",
      [opts],
      opts.timeout_ms,
    );
  markChannelNotificationsRead: ConversationsStore["markChannelNotificationsRead"] = async (...a) => notificationsLib.markChannelNotificationsRead(...a);
  markAllChannelNotificationsRead: ConversationsStore["markAllChannelNotificationsRead"] = async (...a) => notificationsLib.markAllChannelNotificationsRead(...a);

  // tasks
  createTask: ConversationsStore["createTask"] = async (...a) => tasksLib.createTask(...a);
  getTask: ConversationsStore["getTask"] = async (...a) => tasksLib.getTask(...a);
  listTasks: ConversationsStore["listTasks"] = async (...a) => tasksLib.listTasks(...a);
  startTask: ConversationsStore["startTask"] = async (...a) => tasksLib.startTask(...a);
  completeTask: ConversationsStore["completeTask"] = async (...a) => tasksLib.completeTask(...a);
  cancelTask: ConversationsStore["cancelTask"] = async (...a) => tasksLib.cancelTask(...a);
  blockTask: ConversationsStore["blockTask"] = async (...a) => tasksLib.blockTask(...a);
  unblockTask: ConversationsStore["unblockTask"] = async (...a) => tasksLib.unblockTask(...a);
  reopenTask: ConversationsStore["reopenTask"] = async (...a) => tasksLib.reopenTask(...a);
  assignTask: ConversationsStore["assignTask"] = async (...a) => tasksLib.assignTask(...a);
  setTaskPriority: ConversationsStore["setTaskPriority"] = async (...a) => tasksLib.setTaskPriority(...a);
  addTaskComment: ConversationsStore["addTaskComment"] = async (...a) => tasksLib.addComment(...a);
  getTaskComments: ConversationsStore["getTaskComments"] = async (...a) => tasksLib.getComments(...a);
  getSubtasks: ConversationsStore["getSubtasks"] = async (...a) => tasksLib.getSubtasks(...a);
  getTaskTree: ConversationsStore["getTaskTree"] = async (...a) => tasksLib.getTaskTree(...a);
  addDependency: ConversationsStore["addDependency"] = async (...a) => tasksLib.addDependency(...a);
  removeDependency: ConversationsStore["removeDependency"] = async (...a) => tasksLib.removeDependency(...a);
  getDependencies: ConversationsStore["getDependencies"] = async (...a) => tasksLib.getDependencies(...a);
  getDependents: ConversationsStore["getDependents"] = async (...a) => tasksLib.getDependents(...a);
  getTaskActivity: ConversationsStore["getTaskActivity"] = async (...a) => tasksLib.getTaskActivity(...a);
  deleteTask: ConversationsStore["deleteTask"] = async (...a) => tasksLib.deleteTask(...a);
  searchTasks: ConversationsStore["searchTasks"] = async (...a) => tasksLib.searchTasks(...a);
  getDueTasks: ConversationsStore["getDueTasks"] = async (...a) => tasksLib.getDueTasks(...a);
  getTaskSummary: ConversationsStore["getTaskSummary"] = async (...a) => tasksLib.getTaskSummary(...a);

  // locks
  acquireLock: ConversationsStore["acquireLock"] = async (...a) => locksLib.acquireLock(...a);
  bulkAcquireLock: ConversationsStore["bulkAcquireLock"] = async (...a) => locksLib.bulkAcquireLock(...a);
  releaseLock: ConversationsStore["releaseLock"] = async (...a) => locksLib.releaseLock(...a);
  checkLock: ConversationsStore["checkLock"] = async (...a) => locksLib.checkLock(...a);
  cleanExpiredLocks: ConversationsStore["cleanExpiredLocks"] = async (...a) => locksLib.cleanExpiredLocks(...a);
  releaseStaleAgentLocks: ConversationsStore["releaseStaleAgentLocks"] = async (...a) => locksLib.releaseStaleAgentLocks(...a);
  tryBulkAcquireLock: ConversationsStore["tryBulkAcquireLock"] = async (...a) => locksLib.tryBulkAcquireLock(...a);
  listLocks: ConversationsStore["listLocks"] = async (...a) => locksLib.listLocks(...a);
  listLocksEnriched: ConversationsStore["listLocksEnriched"] = async (...a) => locksLib.listLocksEnriched(...a);

  // presence
  registerAgent: ConversationsStore["registerAgent"] = async (...a) => presenceLib.registerAgent(...a);
  heartbeat: ConversationsStore["heartbeat"] = async (...a) => presenceLib.heartbeat(...a);
  getPresence: ConversationsStore["getPresence"] = async (...a) => presenceLib.getPresence(...a);
  listAgents: ConversationsStore["listAgents"] = async (...a) => presenceLib.listAgents(...a);
  removePresence: ConversationsStore["removePresence"] = async (...a) => presenceLib.removePresence(...a);
  renameAgent: ConversationsStore["renameAgent"] = async (...a) => presenceLib.renameAgent(...a);
  setPresenceProject: ConversationsStore["setPresenceProject"] = async (...a) => presenceLib.setPresenceProject(...a);

  // projects
  createProject: ConversationsStore["createProject"] = async (...a) => projectsLib.createProject(...a);
  listProjects: ConversationsStore["listProjects"] = async (...a) => projectsLib.listProjects(...a);
  getProject: ConversationsStore["getProject"] = async (...a) => projectsLib.getProject(...a);
  getProjectByName: ConversationsStore["getProjectByName"] = async (...a) => projectsLib.getProjectByName(...a);
  updateProject: ConversationsStore["updateProject"] = async (...a) => projectsLib.updateProject(...a);
  deleteProject: ConversationsStore["deleteProject"] = async (...a) => projectsLib.deleteProject(...a);

  // reactions
  addReaction: ConversationsStore["addReaction"] = async (...a) => reactionsLib.addReaction(...a);
  removeReaction: ConversationsStore["removeReaction"] = async (...a) => reactionsLib.removeReaction(...a);
  getReactions: ConversationsStore["getReactions"] = async (...a) => reactionsLib.getReactions(...a);
  getReactionSummary: ConversationsStore["getReactionSummary"] = async (...a) => reactionsLib.getReactionSummary(...a);

  // sessions
  listSessions: ConversationsStore["listSessions"] = async (...a) => sessionsLib.listSessions(...a);
  getSession: ConversationsStore["getSession"] = async (...a) => sessionsLib.getSession(...a);
  getSessionActivity: ConversationsStore["getSessionActivity"] = async (...a) => sessionsLib.getSessionActivity(...a);

  // topics
  getChannelTopics: ConversationsStore["getChannelTopics"] = async (...a) => topicsLib.getChannelTopics(...a);
  getSessionTopics: ConversationsStore["getSessionTopics"] = async (...a) => topicsLib.getSessionTopics(...a);
  getTrendingTopics: ConversationsStore["getTrendingTopics"] = async (...a) => topicsLib.getTrendingTopics(...a);

  // graph
  buildGraph: ConversationsStore["buildGraph"] = async (...a) => graphLib.buildGraph(...a);
  getRelated: ConversationsStore["getRelated"] = async (...a) => graphLib.getRelated(...a);
  getAgentNetwork: ConversationsStore["getAgentNetwork"] = async (...a) => graphLib.getAgentNetwork(...a);
  getGraphStats: ConversationsStore["getGraphStats"] = async (...a) => graphLib.getGraphStats(...a);

  // summary
  getConversationSummary: ConversationsStore["getConversationSummary"] = async (...a) => summaryLib.getConversationSummary(...a);

  // hot
  computeHotness: ConversationsStore["computeHotness"] = async (...a) => hotLib.computeHotness(...a);
  listHotSessions: ConversationsStore["listHotSessions"] = async (...a) => hotLib.listHotSessions(...a);

  // messages
  sendMessage: ConversationsStore["sendMessage"] = async (...a) => messagesLib.sendMessage(...a);
  getMessageById: ConversationsStore["getMessageById"] = async (...a) => messagesLib.getMessageById(...a);
  deleteMessage: ConversationsStore["deleteMessage"] = async (...a) => messagesLib.deleteMessage(...a);
  editMessage: ConversationsStore["editMessage"] = async (...a) => messagesLib.editMessage(...a);
  readMessages: ConversationsStore["readMessages"] = async (opts = {}) => {
    const page = await this.readMessagePreviews({
      ...opts,
      preview_bytes: opts.max_content_length,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
      timeout_ms: 5_000,
    });
    return page.messages.map(previewAsCompatibilityMessage);
  };
  readMessagePreviews: ConversationsStore["readMessagePreviews"] = async (opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.readMessagePreviews>>(
      "readMessagePreviews",
      [opts],
      opts.timeout_ms,
    );
  countMessages: ConversationsStore["countMessages"] = async (...a) => messagesLib.countMessages(...a);
  searchMessages: ConversationsStore["searchMessages"] = async (opts) => {
    const page = await this.searchMessagePreviews({
      ...opts,
      preview_bytes: opts.snippet_length,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
      timeout_ms: 5_000,
    });
    return page.messages.map((preview) => ({
      ...previewAsCompatibilityMessage(preview),
      snippet: preview.preview,
      relevance_score: preview.relevance_score ?? 0,
    }));
  };
  searchMessagePreviews: ConversationsStore["searchMessagePreviews"] = async (opts) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.searchMessagePreviews>>(
      "searchMessagePreviews",
      [opts],
      opts.timeout_ms,
    );
  readDigest: ConversationsStore["readDigest"] = async (...a) => messagesLib.readDigest(...a);
  exportMessages: ConversationsStore["exportMessages"] = async (opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.exportMessages>>(
      "exportMessages",
      [opts],
      opts.timeout_ms,
    );
  getThreadReplies: ConversationsStore["getThreadReplies"] = async (messageId) => {
    const page = await this.readMessagePreviews({
      reply_to: messageId,
      order: "asc",
      limit: 100,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
      timeout_ms: 5_000,
    });
    return page.messages.map(previewAsCompatibilityMessage);
  };
  getUnreadBlockers: ConversationsStore["getUnreadBlockers"] = async (agent, opts = {}) => {
    const page = await this.getUnreadBlockerPreviews(agent, {
      ...opts,
      max_bytes: COLLECTION_MAX_MAX_BYTES,
      timeout_ms: 5_000,
    });
    return page.messages.map(previewAsCompatibilityMessage);
  };
  getUnreadBlockerPreviews: ConversationsStore["getUnreadBlockerPreviews"] = async (agent, opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.getUnreadBlockerPreviews>>(
      "getUnreadBlockerPreviews",
      [agent, opts],
      opts.timeout_ms,
    );
  readMentionPreviews: ConversationsStore["readMentionPreviews"] = async (agent, opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.readMentionPreviews>>(
      "readMentionPreviews",
      [agent, opts],
      opts.timeout_ms,
    );
  getMessagesForAgent: ConversationsStore["getMessagesForAgent"] = async (agent, opts = {}) => {
    return runLocalReadWorker<ReturnType<typeof messagesLib.getMessagesForAgent>>(
      "getMessagesForAgent",
      [agent, opts],
      undefined,
    );
  };
  getMessageReadStatus: ConversationsStore["getMessageReadStatus"] = async (...a) => messagesLib.getMessageReadStatus(...a);
  markRead: ConversationsStore["markRead"] = async (...a) => messagesLib.markRead(...a);
  markReadByIds: ConversationsStore["markReadByIds"] = async (...a) => messagesLib.markReadByIds(...a);
  markAllRead: ConversationsStore["markAllRead"] = async (...a) => messagesLib.markAllRead(...a);
  markChannelRead: ConversationsStore["markChannelRead"] = async (...a) => messagesLib.markChannelRead(...a);
  markSessionRead: ConversationsStore["markSessionRead"] = async (...a) => messagesLib.markSessionRead(...a);
  markUnread: ConversationsStore["markUnread"] = async (...a) => messagesLib.markUnread(...a);
  markUnreadByIds: ConversationsStore["markUnreadByIds"] = async (...a) => messagesLib.markUnreadByIds(...a);
  markMentionsReadByIds: ConversationsStore["markMentionsReadByIds"] = async (...a) => messagesLib.markMentionsReadByIds(...a);
  markMentionsRead: ConversationsStore["markMentionsRead"] = async (...a) => messagesLib.markMentionsRead(...a);
  listUnreadCounts: ConversationsStore["listUnreadCounts"] = async (...a) => messagesLib.listUnreadCounts(...a);
  listUnreadCountsWithMentions: ConversationsStore["listUnreadCountsWithMentions"] = async (...a) => messagesLib.listUnreadCountsWithMentions(...a);
  pinMessage: ConversationsStore["pinMessage"] = async (...a) => messagesLib.pinMessage(...a);
  unpinMessage: ConversationsStore["unpinMessage"] = async (...a) => messagesLib.unpinMessage(...a);
  getPinnedMessages: ConversationsStore["getPinnedMessages"] = async (opts = {}) => {
    return runLocalReadWorker<ReturnType<typeof messagesLib.getPinnedMessages>>(
      "getPinnedMessages",
      [opts],
      undefined,
    );
  };
  recordReadReceipt: ConversationsStore["recordReadReceipt"] = async (...a) => messagesLib.recordReadReceipt(...a);
  recordReadReceiptsBatch: ConversationsStore["recordReadReceiptsBatch"] = async (...a) => messagesLib.recordReadReceiptsBatch(...a);
  getReadReceipts: ConversationsStore["getReadReceipts"] = async (...a) => messagesLib.getReadReceipts(...a);
  appendIncidentProjection: ConversationsStore["appendIncidentProjection"] = async (request) =>
    incidentProjectionsLib.appendIncidentProjection(request, incidentProjectionsLib.resolveIncidentProjectorContext());
  getIncidentProjection: ConversationsStore["getIncidentProjection"] = async (eventId) =>
    incidentProjectionsLib.getIncidentProjection(eventId, incidentProjectionsLib.resolveIncidentProjectorContext());
}

// ── Resolver ──────────────────────────────────────────────────────────────────

let localSingleton: LocalStore | null = null;

/** Clear the stateless transport singleton between hermetic route tests. */
export function resetStoreForTests(): void {
  localSingleton = null;
}

/**
 * Resolve the active {@link ConversationsStore} for the current environment.
 * Returns an {@link ApiStore} when the client-flip contract resolves to cloud-http
 * (self_hosted/cloud), else a {@link LocalStore}. Throws if cloud was requested but
 * is misconfigured, so callers can never silently read/write the wrong dataset.
 */
export function getStore(env: Env = process.env): ConversationsStore {
  const client = resolveConversationsCloud(env);
  if (client) return new ApiStore(client);
  if (!localSingleton) localSingleton = new LocalStore();
  return localSingleton;
}

export { normalizeChannelName };
