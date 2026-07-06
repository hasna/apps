// TicketSource Connector
// TypeScript wrapper for the TicketSource REST API

export { TicketSource } from './api';
export * from './types';
export { TicketSourceClient } from './api';

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
