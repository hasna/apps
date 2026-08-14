// Google Workspace API Connector
// A TypeScript wrapper for Google Workspace APIs - Gmail, Drive, Calendar, Docs, Sheets

export { Google } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { GoogleClient, GmailApi, DriveApi, CalendarApi, DocsApi, SheetsApi } from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getRefreshToken,
  setRefreshToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getExportsDir,
  getImportsDir,
} from './utils/config';
