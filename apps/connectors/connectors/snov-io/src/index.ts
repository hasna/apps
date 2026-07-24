// Snov.io connector library exports

export { SnovIo } from './api';
export * from './types';

export { SnovIoClient, CampaignsApi, DomainSearchApi, AccountApi } from './api';

export {
  getClientId,
  setClientId,
  getClientSecret,
  setClientSecret,
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
  getConfigDir,
  getActiveProfileName,
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
  isVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
