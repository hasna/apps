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
import { clientTransportEnvKeys } from "../contracts-client/transport.js";
import { envToken, normalizeStorageMode } from "../contracts-client/mode.js";
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

const APP = "conversations";

type Env = Record<string, string | undefined>;

/** Lift a sync lib function's type into an async Store method signature. */
type Async<F extends (...args: never[]) => unknown> = (
  ...args: Parameters<F>
) => Promise<Awaited<ReturnType<F>>>;

// ── Mode resolution ───────────────────────────────────────────────────────────
//
// STORE RESOLUTION MUST NEVER SILENTLY DOWNGRADE.
//
// Measured on station01, 2026-07-30, at 0.5.9: with HASNA_CONVERSATIONS_API_URL
// set and HASNA_CONVERSATIONS_API_KEY absent, `getStore()` handed back a LocalStore
// over ~/.hasna/conversations/*.db and served a DIFFERENT dataset — 608 channels
// instead of 844, newest message 2026-07-18 instead of today — with no error and no
// flag. An agent reading that concludes the messages were never sent. It is the
// same failure that got MCPs banned on this fleet (~/.claude/rules/no-mcps.md).
//
// The rule that prevents it: AMBIGUOUS CONFIGURATION IS AN ERROR, NOT A DEFAULT.
// When cloud is expected and cannot be built, refuse — naming the missing variable
// — rather than answering from a different dataset. An explicit, unambiguous local
// configuration stays fully supported; the bug was the silent downgrade, not local
// storage.
//
// This guard lives in the APP-OWNED layer on purpose. `src/lib/contracts-client/*`
// is a byte-faithful vendored copy of @hasna/contracts and is periodically
// re-vendored; a guard placed there would be silently reverted by the next
// re-vendor. The generic resolver keeps its own `misconfigured` throw as defence in
// depth, and the same gap is tracked upstream against @hasna/contracts.

/** Raised when the environment does not unambiguously select one store. */
export class ConversationsStoreConfigError extends Error {
  readonly code = "CONVERSATIONS_STORE_CONFIG";
  constructor(message: string) {
    super(message);
    this.name = "ConversationsStoreConfigError";
  }
}

/** Env var names for this app, from the shared transport contract (never hardcoded). */
const ENV_KEYS = clientTransportEnvKeys(APP);
/** Local SQLite path overrides, highest-precedence signal. */
const DB_PATH_KEYS = [`HASNA_${envToken(APP)}_DB_PATH`, `${envToken(APP)}_DB_PATH`] as const;

/**
 * First key in `keys` with a non-blank value in `env`, else null.
 *
 * Trims and treats a blank value as unset, matching `firstEnv` in the transport
 * resolver EXACTLY. If the two disagreed, this guard would classify an env the
 * resolver classifies differently — which is how a guard becomes its own source of
 * wrong-store bugs.
 */
function firstSet(env: Env, keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return null;
}

/** Suffix telling the operator how to ask for local explicitly. */
const LOCAL_ESCAPE_HATCH =
  `If you meant to use the on-box SQLite store, set ${ENV_KEYS.modeKeys[0]}=local explicitly.`;

/**
 * Throw unless `env` unambiguously selects exactly one store.
 *
 * See {@link getStore} for the full precedence table. Never reads, logs, or embeds
 * a credential value — only variable NAMES appear in any message.
 */
