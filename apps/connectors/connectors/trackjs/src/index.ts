// TrackJS Data API Connector

export { Trackjs, TrackjsClient, ErrorsApi } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getCustomerId,
  setCustomerId,
  getToken,
  setToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  setVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
