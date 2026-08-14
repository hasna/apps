// Vercel Edge Config Connector API

export { VercelEdgeConfig } from './api';
export * from './types';
export { VercelEdgeConfigClient, DEFAULT_BASE_URL } from './api';

export {
  getApiKey,
  setApiKey,
  getTeamId,
  setTeamId,
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
