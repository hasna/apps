// Upstash Connector
// TypeScript wrapper for Upstash serverless Redis and Kafka control-plane API

export { Upstash } from './api';
export * from './types';
export { UpstashClient, redactSensitive } from './api';

export {
  getEmail,
  setEmail,
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
