// Docker Hub API Connector
// A TypeScript wrapper for Docker Hub API

export { Docker, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { DockerClient, ConnectorClient, RepositoriesApi, ExampleApi } from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getUsername,
  setUsername,
  getPassword,
  setPassword,
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
