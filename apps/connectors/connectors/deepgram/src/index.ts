// Deepgram Connector
// TypeScript wrapper for Deepgram speech-to-text and text-to-speech API

export { Deepgram } from './api';
export * from './types';
export { DeepgramClient } from './api';

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
