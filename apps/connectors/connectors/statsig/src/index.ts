export { Statsig } from './api';
export * from './types';

export {
  StatsigClient,
  GatesApi,
  ExperimentsApi,
  DynamicConfigsApi,
  HoldoutsApi,
  SegmentsApi,
  LayersApi,
  AutotunesApi,
  MetricsApi,
  TagsApi,
  UsersApi,
  TeamsApi,
  EventsApi,
} from './api';

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
  getConfigDir,
} from './utils/config';

export {
  formatOutput,
  success,
  error,
  warn,
  info,
  print,
  setVerboseMode,
  debug,
  type OutputFormat,
} from './utils/output';
