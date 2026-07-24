// SmartRecruiters API Connector
// A TypeScript wrapper for the SmartRecruiters API with multi-profile support

export { SmartRecruiters } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  SmartRecruitersClient,
  JobsApi,
  CandidatesApi,
  PostingsApi,
  ConfigurationApi,
  UsersApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCompanyId,
  setCompanyId,
  isAuthenticated,
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

// Export output utilities
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
