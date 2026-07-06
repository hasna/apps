// TextRazor NLP API connector

export { TextRazor, TextRazorClient } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getApiSecret,
  setApiSecret,
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
  getOAuthConfig,
  setOAuthConfig,
  loadOAuthTokens,
  saveOAuthTokens,
  clearOAuthTokens,
  getAccessToken,
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
