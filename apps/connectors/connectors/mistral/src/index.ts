// Mistral AI API Connector
// A TypeScript wrapper for Mistral's chat completions and embeddings APIs

export { Mistral, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { MistralClient, ChatApi, EmbeddingsApi } from './api';

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
