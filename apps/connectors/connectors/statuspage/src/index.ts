export { Statuspage } from './api';
export * from './types';
export { StatuspageClient } from './api';

export {
  getApiKey,
  setApiKey,
  getPageId,
  setPageId,
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
  type OutputFormat,
} from './utils/output';
