// Modal Connector
// TypeScript wrapper for Modal API

export { Modal } from './api';
export * from './types';
export { ModalClient } from './api';

export {
  getTokenId,
  setTokenId,
  getTokenSecret,
  setTokenSecret,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