export function assertUnambiguousStoreEnv(env: Env = process.env): void {
  // 1. An explicit local SQLite path is the narrowest, most specific signal and wins.
  if (firstSet(env, DB_PATH_KEYS)) return;

  const modeHit = firstSet(env, ENV_KEYS.modeKeys);
  const urlHit = firstSet(env, ENV_KEYS.apiUrlKeys);
  const keyHit = firstSet(env, ENV_KEYS.apiKeyKeys);

  // 2. An explicit mode is authoritative — but must be spelled correctly.
  if (modeHit) {
    let mode: string;
    try {
      mode = normalizeStorageMode(modeHit.value).mode;
    } catch {
      throw new ConversationsStoreConfigError(
        `${modeHit.key} is set to an unrecognised value. Valid values are 'local' and 'cloud'. ` +
          `Refusing to guess which store to use.`,
      );
    }
    // 2a. Explicit local: cloud credentials are deliberately ignored, not ambiguous.
    if (mode === "local") return;
    // 2b. Explicit cloud with no credential: refuse. Do NOT read the local store.
    if (!keyHit) {
      throw new ConversationsStoreConfigError(
        `${modeHit.key} selects the cloud store but ${ENV_KEYS.apiKeyKeys[0]} is not set. ` +
          `Refusing to serve the on-box SQLite store in its place, because it holds a different ` +
          `dataset. Set ${ENV_KEYS.apiKeyKeys[0]} to reach the cloud store. ${LOCAL_ESCAPE_HATCH}`,
      );
    }
    assertUsableApiUrl(urlHit);
    return;
  }

  // 3. No explicit mode: the URL + key pair is the fleet flip signal.
  if (urlHit && keyHit) {
    assertUsableApiUrl(urlHit);
    return;
  }

  // 3a. THE P0. Half a cloud configuration is an error, never a fall-back to local.
  if (urlHit) {
    throw new ConversationsStoreConfigError(
      `${urlHit.key} points at a cloud store but ${ENV_KEYS.apiKeyKeys[0]} is not set. ` +
        `Refusing to serve the on-box SQLite store in its place, because it holds a different ` +
        `dataset. Set ${ENV_KEYS.apiKeyKeys[0]} to reach the cloud store. ${LOCAL_ESCAPE_HATCH}`,
    );
  }
  if (keyHit) {
    throw new ConversationsStoreConfigError(
      `${keyHit.key} is set but ${ENV_KEYS.apiUrlKeys[0]} is not, so the cloud store cannot be ` +
        `reached. Refusing to serve the on-box SQLite store in its place, because it holds a ` +
        `different dataset. Set ${ENV_KEYS.apiUrlKeys[0]} to reach the cloud store. ` +
        `${LOCAL_ESCAPE_HATCH}`,
    );
  }

  // 4. Nothing configured: the documented single-operator default is local SQLite.
}

/**
 * Refuse a cloud URL the transport could not use, rather than quietly reading local
 * data. Applies the same two conditions as `toV1BaseUrl`: it must parse, and it must
 * be http(s). Kept in step with that function so the guard and the resolver agree.
 */
