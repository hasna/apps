// E2B Code Interpreter API Connector
// A TypeScript wrapper for the E2B API - Run code in secure cloud sandboxes

export { E2B } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { E2BClient, SandboxApi, CodeApi, FilesystemApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getDefaultTemplate,
  setDefaultTemplate,
  getDefaultTimeout,
  setDefaultTimeout,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
