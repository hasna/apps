// Veriphone API connector — phone validation and carrier lookup

export { Veriphone } from './api';
export * from './types';
export { VeriphoneClient } from './api';

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
