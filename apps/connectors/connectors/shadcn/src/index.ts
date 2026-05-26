// Shadcn Connector
// A TypeScript wrapper for the shadcn CLI

export { Shadcn } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { ShadcnClient, ComponentsApi } from './api';

// Export config utilities
export {
  getCwd,
  setCwd,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
