// iMessage Connector
// TypeScript wrapper for iMessage via bridge API

export { IMessage } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { ImessageClient, HealthApi, ConversationsApi, MessagesApi } from './api';

// Export config utilities
export {
  getBridgeUrl,
  getApiKey,
  getDeviceId,
  setBridgeUrl,
  setApiKey,
  setDeviceId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
