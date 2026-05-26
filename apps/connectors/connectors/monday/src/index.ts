// Monday.com Connector
// TypeScript wrapper for Monday.com workspaces, boards, items, and columns API

export { Monday } from './api';
export * from './types';
export { MondayClient } from './api';

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
