// Tinker Connector
// TypeScript wrapper for Tinker LLM fine-tuning API

export { Tinker } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { TinkerClient, TrainingApi, SamplingApi, StateApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getDefaultModel,
  setDefaultModel,
  getDefaultRank,
  setDefaultRank,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
