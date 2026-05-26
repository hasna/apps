// DocuSign Connector
// TypeScript wrapper for DocuSign electronic signature API

export { DocuSign } from './api';
export * from './types';
export { DocuSignClient } from './api';

export {
  getAccessToken,
  setAccessToken,
  getAccountId,
  setAccountId,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
