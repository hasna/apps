// Zibra Labs Connector
// TypeScript wrapper for the Zibra Labs quant backtesting HPC API

export { ZibraLabs } from './api';
export * from './types';
export { ZibraLabsClient, DEFAULT_BASE_URL, encodePathSegment } from './api';

export {
  getApiKey,
  getBaseUrl,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
