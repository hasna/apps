export { TripleWhale, TripleWhaleClient } from "./api/index.js";
export * from "./types/index.js";
export {
  getApiKey,
  setApiKey,
  getShopDomain,
  setShopDomain,
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
} from "./utils/config.js";
