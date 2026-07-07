// Zatanna AI Connector
// TypeScript wrapper for Zatanna workflow automation API

export { Zatanna, ZatannaClient, WorkflowsApi, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getConfig,
  setApiKey,
  setDefaultWorkspaceId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
