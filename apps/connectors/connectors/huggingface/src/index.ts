// HuggingFace API Connector
// A TypeScript wrapper for the HuggingFace API

export { HuggingFace } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { HuggingFaceClient, ExampleApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
