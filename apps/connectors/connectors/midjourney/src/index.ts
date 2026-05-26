// Midjourney API Connector
// A TypeScript wrapper for Midjourney image generation via third-party APIs

export { Midjourney } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { MidjourneyClient, ImagineApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getDiscordToken,
  setDiscordToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
