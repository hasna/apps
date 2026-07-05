// Zoho Vault Connector
export { ZohoVault, ZohoVaultClient } from './api';
export * from './types';

export {
  getApiKey,
  setApiKey,
  getToken,
  setToken,
  getDataCenter,
  setDataCenter,
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
  getOAuthConfig,
  setOAuthConfig,
  loadOAuthTokens,
  saveOAuthTokens,
  clearOAuthTokens,
  getAccessToken,
  getAccountsServer,
} from './utils/config';

export {
  getAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  startCallbackServer,
  getValidAccessToken,
  isAuthenticated,
  getRedirectUri,
  getRedirectPort,
  getAuthorizationEndpoint,
  getTokenEndpoint,
  getCallbackTokenEndpoint,
  resolveAccountsBaseUrl,
  type AuthResult,
  type AuthUrlOptions,
  type CallbackServerOptions,
} from './utils/auth';

export {
  loadSettings,
  saveSettings,
  getSetting,
  setSetting,
  resetSettings,
  getDefaultSettings,
  isVerbose,
  needsConfirmation,
  type Settings,
} from './utils/settings';

export {
  saveEntity,
  getEntity,
  entityExists,
  getAllEntities,
  deleteEntity,
  searchEntities,
  searchEntitiesByText,
  countEntities,
  clearEntities,
  createStorage,
  type Storable,
} from './utils/storage';

export {
  executeBulk,
  executeSequential,
  chunkArray,
  sleep,
  createProgressReporter,
  formatBulkResult,
  type BulkOperationOptions,
  type BulkOperationResult,
} from './utils/bulk';

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
