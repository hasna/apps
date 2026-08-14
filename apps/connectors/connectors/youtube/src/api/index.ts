import type { YouTubeConfig } from '../types';
import { YouTubeClient } from './client';
import { ChannelsApi } from './channels';
import { VideosApi } from './videos';
import { PlaylistsApi } from './playlists';
import { PlaylistItemsApi } from './playlistItems';
import { SearchApi } from './search';
import { CommentsApi } from './comments';
import { CommentThreadsApi } from './commentThreads';
import { SubscriptionsApi } from './subscriptions';
import { CaptionsApi } from './captions';
import { ThumbnailsApi } from './thumbnails';
import { WatermarksApi } from './watermarks';
import { CategoriesApi } from './categories';
import { LiveApi } from './live';
import { AnalyticsApi } from './analytics';
import { MembersApi } from './members';

/**
 * YouTube Data API v3 and Analytics API client
 * Provides access to all YouTube API endpoints
 */
export class YouTube {
  private readonly client: YouTubeClient;

  // API modules
  public readonly channels: ChannelsApi;
  public readonly videos: VideosApi;
  public readonly playlists: PlaylistsApi;
  public readonly playlistItems: PlaylistItemsApi;
  public readonly search: SearchApi;
  public readonly comments: CommentsApi;
  public readonly commentThreads: CommentThreadsApi;
  public readonly subscriptions: SubscriptionsApi;
  public readonly captions: CaptionsApi;
  public readonly thumbnails: ThumbnailsApi;
  public readonly watermarks: WatermarksApi;
  public readonly categories: CategoriesApi;
  public readonly live: LiveApi;
  public readonly analytics: AnalyticsApi;
  public readonly members: MembersApi;

  constructor(config: YouTubeConfig) {
    this.client = new YouTubeClient(config);
    this.channels = new ChannelsApi(this.client);
    this.videos = new VideosApi(this.client);
    this.playlists = new PlaylistsApi(this.client);
    this.playlistItems = new PlaylistItemsApi(this.client);
    this.search = new SearchApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.commentThreads = new CommentThreadsApi(this.client);
    this.subscriptions = new SubscriptionsApi(this.client);
    this.captions = new CaptionsApi(this.client);
    this.thumbnails = new ThumbnailsApi(this.client);
    this.watermarks = new WatermarksApi(this.client);
    this.categories = new CategoriesApi(this.client);
    this.live = new LiveApi(this.client);
    this.analytics = new AnalyticsApi(this.client);
    this.members = new MembersApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for YOUTUBE_ACCESS_TOKEN or YOUTUBE_API_KEY
   */
  static fromEnv(): YouTube {
    const accessToken = process.env.YOUTUBE_ACCESS_TOKEN;
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!accessToken && !apiKey) {
      throw new Error('YOUTUBE_ACCESS_TOKEN or YOUTUBE_API_KEY environment variable is required');
    }
    return new YouTube({ accessToken, apiKey });
  }

  /**
   * Get a preview of the token (for debugging)
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Check if client has OAuth token (required for write operations)
   */
  hasOAuthToken(): boolean {
    return this.client.hasOAuthToken();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): YouTubeClient {
    return this.client;
  }
}

export { YouTubeClient } from './client';
export { ChannelsApi } from './channels';
export { VideosApi } from './videos';
export { PlaylistsApi } from './playlists';
export { PlaylistItemsApi } from './playlistItems';
export { SearchApi } from './search';
export { CommentsApi } from './comments';
export { CommentThreadsApi } from './commentThreads';
export { SubscriptionsApi } from './subscriptions';
export { CaptionsApi } from './captions';
export { ThumbnailsApi } from './thumbnails';
export { WatermarksApi } from './watermarks';
export { CategoriesApi } from './categories';
export { LiveApi } from './live';
export { AnalyticsApi } from './analytics';
export { MembersApi } from './members';
