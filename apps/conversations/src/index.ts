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
} from "./lib/webhooks.js";

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
  releaseLock,
  checkLock,
  cleanExpiredLocks,
  releaseStaleAgentLocks,
  listLocks,
} from "./lib/locks.js";

export type { ResourceLock } from "./lib/locks.js";

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
} from "./types.js";
