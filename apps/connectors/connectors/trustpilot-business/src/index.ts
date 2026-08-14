export { TrustpilotBusiness } from './api';
export * from './types';
export { TrustpilotBusinessClient } from './api';

export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getBaseUrl,
  getInvitationsBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
