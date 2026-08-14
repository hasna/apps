// fal.ai Connector
// TypeScript wrapper for fal.ai serverless AI inference

export { Fal } from './api';
export * from './types';
export { FalClient } from './api';

export {
  getApiKey,
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
