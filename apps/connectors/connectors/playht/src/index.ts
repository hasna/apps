// PlayHT Connector
// TypeScript wrapper for PlayHT text-to-speech API

export { PlayHT } from './api';
export * from './types';
export { PlayHTClient } from './api';

export {
  getApiKey,
  setApiKey,
  getUserId,
  setUserId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
