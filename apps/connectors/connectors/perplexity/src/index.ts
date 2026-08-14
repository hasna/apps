// Perplexity AI API Connector
// A TypeScript wrapper for Perplexity's chat completions with web search grounding

export { Perplexity } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { PerplexityClient, ChatApi } from './api';

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
