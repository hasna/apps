// Zhipu AI Connector
// TypeScript wrapper for Zhipu AI (GLM) API

export { ZhipuAi } from './api';
export * from './types';
export { ZhipuAiClient } from './api';

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
