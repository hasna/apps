// Tableau Connector
// Explore workbooks, views, dashboards, datasources, projects, and users
// via the Tableau REST API.

export { Tableau, TableauClient } from './api';
export * from './types';

// Export config utilities
export {
  getServerUrl,
  getSiteName,
  getApiVersion,
  getUsername,
  getPassword,
  getPatName,
  getPatSecret,
  updateConfig,
  clearConfig,
  loadProfile,
  saveProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  getConfigDir,
  getActiveProfileName,
  getCurrentProfile,
  setCurrentProfile,
} from './utils/config';
