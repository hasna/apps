// Stitch (Stitch Connect) Connector
// TypeScript wrapper for the Stitch Connect API (sources, destinations,
// streams, replication jobs, and extraction/load reporting).

export { Stitch } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  StitchClient,
  SourcesApi,
  DestinationsApi,
  SourceTypesApi,
  DestinationTypesApi,
  StreamsApi,
  ReplicationApi,
  ReportingApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
  getClientId,
  setClientId,
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
  maskAccessToken,
} from './utils/config';
