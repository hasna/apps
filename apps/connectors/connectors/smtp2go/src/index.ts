// SMTP2GO connector
// A TypeScript wrapper and CLI for the SMTP2GO v3 API.

export { Smtp2go, Smtp2goClient } from './api';
export * from './types';

// Config utilities
export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  profileExists,
  loadProfile,
  saveProfile,
  clearConfig,
  getConfigDir,
  type ProfileConfig,
} from './utils/config';

// Output utilities
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
} from './utils/output';
