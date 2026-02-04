// Google Cloud API Connector
// A TypeScript wrapper for Google Cloud Resource Manager API

export { GoogleCloud, GoogleCloud as Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleCloudClient, GoogleCloudClient as ConnectorClient, ProjectsApi, ProjectsApi as ExampleApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getCredentialsPath,
  setCredentialsPath,
  getProjectId,
  setProjectId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
