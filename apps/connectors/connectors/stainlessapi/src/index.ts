// Stainless API Connector
// A TypeScript client + CLI for the public Stainless REST API.

export { Stainless, Connector } from './api';
export * from './types';

// Re-export resource API classes for advanced usage
export {
  StainlessClient,
  BuildsApi,
  ProjectsApi,
  BranchesApi,
  OrgsApi,
  UserApi,
} from './api';

// Config utilities
export {
  getApiKey,
  setApiKey,
  getDefaultProject,
  setDefaultProject,
  getEnvironment,
  setEnvironment,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
