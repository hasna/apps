// Twelve Data API Connector

export { Connector } from './api';
export * from './types';

export {
  ConnectorClient,
  PriceApi,
  QuoteApi,
  TimeSeriesApi,
  ExchangeRateApi,
  SymbolsApi,
} from './api';

export {
  getApiKey,
  getBaseUrl,
  setApiKey,
  getApiSecret,
  setApiSecret,
  getToken,
  setToken,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
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
