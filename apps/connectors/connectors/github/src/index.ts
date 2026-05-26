// GitHub Connector
// A TypeScript wrapper for the GitHub API

export { GitHub } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GitHubClient, ReposApi, IssuesApi, PullsApi, UsersApi } from './api';

// Export config utilities
export {
  getToken,
  setToken,
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
} from './utils/config';
