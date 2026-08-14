// Figma Connector
// TypeScript wrapper for Figma REST API

export { Figma } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  FigmaClient,
  FilesApi,
  CommentsApi,
  TeamsApi,
  ProjectsApi,
  ComponentsApi,
  StylesApi,
  WebhooksApi,
  UsersApi,
  VariablesApi,
  DevResourcesApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
