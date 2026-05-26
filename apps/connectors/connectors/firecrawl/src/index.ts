// Firecrawl Connector
// A TypeScript wrapper for the Firecrawl web scraping API

export { Firecrawl } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export { FirecrawlClient, ScrapeApi, CrawlApi, MapApi, SearchApi } from './api';

// Export config utilities
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
