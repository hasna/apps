// Google Sheets API v4 Connector
// TypeScript client and CLI for reading/writing spreadsheets

export { GoogleSheets } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleSheetsClient, SpreadsheetsApi, ValuesApi, SheetsApi } from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setOAuthTokens,
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
  getAuthType,
  isTokenExpired,
} from './utils/config';
