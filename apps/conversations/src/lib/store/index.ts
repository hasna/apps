// Ordinary clients always resolve the shared authenticated API. LocalStore is
// retained only as an explicitly constructed library/migration compatibility handle.
// Credential and authority resolution remain fresh and value-free.

import { resolveStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransportOptions } from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";
import {
  APP,
  DB_PATH_KEYS,
  ENV_KEYS,
  conversationsResolverInputs,
} from "../contracts-env.js";
import { assertAmbientCloudAllowed } from "./test-runtime.js";
import { normalizeChannelName } from "../channel-names.js";
import { localHealthChecks, getDb } from "../db.js";
import { ApiStore } from "./api-store.js";
import {
  AGENT_LIST_ORDER,
  CHANNEL_LIST_ORDER,
  describeMessageOrder,
  type ListOrderKind,
  type SortDescriptor,
} from "../list-order.js";

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
import * as projectMessageLinkageLib from "../project-message-linkage.js";
import * as channelMergeLib from "../channel-merge.js";
import * as projectChannelRegistrationLib from "../project-channel-registration.js";
import { attachSendRedaction } from "../content-safety.js";
import type { IncidentProjectionRecord, IncidentProjectionRequestV1, Message, MessagePreviewPage } from "../../types.js";
import { previewAsCompatibilityMessage, COLLECTION_MAX_MAX_BYTES } from "../message-previews.js";
import { runLocalReadWorker } from "../local-read-runner.js";
import { drainConversationEventOutbox, type DrainEventOutboxResult } from "../events-bridge.js";
import type { EventsDrainReceipt, EventDeliveryStatus } from "../events-delivery.js";
import { saveFeedbackLocal, type SaveFeedbackInput, type SaveFeedbackResult } from "../feedback.js";
import { redactMessagesById, type RedactMessagesOptions, type RedactMessagesResult } from "../admin-redaction.js";

/**
 * App slug for the client-flip env contract.
 *
 * Exported because the macOS shell's guard (`Sources/HasnaConversationsCore`) is
 * generated from the same contract rather than restating its key names. A guard
 * that classifies an env differently from this resolver is how a guard becomes
 * its own source of wrong-store bugs — see {@link assertSharedConversationsSelection}.
 */
export { APP } from "../contracts-env.js";

type Env = Record<string, string | undefined>;

/** Lift a sync lib function's type into an async Store method signature. */
type Async<F extends (...args: never[]) => unknown> = (
  ...args: Parameters<F>
) => Promise<Awaited<ReturnType<F>>>;

// Shared API transport resolution.

/** Raised when the environment does not unambiguously select one store. */
export class ConversationsStoreConfigError extends Error {
  readonly code = "CONVERSATIONS_STORE_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "ConversationsStoreConfigError";
  }
}

/** Env var names for this app, from the shared transport contract (never hardcoded). */
export { ENV_KEYS } from "../contracts-env.js";
/** Retired local database selectors retained for configuration diagnostics. */
export { DB_PATH_KEYS } from "../contracts-env.js";

/** Reject retired selectors before consulting credentials or opening any store. */
export function assertSharedConversationsSelection(env: Env = process.env): void {
  const keys = DB_PATH_KEYS.filter(key => (env[key] ?? "").trim() !== "");
  if (keys.length) throw new ConversationsStoreConfigError(
    `Local database selectors are no longer supported by Conversations clients: ${keys.join(", ")}. Remove them and configure saved account credentials or HASNA_CONVERSATIONS_API_URL / HASNA_CONVERSATIONS_API_KEY. Preserve existing databases for explicit migration.`,
  );
}

/**
 * Wrap a failure of the shared @hasna/contracts chain as the app's own config
 * error, preserving the resolver's message (which names every tier it consulted
 * — an env key NAME, a Keychain item reference, or a file PATH, never a value)
 * and naming saved account configuration. The CLI's
 * error surface (including the `--json` error contract) keys on
 * {@link ConversationsStoreConfigError}, so every chain refusal surfaces
 * through the same code.
 */
function wrapConversationsChainFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new ConversationsStoreConfigError(`${message} Configure saved account credentials or HASNA_CONVERSATIONS_API_URL / HASNA_CONVERSATIONS_API_KEY. No local database is opened.`);
}

/** Verify shared account configuration without opening a database. */
export function assertUnambiguousStoreEnv(env: Env = process.env): void {
  resolveCloudClientUnguarded(env);
}

/** Preserve credential-tier identity after validating shared API configuration. */
export function conversationsCloudEnv(env: Env = process.env): Env {
  resolveCloudClientUnguarded(env);
  return env;
}

/** Tier-1 credential inputs (`--api-key` / `--profile`), Keychain-tier controls, and transport overrides for the shared chain. */
export interface ConversationsResolveOptions {
  credentials?: CredentialChainOptions;
  /** Transport overrides threaded to the shared client (tests inject `fetchImpl`; `retry`/`timeoutMs` etc.). */
  transport?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">>;
}

/**
 * The raw resolution, module-private and deliberately UNGUARDED.
 *
 * It answers "which transport does this env select", which is a QUESTION. The
 * exported wrapper below answers "hand me a client I can write with", which is a
 * CAPABILITY. The test-context guard belongs on the second and not the first.
 */
function resolveCloudClientUnguarded(env: Env, options: ConversationsResolveOptions = {}): HasnaStorageClient {
  assertSharedConversationsSelection(env);
  // Otherwise the shared chain decides the credential and the authority,
  // fresh on every call: explicit argument, the deliberate pointers, the
  // macOS Keychain, the credentials file, then HASNA_CONVERSATIONS_API_KEY;
  // the authority follows HASNA_CONVERSATIONS_API_URL and defaults to the
  // fleet gateway when nothing configures one. Declared-but-blank authority
  // aliases are normalised WITHOUT dropping the Keychain tier's ambient gate,
  // which travels with the env as `keychain.enabled` when a copy is
  // unavoidable (#1788). Every chain refusal is re-raised as the app's config
  // error (fail loud, no local fallback).
  const { env: resolverEnv, credentials } = conversationsResolverInputs(env, options.credentials);
  let resolved;
  try {
    resolved = resolveStorageClient(APP, resolverEnv, { credentials, ...options.transport });
  } catch (error) {
    wrapConversationsChainFailure(error);
  }
  return resolved!.client;
}

/**
 * Resolve the shared HTTP client or throw a configuration error.
 *
 * GUARDED AT THE MINT POINT, NOT AT ONE CALLER. `src/index.ts` re-exports this
 * module with `export *`, so this function is package public API and an SDK
 * consumer reaches it without ever touching {@link getStore}. Measured on
 * 92f632c3 inside a test process, with the guard on `getStore` alone:
 * `getStore()` refused, while `resolveConversationsCloud()` returned a client at
 * the hosted API base URL carrying create/update/delete. A guard on
 * one entry point of a module whose siblings are re-exported wholesale protects
 * the entry point, not the module — so the guard moved to the single place a
 * writable client is produced, and every caller inherits it.
 */
export function resolveConversationsCloud(
  env: Env = process.env,
  options: ConversationsResolveOptions = {},
): HasnaStorageClient {
  const client = resolveCloudClientUnguarded(env, options);
  // AMBIENT means "whatever the operator's shell happens to hold". A caller that
  // passes its own env has named its target, and that decision is not this
  // guard's to overturn. The default parameter makes the bare call identical to
  // an explicit `process.env`, so both are the same ambient read.
  if (client && env === process.env) {
    assertAmbientCloudAllowed(client.baseUrl, env, DB_PATH_KEYS);
  }
  return client;
}

/** Compatibility predicate: shared API configuration returns true or throws. */
export function isCloudStore(env: Env = process.env): boolean {
  return resolveCloudClientUnguarded(env) !== null;
}

