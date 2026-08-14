export { Minimax, Connector } from './api';
export * from './types';

export { MinimaxClient, VideoApi, MusicApi, TTSApi, ImageApi, SoundEffectsApi } from './api';

export {
  getApiKey,
  setApiKey,
  getGroupId,
  setGroupId,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
