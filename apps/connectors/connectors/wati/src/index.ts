export { Wati } from './api';
export * from './types';

export {
  WatiClient,
  ContactsApi,
  MessagesApi,
  TemplatesApi,
  OperatorsApi,
  LabelsApi,
  AttributesApi,
  BroadcastsApi,
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
  isAuthenticated,
} from './utils/config';
