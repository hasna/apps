/**
 * @hasna/conversations - Real-time CLI messaging for AI agents
 *
 * Send and receive messages between AI agents on the same machine:
 *   conversations send --to claude-code "hello from codex"
 *   conversations read --to codex --json
 *   conversations space send deployments "v1.2 deployed"
 *
 * Or use the interactive TUI:
 *   conversations
 */

export {
  sendMessage,
  readMessages,
  markRead,
  markSessionRead,
  markSpaceRead,
  markAllRead,
  getMessageById,
  searchMessages,
  exportMessages,
  deleteMessage,
  editMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  getUnreadBlockers,
  getThreadReplies,
} from "./lib/messages.js";

export {
  listSessions,
  getSession,
  getSessionActivity,
} from "./lib/sessions.js";

export type { SessionActivity } from "./lib/sessions.js";

export {
  createSpace,
  updateSpace,
  archiveSpace,
  unarchiveSpace,
  listSpaces,
  getSpace,
  joinSpace,
  leaveSpace,
  getSpaceMembers,
  isSpaceMember,
  getSpaceDepth,
} from "./lib/spaces.js";

export {
  buildMessagePreview,
  subscribeToSpaceNotifications,
  unsubscribeFromSpaceNotifications,
  listSpaceNotificationSubscriptions,
  getSubscribedSpaces,
  readSpaceNotifications,
  markSpaceNotificationsRead,
  markAllSpaceNotificationsRead,
} from "./lib/space-notifications.js";

export {
  listWebhooks,
  addWebhook,
  removeWebhook,
} from "./lib/webhooks.js";

export {
  createProject,
  listProjects,
  getProject,
  getProjectByName,
  updateProject,
  deleteProject,
} from "./lib/projects.js";

export {
  getDb,
  getDbPath,
  closeDb,
} from "./lib/db.js";

export {
  CANONICAL_CONVERSATIONS_DATABASE_ENV,
  CANONICAL_CONVERSATIONS_RDS_CLUSTER,
  CANONICAL_CONVERSATIONS_RDS_DATABASE,
  CANONICAL_CONVERSATIONS_RDS_SECRET_PATH,
  CONVERSATIONS_DATABASE_FALLBACK_ENV,
  DEFAULT_STORAGE_TABLES,
  SYNC_EXCLUDED,
  STORAGE_CONFIG_PATH,
  STORAGE_DATABASE_ENV,
  STORAGE_MODE_ENV,
  getCanonicalConversationsRdsConfig,
  getStorageConfig,
  getStorageDatabaseUrl,
  getStoragePg,
  listConflicts,
  listPgTables,
  listSqliteTables,
  resolveTables,
  runStorageMigrations,
  storagePull,
  storagePush,
  storageSync,
} from "./lib/storage-sync.js";
export type {
  CanonicalConversationsRdsConfig,
  StorageConfig,
  StorageMode,
  StorageSyncResult,
  SyncConflict,
  SyncResult,
} from "./lib/storage-sync.js";

export {
  startPolling,
  useMessages,
  useSpaceMessages,
} from "./lib/poll.js";

export {
  resolveIdentity,
  requireIdentity,
} from "./lib/identity.js";

export {
  addReaction,
  removeReaction,
  getReactions,
  getReactionSummary,
} from "./lib/reactions.js";

export type { ReactionSummary } from "./lib/reactions.js";

export {
  fireWebhooks,
  fireTaskWebhooks,
} from "./lib/webhooks.js";

export type { WebhookConfig, TaskEvent } from "./lib/webhooks.js";

export {
  heartbeat,
  registerAgent,
  isAgentConflict,
  getPresence,
  listAgents,
  removePresence,
  renameAgent,
} from "./lib/presence.js";

export {
  acquireLock,
  tryBulkAcquireLock,
  releaseLock,
  checkLock,
  cleanExpiredLocks,
  releaseStaleAgentLocks,
  listLocks,
  listLocksEnriched,
} from "./lib/locks.js";

export type { ResourceLock, EnrichedLock, BulkLockRequest, BulkAcquireResult } from "./lib/locks.js";

export {
  computeHotness,
  listHotSessions,
} from "./lib/hot.js";

export type { HotSession, HotSessionsOptions } from "./lib/hot.js";

export {
  extractTopics,
  getSpaceTopics,
  getSessionTopics,
  getTrendingTopics,
} from "./lib/topics.js";

export type { TopicWeight } from "./lib/topics.js";

export { getConversationSummary } from "./lib/summary.js";

export {
  buildGraph,
  getRelated,
  getAgentNetwork,
  getGraphStats,
} from "./lib/graph.js";

export type { GraphEdge, RelatedEntity, AgentNetwork } from "./lib/graph.js";

export type { ConversationSummary, SummaryOptions } from "./lib/summary.js";

export { gatherTrainingData } from "./lib/gatherer.js";

export {
  getActiveModel,
  setActiveModel,
  clearActiveModel,
} from "./lib/model-config.js";

export {
  createTask,
  getTask,
  listTasks,
  startTask,
  completeTask,
  cancelTask,
  blockTask,
  unblockTask,
  reopenTask,
  assignTask,
  setTaskPriority,
  addComment,
  getComments,
  getSubtasks,
  getTaskTree,
  addDependency,
  removeDependency,
  getDependencies,
  getDependents,
  getTaskActivity,
  deleteTask,
  getDueTasks,
  getTaskSummary,
  searchTasks,
} from "./lib/tasks.js";

export type { DueTaskReminder, TaskSummary } from "./lib/tasks.js";

export type {
  Message,
  Session,
  Space,
  SpaceInfo,
  SpaceMember,
  Project,
  ProjectInfo,
  Priority,
  SendMessageOptions,
  ReadMessagesOptions,
  SearchMessagesOptions,
  SearchResult,
  AgentPresence,
  AgentConflictError,
  RegisterAgentResult,
  Reaction,
  Attachment,
  Task,
  TaskInfo,
  TaskComment,
  TaskActivity,
  TaskStatus,
  TaskPriority,
  CreateTaskOptions,
  ListTasksOptions,
  TaskTransition,
  SearchResultTask,
  SearchTasksOptions,
} from "./types.js";
