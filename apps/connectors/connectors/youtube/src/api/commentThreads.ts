import type { YouTubeClient } from './client';
import type {
  CommentThread,
  CommentThreadListParams,
  ListResponse,
} from '../types';

export interface CommentThreadInsertParams {
  part: string[];
}

export class CommentThreadsApi {
  constructor(private readonly client: YouTubeClient) {}

  /**
   * List comment threads
   * Quota cost: 1 unit per request
   */
  async list(params: CommentThreadListParams): Promise<ListResponse<CommentThread>> {
    return this.client.get<ListResponse<CommentThread>>('/commentThreads', {
      part: params.part,
      allThreadsRelatedToChannelId: params.allThreadsRelatedToChannelId,
      channelId: params.channelId,
      id: params.id,
      videoId: params.videoId,
      maxResults: params.maxResults,
      moderationStatus: params.moderationStatus,
      order: params.order,
      pageToken: params.pageToken,
      searchTerms: params.searchTerms,
      textFormat: params.textFormat,
    });
  }

  /**
   * Get comment threads for a video
   */
  async getForVideo(
    videoId: string,
    options: {
      maxResults?: number;
      order?: 'relevance' | 'time';
      searchTerms?: string;
      textFormat?: 'html' | 'plainText';
      pageToken?: string;
    } = {}
  ): Promise<ListResponse<CommentThread>> {
    return this.list({
      part: ['snippet', 'replies'],
      videoId,
      maxResults: options.maxResults || 20,
      order: options.order,
      searchTerms: options.searchTerms,
      textFormat: options.textFormat || 'plainText',
      pageToken: options.pageToken,
    });
  }

  /**
   * Get comment threads for a channel
   */
  async getForChannel(
    channelId: string,
    options: {
      maxResults?: number;
      order?: 'relevance' | 'time';
      searchTerms?: string;
      textFormat?: 'html' | 'plainText';
      pageToken?: string;
    } = {}
  ): Promise<ListResponse<CommentThread>> {
    return this.list({
      part: ['snippet', 'replies'],
      channelId,
      maxResults: options.maxResults || 20,
      order: options.order,
      searchTerms: options.searchTerms,
      textFormat: options.textFormat || 'plainText',
      pageToken: options.pageToken,
    });
  }

  /**
   * Get all comment threads related to a channel (on any video)
   */
  async getAllForChannel(
    channelId: string,
    options: {
      maxResults?: number;
      order?: 'relevance' | 'time';
      searchTerms?: string;
      textFormat?: 'html' | 'plainText';
      pageToken?: string;
    } = {}
  ): Promise<ListResponse<CommentThread>> {
    return this.list({
      part: ['snippet', 'replies'],
      allThreadsRelatedToChannelId: channelId,
      maxResults: options.maxResults || 20,
      order: options.order,
      searchTerms: options.searchTerms,
      textFormat: options.textFormat || 'plainText',
      pageToken: options.pageToken,
    });
  }

  /**
   * Get comment threads by ID
   */
  async get(threadId: string, parts: string[] = ['snippet', 'replies']): Promise<CommentThread | null> {
    const response = await this.list({ part: parts, id: threadId });
    return response.items[0] || null;
  }

  /**
   * Get multiple comment threads by IDs
   */
  async getMany(threadIds: string[], parts: string[] = ['snippet', 'replies']): Promise<CommentThread[]> {
    const response = await this.list({ part: parts, id: threadIds });
    return response.items;
  }

  /**
   * Get comment threads by moderation status
   */
  async getByModerationStatus(
    videoId: string,
    moderationStatus: 'heldForReview' | 'likelySpam' | 'published',
    maxResults = 20
  ): Promise<ListResponse<CommentThread>> {
    return this.list({
      part: ['snippet', 'replies'],
      videoId,
      moderationStatus,
      maxResults,
    });
  }

  /**
   * Insert (create) a new top-level comment thread
   * Quota cost: 50 units
   */
  async insert(
    thread: Omit<CommentThread, 'kind' | 'etag' | 'id'>,
    params: CommentThreadInsertParams
  ): Promise<CommentThread> {
    return this.client.post<CommentThread>(
      '/commentThreads',
      thread as Record<string, unknown>,
      { part: params.part }
    );
  }

  /**
   * Post a new comment on a video
   */
  async comment(
    videoId: string,
    text: string,
    channelId: string
  ): Promise<CommentThread> {
    return this.insert(
      {
        snippet: {
          videoId,
          channelId,
          topLevelComment: {
            snippet: {
              textOriginal: text,
            },
          },
        },
      } as Omit<CommentThread, 'kind' | 'etag' | 'id'>,
      { part: ['snippet'] }
    );
  }

  /**
   * Post a new comment on a channel's discussion tab
   */
  async commentOnChannel(
    channelId: string,
    text: string
  ): Promise<CommentThread> {
    return this.insert(
      {
        snippet: {
          channelId,
          topLevelComment: {
            snippet: {
              textOriginal: text,
            },
          },
        },
      } as Omit<CommentThread, 'kind' | 'etag' | 'id'>,
      { part: ['snippet'] }
    );
  }

  /**
   * Search for comments containing specific terms
   */
  async search(
    videoId: string,
    searchTerms: string,
    maxResults = 20
  ): Promise<ListResponse<CommentThread>> {
    return this.list({
      part: ['snippet', 'replies'],
      videoId,
      searchTerms,
      maxResults,
    });
  }
}
