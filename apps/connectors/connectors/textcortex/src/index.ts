// TextCortex API Connector
// A TypeScript wrapper for TextCortex's Hemingwai text APIs

export { TextCortex, Connector } from './api';
export * from './types';

export { TextCortexClient, HemingwaiApi, HEMINGWAI_PATHS, DEFAULT_BASE_URL } from './api';

export {
  getApiKey,
  setApiKey,
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
