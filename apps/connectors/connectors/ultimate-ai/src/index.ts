// Ultimate AI connector — Zendesk Ultimate AI support bot platform
export { UltimateAi, UltimateAiClient, DEFAULT_BASE_URL } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
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
  getConfigDir,
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
