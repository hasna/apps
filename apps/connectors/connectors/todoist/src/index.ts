// Todoist Connector
// Projects, tasks, sections, labels, and comments management

export { Todoist, TodoistClient } from './api';
export * from './types';

// Export config utilities
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
  getConfigDir,
  getActiveProfileName,
} from './utils/config';
