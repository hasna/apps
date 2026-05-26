// Telegram Connector
// TypeScript wrapper for Telegram Bot API

export { Telegram } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { TelegramClient, MessagesApi, ChatsApi, UpdatesApi, InlineApi, BotApi } from './api';

// Export config utilities
export {
  getBotToken,
  setBotToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
