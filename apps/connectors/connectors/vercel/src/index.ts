// Vercel Connector API
// A TypeScript wrapper for Vercel's REST API

export { Vercel } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { VercelClient } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getTeamId,
  setTeamId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
