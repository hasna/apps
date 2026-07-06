// Sumo Logic Connector
// A TypeScript wrapper for the Sumo Logic REST API.
// https://help.sumologic.com/docs/api/

export { SumoLogic } from './api';
export * from './types';

// Re-export client for advanced usage
export { SumoLogicClient, resolveEndpoint } from './api/client';

// Export config utilities
export {
  getAccessId,
  setAccessId,
  getAccessKey,
  setAccessKey,
  getDeployment,
  setDeployment,
  getEndpoint,
  setEndpoint,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
