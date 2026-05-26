// Mailchimp Connector
// Manage audiences, campaigns, templates, and email marketing

export { Mailchimp, MailchimpClient } from './api';
export * from './types';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getServerPrefix,
  setServerPrefix,
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