function assertUsableApiUrl(urlHit: { key: string; value: string } | null): void {
  if (!urlHit) return; // Absent URL is legal: the transport falls back to the default host.
  let parsed: URL;
  try {
    parsed = new URL(urlHit.value);
  } catch {
    throw new ConversationsStoreConfigError(
      `${urlHit.key} is not a parseable URL, so the cloud store cannot be reached. Refusing to ` +
        `serve the on-box SQLite store in its place, because it holds a different dataset. ` +
        `Correct ${urlHit.key}. ${LOCAL_ESCAPE_HATCH}`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConversationsStoreConfigError(
      `${urlHit.key} must use http or https, so the cloud store cannot be reached. Refusing to ` +
        `serve the on-box SQLite store in its place, because it holds a different dataset. ` +
        `Correct ${urlHit.key}. ${LOCAL_ESCAPE_HATCH}`,
    );
  }
}

/**
 * The value that means "use the server" for the contracts client THIS REPO USES.
 *
 * Derived, never hardcoded, and that is load-bearing rather than tidy. The
 * storage-mode enum has already changed once: the generation vendored here
 * accepts `cloud` plus the deprecated aliases `self_hosted`/`remote`/`hybrid`,
 * while contracts after the inference removal (hasna/contracts#63) accepts ONLY
 * `sqlite`/`postgres` and THROWS on everything else. The two valid sets are
 * DISJOINT, so any literal pinned here is a bet on which side of that change
 * this repo's client is on, and the bet loses on one side or the other.
 *
 * NOTE THE DISCRIMINATOR IS THE VENDORED MODULE, deliberately. `contracts-client`
 * is a byte-faithful vendored copy, so the validator that actually rejects a bad
 * mode in this repo is `../contracts-client/mode.js`, not whatever version of
 * `@hasna/contracts` happens to be installed. Probing the installed package
 * instead would answer a question nobody here asks, and would flip this value
 * before the vendored resolver could accept it. It follows that the derived
 * value changes exactly when the vendored copy is re-vendored — which is the
 * correct coupling.
 *
 * The probe runs through `normalizeStorageMode`, which THROWS on an unknown
 * token rather than returning a sentinel, so the test is exact rather than
 * heuristic.
 */
export const SERVER_MODE_CANDIDATES = ["postgres", "self_hosted", "cloud"] as const;

/** Accepts a mode token or throws. Injectable so both enum generations are testable. */
export type ModeNormalizer = (value: string) => unknown;

let cachedServerMode: string | null = null;

export function serverStorageMode(normalize: ModeNormalizer = normalizeStorageMode): string {
  // Only memoise the real normalizer: caching a custom one would poison later
  // calls in a test that simulates the other enum generation.
  const useCache = normalize === (normalizeStorageMode as ModeNormalizer);
  if (useCache && cachedServerMode !== null) return cachedServerMode;
  for (const candidate of SERVER_MODE_CANDIDATES) {
    try {
      normalize(candidate);
      if (useCache) cachedServerMode = candidate;
      return candidate;
    } catch {
      // Not a token this generation of the contracts client understands.
    }
  }
  // Every candidate was rejected: the enum changed again and this list is stale.
  // Fail loudly rather than guess — guessing is the defect class this module
  // exists to remove, and a wrong mode silently reads the wrong dataset.
  throw new Error(
    `No known server storage mode is accepted by the vendored contracts client ` +
      `(tried ${SERVER_MODE_CANDIDATES.join(", ")}). The storage-mode enum has changed; ` +
      `add the new server token to SERVER_MODE_CANDIDATES in src/lib/store/index.ts.`,
  );
}

/**
 * Return an env in which the server mode is implied when the API url + key are
 * present but no explicit storage mode is set. Leaves an explicit mode (including
 * `local`) untouched, so the flip stays reversible. The fleet flip writes only the
 * two API URL + key vars; this makes that activate cloud. Never a DSN on the
 * client. A command-level SQLite DB path is treated as an explicit local override,
 * so local CLI test/dev commands cannot accidentally write to cloud when cloud
 * credentials are exported globally.
 *
 * Throws {@link ConversationsStoreConfigError} when the env does not unambiguously
 * select one store, so no caller can drift onto the wrong dataset.
 */
export function conversationsCloudEnv(env: Env = process.env): Env {
  assertUnambiguousStoreEnv(env);

  if (firstSet(env, DB_PATH_KEYS)) {
    return { ...env, [ENV_KEYS.modeKeys[0]!]: "local" };
  }
  // Honour EVERY documented mode variable, not just the HASNA_-prefixed pair.
  // Overwriting the highest-precedence mode key below would otherwise silently
  // override an operator who pinned local through an unprefixed variable.
  if (firstSet(env, ENV_KEYS.modeKeys)) return env;

  if (firstSet(env, ENV_KEYS.apiUrlKeys) && firstSet(env, ENV_KEYS.apiKeyKeys)) {
    return { ...env, [ENV_KEYS.modeKeys[0]!]: serverStorageMode() };
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
  countMessages: Async<typeof messagesLib.countMessages>;
  searchMessages: Async<typeof messagesLib.searchMessages>;
  readDigest: Async<typeof messagesLib.readDigest>;
  exportMessages: Async<typeof messagesLib.exportMessages>;
  getThreadReplies: Async<typeof messagesLib.getThreadReplies>;
  getUnreadBlockers: Async<typeof messagesLib.getUnreadBlockers>;
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
  listUnreadCounts: Async<typeof messagesLib.listUnreadCounts>;
  listUnreadCountsWithMentions: Async<typeof messagesLib.listUnreadCountsWithMentions>;
  pinMessage: Async<typeof messagesLib.pinMessage>;
  unpinMessage: Async<typeof messagesLib.unpinMessage>;
  getPinnedMessages: Async<typeof messagesLib.getPinnedMessages>;
  recordReadReceipt: Async<typeof messagesLib.recordReadReceipt>;
  recordReadReceiptsBatch: Async<typeof messagesLib.recordReadReceiptsBatch>;
  getReadReceipts: Async<typeof messagesLib.getReadReceipts>;
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
  readChannelNotifications: ConversationsStore["readChannelNotifications"] = async (...a) => notificationsLib.readChannelNotifications(...a);
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
  readMessages: ConversationsStore["readMessages"] = async (...a) => messagesLib.readMessages(...a);
  countMessages: ConversationsStore["countMessages"] = async (...a) => messagesLib.countMessages(...a);
  searchMessages: ConversationsStore["searchMessages"] = async (...a) => messagesLib.searchMessages(...a);
  readDigest: ConversationsStore["readDigest"] = async (...a) => messagesLib.readDigest(...a);
  exportMessages: ConversationsStore["exportMessages"] = async (...a) => messagesLib.exportMessages(...a);
  getThreadReplies: ConversationsStore["getThreadReplies"] = async (...a) => messagesLib.getThreadReplies(...a);
  getUnreadBlockers: ConversationsStore["getUnreadBlockers"] = async (...a) => messagesLib.getUnreadBlockers(...a);
  getMessagesForAgent: ConversationsStore["getMessagesForAgent"] = async (...a) => messagesLib.getMessagesForAgent(...a);
  getMessageReadStatus: ConversationsStore["getMessageReadStatus"] = async (...a) => messagesLib.getMessageReadStatus(...a);
  markRead: ConversationsStore["markRead"] = async (...a) => messagesLib.markRead(...a);
  markReadByIds: ConversationsStore["markReadByIds"] = async (...a) => messagesLib.markReadByIds(...a);
  markAllRead: ConversationsStore["markAllRead"] = async (...a) => messagesLib.markAllRead(...a);
  markChannelRead: ConversationsStore["markChannelRead"] = async (...a) => messagesLib.markChannelRead(...a);
  markSessionRead: ConversationsStore["markSessionRead"] = async (...a) => messagesLib.markSessionRead(...a);
  markUnread: ConversationsStore["markUnread"] = async (...a) => messagesLib.markUnread(...a);
  markUnreadByIds: ConversationsStore["markUnreadByIds"] = async (...a) => messagesLib.markUnreadByIds(...a);
  markMentionsRead: ConversationsStore["markMentionsRead"] = async (...a) => messagesLib.markMentionsRead(...a);
  listUnreadCounts: ConversationsStore["listUnreadCounts"] = async (...a) => messagesLib.listUnreadCounts(...a);
  listUnreadCountsWithMentions: ConversationsStore["listUnreadCountsWithMentions"] = async (...a) => messagesLib.listUnreadCountsWithMentions(...a);
  pinMessage: ConversationsStore["pinMessage"] = async (...a) => messagesLib.pinMessage(...a);
  unpinMessage: ConversationsStore["unpinMessage"] = async (...a) => messagesLib.unpinMessage(...a);
  getPinnedMessages: ConversationsStore["getPinnedMessages"] = async (...a) => messagesLib.getPinnedMessages(...a);
  recordReadReceipt: ConversationsStore["recordReadReceipt"] = async (...a) => messagesLib.recordReadReceipt(...a);
  recordReadReceiptsBatch: ConversationsStore["recordReadReceiptsBatch"] = async (...a) => messagesLib.recordReadReceiptsBatch(...a);
  getReadReceipts: ConversationsStore["getReadReceipts"] = async (...a) => messagesLib.getReadReceipts(...a);
}

// ── Resolver ──────────────────────────────────────────────────────────────────

let localSingleton: LocalStore | null = null;

/**
 * Resolve the active {@link ConversationsStore} for the current environment.
 *
 * PRECEDENCE, highest first. Exactly one branch applies; anything that does not
 * land unambiguously on one store raises {@link ConversationsStoreConfigError}
 * rather than answering from the other one.
 *
 * 1. `HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH` set → LOCAL. A
 *    command-level SQLite path is the narrowest, most specific signal, so local
 *    dev and test commands cannot write to cloud when fleet credentials are
 *    exported globally. Wins over an explicit cloud mode.
 * 2. A storage mode set (`HASNA_CONVERSATIONS_STORAGE_MODE`,
 *    `HASNA_CONVERSATIONS_MODE`, `CONVERSATIONS_STORAGE_MODE`, `CONVERSATIONS_MODE`,
 *    in that order) → authoritative.
 *    - `local` → LOCAL; any API URL/key present is deliberately ignored.
 *    - `cloud` (or a deprecated alias) → CLOUD; requires an API key, ERROR without
 *      one. The API URL is optional and defaults to the app's cloud host.
 *    - anything else → ERROR naming the variable and the legal values.
 * 3. No mode, both API URL and API key set → CLOUD. This pair IS the fleet flip
 *    signal; removing both reverts to local.
 * 4. No mode, exactly ONE of API URL / API key set → ERROR naming the missing
 *    variable. Half a cloud configuration is ambiguous, and answering it from the
 *    on-box SQLite store means serving a different dataset with no signal.
 * 5. Nothing configured → LOCAL. The documented single-operator default.
 *
 * An API URL that cannot be parsed is an ERROR wherever cloud is expected, never a
 * quiet fall-back. No error message ever contains a credential value — only names.
 */
export function getStore(env: Env = process.env): ConversationsStore {
  const client = resolveConversationsCloud(env);
  if (client) return new ApiStore(client);
  if (!localSingleton) localSingleton = new LocalStore();
  return localSingleton;
}

export { normalizeChannelName };
