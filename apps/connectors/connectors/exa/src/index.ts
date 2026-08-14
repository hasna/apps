// Exa AI Search API
// TypeScript client for Exa's AI-powered search API

export { Exa } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ExaClient,
  SearchApi,
  ContentsApi,
  SimilarApi,
  AnswerApi,
  ContextApi,
  ResearchApi,
  WebsetsApi,
  TeamApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
