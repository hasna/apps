// Google Tasks Connector - Manage task lists and tasks via Google Tasks API
// OAuth 2.0 authentication required

export { GoogleTasksClient, getClientId, getClientSecret, getAccessToken, getRefreshToken } from './api';
export type {
  GoogleTasksConfig,
  ProfileConfig,
  OutputFormat,
  OAuthTokens,
  OAuthConfig,
  TaskList,
  TaskListsResponse,
  Task,
  TasksResponse,
  TaskStatus,
  TaskLink,
  CreateTaskListParams,
  UpdateTaskListParams,
  CreateTaskParams,
  UpdateTaskParams,
  ListTasksParams,
  MoveTaskParams,
  GoogleTasksError,
  AuthenticationError,
  TokenExpiredError,
} from './types';

// Export config utilities
export {
  getCurrentProfile,
  setCurrentProfile,
  listProfiles,
  createProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  setCredentials,
  setTokens,
  isTokenExpired,
  clearTokens,
  clearConfig,
} from './utils/config';
