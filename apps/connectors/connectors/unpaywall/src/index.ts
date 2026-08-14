// Unpaywall Open Access API Connector
export { Unpaywall, UnpaywallClient, Connector } from './api';
export * from './types';
export {
  loadConfig,
  saveConfig,
  getEmail,
  setEmail,
  clearConfig,
  getEmailPreview,
} from './utils/config';
