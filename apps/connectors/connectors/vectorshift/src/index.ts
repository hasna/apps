// VectorShift Connector
// TypeScript wrapper for the VectorShift REST API

export { VectorShift } from './api';
export * from './types';
export { VectorShiftClient } from './api';

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
