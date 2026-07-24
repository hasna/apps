// Toggl Track Connector

export { Toggl, TogglClient } from './api';
export * from './types';

export {
  getApiToken,
  setApiToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
