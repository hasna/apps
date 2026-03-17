// ContactOut API Connector
// Find emails, phone numbers, and enrich LinkedIn profiles

export { ContactOut } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  ContactOutClient,
  LinkedInApi,
  PeopleApi,
  CompanyApi,
  EmailApi,
  StatsApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
