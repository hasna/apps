// YouTube Data API v3 and Analytics API
// TypeScript client for YouTube APIs

export { YouTube } from './api';
export * from './types';

// Re-export individual API classes for advanced usage
export {
  YouTubeClient,
  ChannelsApi,
  VideosApi,
  PlaylistsApi,
  PlaylistItemsApi,
  SearchApi,
  CommentsApi,
  CommentThreadsApi,
  SubscriptionsApi,
  CaptionsApi,
  ThumbnailsApi,
  WatermarksApi,
  CategoriesApi,
  LiveApi,
  AnalyticsApi,
  MembersApi,
} from './api';

// Export config utilities
export {
  getAccessToken,
  setAccessToken,
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