/**
 * The resolved cloud API authority when the hosted API is selected (else null).
 *
 * THE AUTHORITY THE CLIENT ACTUALLY TARGETS, not env-or-default. This used to
 * read `HASNA_CONVERSATIONS_API_URL ?? CONVERSATIONS_API_URL ?? <gateway>`
 * beside the chain, which is a second, disagreeing resolver: the shared chain
 * also honours the Keychain `api-url` item and the credentials file's
 * authority, so `status`, `status --json` and `/api/status` printed the fleet
 * gateway while requests went elsewhere. Now the value is the base URL of the
 * client the chain minted, in the origin form every caller expects (the
 * chain's `/v1` root with the version segment removed — `status-location.ts`
 * re-derives the `/v1` root for display).
 */
export function cloudApiUrl(env: Env = process.env): string | null {
  const client = resolveCloudClientUnguarded(env);
  if (!client) return null;
  return client.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
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
   * Which rows a list verb will hand back, so a caller can DISCLOSE the
   * ordering instead of assuming it.
   *
   * This belongs to the store and not to the caller because the two transports
   * genuinely disagree: LocalStore ranks `search` by FTS relevance, while
   * ApiStore asks the server for `created_at DESC`. A CLI footer that hardcoded
   * either one would be truthful on one transport and a lie on the other.
   */
  describeListOrder: (kind: ListOrderKind, opts?: { order?: string; sort?: string }) => SortDescriptor;

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

  // package-owned project channel registration authority
  projectChannelRegistrationCapability: Async<typeof projectChannelRegistrationLib.getProjectChannelRegistrationCapability>;
  registerProjectChannel: Async<typeof projectChannelRegistrationLib.registerProjectChannel>;
  listProjectChannelRegistrationPage: Async<typeof projectChannelRegistrationLib.listProjectChannelRegistrationPage>;
  listProjectChannelMessagePage: Async<typeof projectChannelRegistrationLib.listProjectChannelMessagePage>;
  readProjectChannelRegistrationExact: Async<typeof projectChannelRegistrationLib.readProjectChannelRegistrationExact>;
  lookupProjectChannelRegistrationReceipt: Async<typeof projectChannelRegistrationLib.lookupProjectChannelRegistrationReceipt>;
  compensateProjectChannelRegistration: Async<typeof projectChannelRegistrationLib.compensateProjectChannelRegistration>;
  verifyProjectChannelRegistrationInverse: Async<typeof projectChannelRegistrationLib.verifyProjectChannelRegistrationInverse>;

  // channel notifications
  subscribeToChannelNotifications: Async<typeof notificationsLib.subscribeToChannelNotifications>;
  unsubscribeFromChannelNotifications: Async<typeof notificationsLib.unsubscribeFromChannelNotifications>;
  listChannelNotificationSubscriptions: Async<typeof notificationsLib.listChannelNotificationSubscriptions>;
  getSubscribedChannels: Async<typeof notificationsLib.getSubscribedChannels>;
  readChannelNotifications: Async<typeof notificationsLib.readChannelNotifications>;
  markChannelNotificationsRead: Async<typeof notificationsLib.markChannelNotificationsRead>;
  baselineChannelNotifications: Async<typeof notificationsLib.baselineChannelNotifications>;
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
  reapStaleSingleTouch: Async<typeof presenceLib.reapStaleSingleTouchRegistrations>;

  // projects
  createProject: Async<typeof projectsLib.createProject>;
  listProjects: Async<typeof projectsLib.listProjects>;
  getProject: Async<typeof projectsLib.getProject>;
  getProjectByName: Async<typeof projectsLib.getProjectByName>;
  updateProject: Async<typeof projectsLib.updateProject>;
  deleteProject: Async<typeof projectsLib.deleteProject>;

  // reactions
  addReaction: Async<typeof reactionsLib.addReaction>;
  toggleReaction: Async<typeof reactionsLib.toggleReaction>;
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
  planChannelProjectMessageLinkage: Async<typeof projectMessageLinkageLib.planChannelProjectMessageLinkage>;
  applyChannelProjectMessageLinkage: Async<typeof projectMessageLinkageLib.applyChannelProjectMessageLinkage>;
  rollbackChannelProjectMessageLinkage: Async<typeof projectMessageLinkageLib.rollbackChannelProjectMessageLinkage>;
  planChannelMerge: Async<typeof channelMergeLib.planChannelMerge>;
  applyChannelMerge: Async<typeof channelMergeLib.applyChannelMerge>;
  rollbackChannelMerge: Async<typeof channelMergeLib.rollbackChannelMerge>;
  getMessageById: Async<typeof messagesLib.getMessageById>;
  getMessageByUuid: Async<typeof messagesLib.getMessageByUuid>;
  getMessageAttachment: Async<typeof messagesLib.getMessageAttachment>;
  deleteMessage: Async<typeof messagesLib.deleteMessage>;
  editMessage: Async<typeof messagesLib.editMessage>;
  readMessages: Async<typeof messagesLib.readMessages>;
  readMessagePreviews: Async<typeof messagesLib.readMessagePreviews>;
  readPinnedMessagePreviews: Async<typeof messagesLib.readPinnedMessagePreviews>;
  countMessages: Async<typeof messagesLib.countMessages>;
  searchMessages: Async<typeof messagesLib.searchMessages>;
  searchMessagePreviews: Async<typeof messagesLib.searchMessagePreviews>;
  /**
   * `searchMessages` plus a truthful truncation signal. Use this — not the
   * array form — whenever the result feeds an absence claim.
   */
  searchMessagesPage: Async<typeof messagesLib.searchMessagesPage>;
  readDigest: Async<typeof messagesLib.readDigest>;
  exportMessages: Async<typeof messagesLib.createMessageExport>;
  getThreadReplies: Async<typeof messagesLib.getThreadReplies>;
  // threads (task bf381fad): collection, expand, lifecycle, and per-agent unread
  listThreads: Async<typeof messagesLib.listThreads>;
  getThreadExpand: Async<typeof messagesLib.getThreadExpand>;
  setThreadStatus: Async<typeof messagesLib.setThreadStatus>;
  getThreadUnreadCount: Async<typeof messagesLib.getThreadUnreadCount>;
  /**
   * Unread blocking messages for one agent.
   *
   * `agent` is the identity the read is scoped to, forwarded to the hosted
   * server unconditionally (task 1871c67f): the API key authorizes, the
   * byline scopes. Omitting it was the fleet-wide unscoped read every seat
   * reported as "ZERO blockers".
   */
  getUnreadBlockers: (
    agent: string,
    opts?: { limit?: number; offset?: number },
  ) => Promise<Message[]>;
  getUnreadBlockerPreviews: (
    agent: string,
    opts?: { limit?: number; offset?: number; max_bytes?: number; preview_bytes?: number; timeout_ms?: number },
  ) => Promise<MessagePreviewPage>;
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
  markMentionsRead: Async<typeof messagesLib.markMentionsRead>;
  markMentionsReadByIds: Async<typeof messagesLib.markMentionsReadByIds>;
  listUnreadCounts: Async<typeof messagesLib.listUnreadCounts>;
  listUnreadCountsWithMentions: Async<typeof messagesLib.listUnreadCountsWithMentions>;
  pinMessage: Async<typeof messagesLib.pinMessage>;
  unpinMessage: Async<typeof messagesLib.unpinMessage>;
  getPinnedMessages: Async<typeof messagesLib.getPinnedMessages>;
  recordReadReceipt: Async<typeof messagesLib.recordReadReceipt>;
  recordReadReceiptsBatch: Async<typeof messagesLib.recordReadReceiptsBatch>;
  getReadReceipts: Async<typeof messagesLib.getReadReceipts>;

  appendIncidentProjection: (request: IncidentProjectionRequestV1) => Promise<IncidentProjectionRecord>;
  getIncidentProjection: (eventId: string) => Promise<IncidentProjectionRecord | null>;

  // Ordinary clients use PostgreSQL intake; explicit LocalStore retains legacy spool semantics.
  drainEventOutbox: (opts?: { limit?: number }) => Promise<DrainEventOutboxResult | EventsDrainReceipt>;
  getEventDelivery: (eventId: string) => Promise<EventDeliveryStatus>;

  // feedback: on-box table row, or the hosted API's feedback route.
  saveFeedback: (input: SaveFeedbackInput) => Promise<SaveFeedbackResult>;

  // audited admin message redaction: on-box SQLite (secure_delete + file
  // purge), or the hosted API's redaction route over the Postgres store.
  redactMessages: (options: RedactMessagesOptions) => Promise<RedactMessagesResult>;
}

