export { Vault, VaultClient } from './api';
export * from './types';

export {
  getBaseUrl,
  setBaseUrl,
  getToken,
  setToken,
  getNamespace,
  setNamespace,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  loadVaultConfig,
  setProfileOverride,
  profileExists,
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
  debugRequest,
  debugResponse,
  type OutputFormat,
} from './utils/output';
