export { Connector, Connector as Trustpilot } from './api';
export * from './types';

export {
  TrustpilotClient,
  CategoriesApi,
  BusinessUnitsApi,
  ReviewsApi,
  InvitationsApi,
  ProductsApi,
  ConsumersApi,
  TagsApi,
  OAuthApi,
} from './api';

export {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
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
