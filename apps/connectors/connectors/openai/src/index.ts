// OpenAI API Connector
// A TypeScript wrapper for OpenAI's chat, embeddings, and image APIs

export { OpenAI, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { OpenAIClient, ChatApi, EmbeddingsApi, ImagesApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getOrganization,
  setOrganization,
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
