export { Squarespace } from './api';
export * from './types';

export {
  SquarespaceClient,
  InventoryApi,
  OrdersApi,
  ProductsApi,
  TransactionsApi,
  ProfilesApi,
  StorePagesApi,
  WebhooksApi,
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
} from './utils/config';
