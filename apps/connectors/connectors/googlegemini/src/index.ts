// Google Gemini API Connector
// TypeScript wrapper for the Gemini API

export { Gemini } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  GeminiClient,
  GenerateApi,
  ImagesApi,
  VideoApi,
  SpeechApi,
  EmbeddingsApi,
  FilesApi,
  ModelsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  hasApiKey,
} from './utils/config';
