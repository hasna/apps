// xAI Grok API Connector
// A TypeScript wrapper for xAI's Grok chat API

export { XAI, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { XAIClient, ChatApi } from './api';

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
