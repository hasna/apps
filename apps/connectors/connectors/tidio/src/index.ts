// Tidio Connector
// Contacts, contact messages, departments, operators, project, tickets, products, and Lyro.

export { Tidio, TidioClient } from './api';
export * from './types';

export {
  getClientCredentials,
  setClientCredentials,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  getProfilesDir,
  getActiveProfileName,
  validateProfileName,
} from './utils/config';
