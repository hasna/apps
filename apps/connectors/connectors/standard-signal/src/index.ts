// Standard Signal API Connector

export { StandardSignal } from './api';
export * from './types';

export {
  StandardSignalClient,
  PortfoliosApi,
  StrategiesApi,
  PositionsApi,
  TradesApi,
  PerformanceApi,
} from './api';

export {
  getApiKey,
  setApiKey,
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
} from './utils/config';
