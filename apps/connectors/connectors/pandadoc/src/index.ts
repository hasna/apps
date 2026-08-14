// PandaDoc API Connector
// A TypeScript wrapper for the PandaDoc API

export { PandaDoc } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  PandaDocClient,
  DocumentsApi,
  TemplatesApi,
  ContactsApi,
  FoldersApi,
  MembersApi,
  WebhooksApi,
  FormsApi,
  CatalogsApi,
  ContentLibraryApi,
} from './api';

// Export config utilities
export {
  getApiKey,
  setApiKey,
  getAccessToken,
  setAccessToken,
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
  getExportsDir,
  getImportsDir,
} from './utils/config';
