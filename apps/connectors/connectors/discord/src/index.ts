// Discord Connector
// TypeScript wrapper for the Discord API v10

export { Discord } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  DiscordClient,
  UsersApi,
  GuildsApi,
  ChannelsApi,
  WebhooksApi,
  InvitesApi,
  CommandsApi,
  GatewayApi,
} from './api';

// Export config utilities
export {
  getBotToken,
  setBotToken,
  getApplicationId,
  setApplicationId,
  getDefaultGuildId,
  setDefaultGuildId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
