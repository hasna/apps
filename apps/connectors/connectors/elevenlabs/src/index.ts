// ElevenLabs API Connector
// A TypeScript wrapper for the ElevenLabs API

export { ElevenLabs, Connector } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ElevenLabsClient,
  VoicesApi,
  TTSApi,
  STTApi,
  STSApi,
  ModelsApi,
  HistoryApi,
  UserApi,
  SoundEffectsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getDefaultVoiceId,
  setDefaultVoiceId,
  getDefaultModel,
  setDefaultModel,
  getOutputDir,
  setOutputDir,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  profileExists,
} from './utils/config';