// ── LocalStore ────────────────────────────────────────────────────────────────
// Pure delegation to the domain helpers (the only sqlite-touching code). Each
// method awaits nothing beyond wrapping the synchronous helper in a Promise so the
// interface is uniform across transports.

export class LocalStore implements ConversationsStore {
  readonly transport = "local" as const;

  describeListOrder: ConversationsStore["describeListOrder"] = (kind, opts) => {
    switch (kind) {
      case "messages": return describeMessageOrder(opts?.order);
      case "search": return messagesLib.describeSearchOrder(opts?.sort);
      case "channels": return CHANNEL_LIST_ORDER;
      case "agents": return AGENT_LIST_ORDER;
    }
  };

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

  // package-owned project channel registration authority
  projectChannelRegistrationCapability: ConversationsStore["projectChannelRegistrationCapability"] = async () => projectChannelRegistrationLib.getProjectChannelRegistrationCapability();
  registerProjectChannel: ConversationsStore["registerProjectChannel"] = async (request) => projectChannelRegistrationLib.registerProjectChannel(request);
  listProjectChannelRegistrationPage: ConversationsStore["listProjectChannelRegistrationPage"] = async (request) => projectChannelRegistrationLib.listProjectChannelRegistrationPage(request);
  listProjectChannelMessagePage: ConversationsStore["listProjectChannelMessagePage"] = async (request) => projectChannelRegistrationLib.listProjectChannelMessagePage(request);
  readProjectChannelRegistrationExact: ConversationsStore["readProjectChannelRegistrationExact"] = async (request) => projectChannelRegistrationLib.readProjectChannelRegistrationExact(request);
  lookupProjectChannelRegistrationReceipt: ConversationsStore["lookupProjectChannelRegistrationReceipt"] = async (request) => projectChannelRegistrationLib.lookupProjectChannelRegistrationReceipt(request);
  compensateProjectChannelRegistration: ConversationsStore["compensateProjectChannelRegistration"] = async (request) => projectChannelRegistrationLib.compensateProjectChannelRegistration(request);
  verifyProjectChannelRegistrationInverse: ConversationsStore["verifyProjectChannelRegistrationInverse"] = async (request) => projectChannelRegistrationLib.verifyProjectChannelRegistrationInverse(request);

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
  baselineChannelNotifications: ConversationsStore["baselineChannelNotifications"] = async (...a) => notificationsLib.baselineChannelNotifications(...a);
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
  reapStaleSingleTouch: ConversationsStore["reapStaleSingleTouch"] = async (...a) => presenceLib.reapStaleSingleTouchRegistrations(...a);

