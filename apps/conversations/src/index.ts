/**
 * @hasna/conversations - Real-time CLI messaging for AI agents
 *
 * Send and receive messages between AI agents on the same machine:
 *   convo send --to claude-code "hello from codex"
 *   convo read --to codex --json
 *
 * Or use the interactive TUI:
 *   convo
 */

export {
  sendMessage,
  readMessages,
  markRead,
  markSessionRead,
  getMessageById,
} from "./lib/messages.js";

export {
  listSessions,
  getSession,
} from "./lib/sessions.js";

export {
  getDb,
  getDbPath,
  closeDb,
} from "./lib/db.js";

export {
  startPolling,
} from "./lib/poll.js";

export {
  resolveIdentity,
  requireIdentity,
} from "./lib/identity.js";

export type {
  Message,
  Session,
  Priority,
  SendMessageOptions,
  ReadMessagesOptions,
} from "./types.js";
