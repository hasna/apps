// Vela AI scheduling connector

export { Vela } from './api';
export * from './types';

export {
  VelaClient,
  DEFAULT_BASE_URL,
  SchedulingRequestsApi,
  MeetingsApi,
  ContactsApi,
  CalendarApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getBaseUrl,
  setBaseUrl,
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
  isVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
