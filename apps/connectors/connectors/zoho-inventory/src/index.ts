// Zoho Inventory Connector
// TypeScript wrapper for Zoho Inventory API

export { ZohoInventory, ZohoInventoryClient } from './api';
export * from './types';

export {
  getToken,
  setToken,
  getOrganizationId,
  setOrganizationId,
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
  getConfigDir,
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  heading,
  print,
  setVerboseMode,
  isVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
