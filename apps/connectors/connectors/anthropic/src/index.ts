// Anthropic API Connector
// A TypeScript wrapper for Anthropic's Claude models

export { Anthropic, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { AnthropicClient, MessagesApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getDefaultModel,
  setDefaultModel,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
