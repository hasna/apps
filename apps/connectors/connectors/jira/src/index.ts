// Jira Connector
// TypeScript wrapper for Jira projects, issues, boards, and sprints API

export { Jira } from './api';
export * from './types';
export { JiraClient } from './api';

export {
  getEmail,
  setEmail,
  getApiToken,
  setApiToken,
  getDomain,
  setDomain,
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  clearConfig,
} from './utils/config';
