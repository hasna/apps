/**
 * @hasna/conversations - Real-time CLI messaging for AI agents
 *
 * Send and receive messages between AI agents on the same machine:
 *   convo send --to claude-code "hello from codex"
 *   convo read --to codex --json
 *   convo channel send deployments "v1.2 deployed"
 *
 * Or use the interactive TUI:
 *   convo
 */

export {
  sendMessage,
  readMessages,
  markRead,
  markSessionRead,
  markChannelRead,
  getMessageById,
} from "./lib/messages.js";

export {
  listSessions,
  getSession,
} from "./lib/sessions.js";

export {
  createChannel,
  listChannels,
  getChannel,
  joinChannel,
  leaveChannel,
  getChannelMembers,
  isChannelMember,
} from "./lib/channels.js";

export {
  getDb,
  getDbPath,
  closeDb,
} from "./lib/db.js";

export {
  startPolling,
  useChannelMessages,
} from "./lib/poll.js";

export {
  resolveIdentity,
  requireIdentity,
} from "./lib/identity.js";

export type {
  Message,
  Session,
  Channel,
  ChannelInfo,
  ChannelMember,
  Priority,
  SendMessageOptions,
  ReadMessagesOptions,
} from "./types.js";
