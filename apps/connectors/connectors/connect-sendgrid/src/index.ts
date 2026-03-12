// SendGrid Connector
// Send emails, manage contacts, templates, and email marketing

export { SendGrid, SendGridClient } from './api';
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
