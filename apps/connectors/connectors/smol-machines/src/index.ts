export { SmolMachines } from './api';
export * from './types';
export { SmolMachinesClient, DEFAULT_BASE_URL } from './api';

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
  loadProfile,
  saveProfile,
  clearConfig,
  getConnectorConfig,
} from './utils/config';
