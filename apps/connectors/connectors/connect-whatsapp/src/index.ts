// WhatsApp Business Cloud Connector
// Send messages, manage templates, and handle webhooks

export { WhatsApp, WhatsAppClient } from './api';
export * from './types';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getPhoneNumberId,
  setPhoneNumberId,
  getBusinessAccountId,
  setBusinessAccountId,
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
