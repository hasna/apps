// Ticket Tailor Connector
// TypeScript wrapper for the Ticket Tailor API

export { TicketTailor } from './api';
export * from './types';
export { TicketTailorClient } from './api';

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
