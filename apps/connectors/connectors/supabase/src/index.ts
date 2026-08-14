// Supabase Connector
// A TypeScript wrapper for the Supabase API

export { Supabase } from './api';
export { SupabaseClient } from './api/client';
export * from './types';

// Export config utilities
export {
  getProjectUrl,
  setProjectUrl,
  getServiceRoleKey,
  setServiceRoleKey,
  getAnonKey,
  setAnonKey,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
