// Tines Connector — SOAR workflow automation API

export { Tines } from './api';
export * from './types';

export {
  TinesClient,
  StoriesApi,
  AgentsApi,
  EventsApi,
  FoldersApi,
  TeamsApi,
  UsersApi,
  TunnelsApi,
  CredentialsApi,
  AnnotationsApi,
  StoryRunsApi,
  WebhooksApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getTenantUrl,
  setTenantUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
} from './utils/config';

export { formatOutput, success, error, warn, info, heading, print, type OutputFormat } from './utils/output';
