export { EdgeConfigPlatform } from './api';
export * from './types';
export { EdgeConfigPlatformClient } from './api';

export {
  getApiKey,
  setApiKey,
  getTeamId,
  setTeamId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
