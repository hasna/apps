// Amplitude Connector
// A TypeScript wrapper for the Amplitude API

export { Amplitude } from './api';
export { AmplitudeClient } from './api/client';
export * from './types';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getSecretKey,
  setSecretKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
