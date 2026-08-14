// Zoom Connector
// TypeScript wrapper for Zoom API with Server-to-Server OAuth

export { Zoom } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { ZoomClient, UsersApi, MeetingsApi, WebinarsApi, RecordingsApi, ReportsApi } from './api';

// Export config utilities
export {
  getAccountId,
  setAccountId,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
