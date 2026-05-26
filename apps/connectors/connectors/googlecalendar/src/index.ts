// Google Calendar Connector API
// A TypeScript wrapper for Google Calendar API with OAuth2 authentication

export { GoogleCalendar } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleCalendarClient, CalendarsApi, EventsApi, CALENDAR_SCOPES } from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
  setTokens,
  isTokenExpired,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