  // projects
  createProject: ConversationsStore["createProject"] = async (...a) => projectsLib.createProject(...a);
  listProjects: ConversationsStore["listProjects"] = async (...a) => projectsLib.listProjects(...a);
  getProject: ConversationsStore["getProject"] = async (...a) => projectsLib.getProject(...a);
  getProjectByName: ConversationsStore["getProjectByName"] = async (...a) => projectsLib.getProjectByName(...a);
  updateProject: ConversationsStore["updateProject"] = async (...a) => projectsLib.updateProject(...a);
  deleteProject: ConversationsStore["deleteProject"] = async (...a) => projectsLib.deleteProject(...a);

  // reactions
  addReaction: ConversationsStore["addReaction"] = async (...a) => reactionsLib.addReaction(...a);
  toggleReaction: ConversationsStore["toggleReaction"] = async (...a) => reactionsLib.toggleReaction(...a);
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
  sendMessage: ConversationsStore["sendMessage"] = async (...a) => attachSendRedaction(a[0]?.content ?? "", messagesLib.sendMessage(...a));
  planChannelProjectMessageLinkage: ConversationsStore["planChannelProjectMessageLinkage"] = async (...a) => projectMessageLinkageLib.planChannelProjectMessageLinkage(...a);
  applyChannelProjectMessageLinkage: ConversationsStore["applyChannelProjectMessageLinkage"] = async (...a) => projectMessageLinkageLib.applyChannelProjectMessageLinkage(...a);
  rollbackChannelProjectMessageLinkage: ConversationsStore["rollbackChannelProjectMessageLinkage"] = async (...a) => projectMessageLinkageLib.rollbackChannelProjectMessageLinkage(...a);
  planChannelMerge: ConversationsStore["planChannelMerge"] = async (...a) => channelMergeLib.planChannelMerge(...a);
  applyChannelMerge: ConversationsStore["applyChannelMerge"] = async (...a) => channelMergeLib.applyChannelMerge(...a);
  rollbackChannelMerge: ConversationsStore["rollbackChannelMerge"] = async (...a) => channelMergeLib.rollbackChannelMerge(...a);
  getMessageById: ConversationsStore["getMessageById"] = async (...a) => messagesLib.getMessageById(...a);
  getMessageByUuid: ConversationsStore["getMessageByUuid"] = async (...a) => messagesLib.getMessageByUuid(...a);
  getMessageAttachment: ConversationsStore["getMessageAttachment"] = async (...a) => messagesLib.getMessageAttachment(...a);
  deleteMessage: ConversationsStore["deleteMessage"] = async (...a) => messagesLib.deleteMessage(...a);
  editMessage: ConversationsStore["editMessage"] = async (...a) => {
    const edited = messagesLib.editMessage(...a);
    return edited ? attachSendRedaction(a[2] ?? "", edited) : edited;
  };
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
  readPinnedMessagePreviews: ConversationsStore["readPinnedMessagePreviews"] = async (opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.readPinnedMessagePreviews>>(
      "readPinnedMessagePreviews",
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
  searchMessagesPage: ConversationsStore["searchMessagesPage"] = async (...a) => messagesLib.searchMessagesPage(...a);
  readDigest: ConversationsStore["readDigest"] = async (...a) => messagesLib.readDigest(...a);
  exportMessages: ConversationsStore["exportMessages"] = async (opts = {}) =>
    runLocalReadWorker<ReturnType<typeof messagesLib.createMessageExport>>(
      "createMessageExport",
      [opts],
      opts.timeout_ms,
    );
  getThreadReplies: ConversationsStore["getThreadReplies"] = async (...a) => messagesLib.getThreadReplies(...a);
  listThreads: ConversationsStore["listThreads"] = async (...a) => messagesLib.listThreads(...a);
  getThreadExpand: ConversationsStore["getThreadExpand"] = async (...a) => messagesLib.getThreadExpand(...a);
  setThreadStatus: ConversationsStore["setThreadStatus"] = async (...a) => messagesLib.setThreadStatus(...a);
  getThreadUnreadCount: ConversationsStore["getThreadUnreadCount"] = async (...a) => messagesLib.getThreadUnreadCount(...a);
  getUnreadBlockers: ConversationsStore["getUnreadBlockers"] = async (agent, opts = {}) => {
    const page = await this.getUnreadBlockerPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES, timeout_ms: 5_000 });
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
    const page = await this.readMentionPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES });
    return page.messages.map((preview) => ({ message: previewAsCompatibilityMessage(preview), mention_id: preview.mention_id! }));
  };
  getMessageReadStatus: ConversationsStore["getMessageReadStatus"] = async (...a) => messagesLib.getMessageReadStatus(...a);
  markRead: ConversationsStore["markRead"] = async (...a) => messagesLib.markRead(...a);
  markReadByIds: ConversationsStore["markReadByIds"] = async (...a) => messagesLib.markReadByIds(...a);
  markAllRead: ConversationsStore["markAllRead"] = async (...a) => messagesLib.markAllRead(...a);
  markChannelRead: ConversationsStore["markChannelRead"] = async (...a) => messagesLib.markChannelRead(...a);
  markSessionRead: ConversationsStore["markSessionRead"] = async (...a) => messagesLib.markSessionRead(...a);
  markUnread: ConversationsStore["markUnread"] = async (...a) => messagesLib.markUnread(...a);
  markUnreadByIds: ConversationsStore["markUnreadByIds"] = async (...a) => messagesLib.markUnreadByIds(...a);
  markMentionsRead: ConversationsStore["markMentionsRead"] = async (...a) => messagesLib.markMentionsRead(...a);
  markMentionsReadByIds: ConversationsStore["markMentionsReadByIds"] = async (...a) => messagesLib.markMentionsReadByIds(...a);
  listUnreadCounts: ConversationsStore["listUnreadCounts"] = async (...a) => messagesLib.listUnreadCounts(...a);
  listUnreadCountsWithMentions: ConversationsStore["listUnreadCountsWithMentions"] = async (...a) => messagesLib.listUnreadCountsWithMentions(...a);
  pinMessage: ConversationsStore["pinMessage"] = async (...a) => messagesLib.pinMessage(...a);
  unpinMessage: ConversationsStore["unpinMessage"] = async (...a) => messagesLib.unpinMessage(...a);
  getPinnedMessages: ConversationsStore["getPinnedMessages"] = async (...a) => messagesLib.getPinnedMessages(...a);
  recordReadReceipt: ConversationsStore["recordReadReceipt"] = async (...a) => messagesLib.recordReadReceipt(...a);
  recordReadReceiptsBatch: ConversationsStore["recordReadReceiptsBatch"] = async (...a) => messagesLib.recordReadReceiptsBatch(...a);
  getReadReceipts: ConversationsStore["getReadReceipts"] = async (...a) => messagesLib.getReadReceipts(...a);
  appendIncidentProjection: ConversationsStore["appendIncidentProjection"] = async (request) =>
    incidentProjectionsLib.appendIncidentProjection(request, incidentProjectionsLib.resolveIncidentProjectorContext());
  getIncidentProjection: ConversationsStore["getIncidentProjection"] = async (eventId) =>
    incidentProjectionsLib.getIncidentProjection(eventId, incidentProjectionsLib.resolveIncidentProjectorContext());

  // events outbox worker (local store): spool pending rows into the on-box
  // events durable spool inbox.
  drainEventOutbox: ConversationsStore["drainEventOutbox"] = async (opts) =>
    drainConversationEventOutbox(getDb(), { limit: opts?.limit });

  getEventDelivery: ConversationsStore["getEventDelivery"] = async () => {
    throw new Error("Events intake receipts require the authenticated Conversations API.");
  };

  saveFeedback: ConversationsStore["saveFeedback"] = async (input) => saveFeedbackLocal(input);

  redactMessages: ConversationsStore["redactMessages"] = async (options) => redactMessagesById(options);
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/** Compatibility no-op: ordinary API stores are resolved fresh on every call. */
export function resetStoreForTests(): void {}

/** Always return the shared API store; never open or create a local database. */
export function getStore(env?: Env, options: ConversationsResolveOptions = {}): ConversationsStore {
  return new ApiStore(resolveConversationsCloud(env ?? process.env, options));
}

export { normalizeChannelName };
export {
  ALLOW_CLOUD_IN_TESTS_ENV_KEY,
  ConversationsCloudInTestError,
  detectTestRuntime,
  isLoopbackApiUrl,
  type TestRuntimeProbeInputs,
  type TestRuntimeSignal,
} from "./test-runtime.js";
