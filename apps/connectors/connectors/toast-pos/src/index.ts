// Toast POS Connector

export { ToastPos, ToastClient, loginWithMachineClient, getValidAccessToken, DEFAULT_BASE_URL, AUTH_LOGIN_PATH } from './api';
export * from './types';

export {
  getClientId,
  getClientSecret,
  getRestaurantExternalId,
  getBaseUrl,
  setCredentials,
  setRestaurantExternalId,
  setBaseUrl,
  saveAuthToken,
  loadAuthToken,
  clearAuthToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
} from './utils/config';
