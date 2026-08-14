import type { RedditClient } from './client';
import type { RedditPost, Subreddit, SearchOptions, SearchResults } from '../types';

interface RedditListingResponse {
  kind: string;
  data: {
    after: string | null;
    before: string | null;
    children: {
      kind: string;
      data: Record<string, unknown>;
    }[];
  };
}

/**
 * Search API - search posts, subreddits, users
 */
export class SearchApi {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Search for posts
   */
  async searchPosts(options: SearchOptions): Promise<SearchResults> {
    const {
      query,
      subreddit,
      sort = 'relevance',
      time = 'all',
      limit = 25,
      after,
      before,
      restrictSr = false,
    } = options;

    const path = subreddit ? `/r/${subreddit}/search` : '/search';

    const response = await this.client.request<RedditListingResponse>(path, {
      params: {
        q: query,
        sort,
        t: time,
        limit,
        after,
        before,
        restrict_sr: restrictSr,
        type: 'link',
        raw_json: 1,
      },
    });

    const posts = response.data.children
      .filter(child => child.kind === 't3')
      .map(child => this.parsePost(child.data));

    return {
      posts,
      after: response.data.after || undefined,
      before: response.data.before || undefined,
    };
  }

  /**
   * Search for subreddits
   */
  async searchSubreddits(
    query: string,
    options: {
      limit?: number;
      after?: string;
      includeNsfw?: boolean;
    } = {}
  ): Promise<{ subreddits: Subreddit[]; after?: string }> {
    const { limit = 25, after, includeNsfw = false } = options;

    const response = await this.client.request<RedditListingResponse>('/subreddits/search', {
      params: {
        q: query,
        limit,
        after,
        include_over_18: includeNsfw,
        raw_json: 1,
      },
    });

    const subreddits = response.data.children
      .filter(child => child.kind === 't5')
      .map(child => this.parseSubreddit(child.data));

    return {
      subreddits,
      after: response.data.after || undefined,
    };
  }

  /**
   * Search across all types (posts and subreddits)
   */
  async search(options: SearchOptions): Promise<SearchResults> {
    const {
      query,
      subreddit,
      sort = 'relevance',
      time = 'all',
      type,
      limit = 25,
      after,
      before,
      restrictSr = false,
    } = options;

    const path = subreddit ? `/r/${subreddit}/search` : '/search';

    const response = await this.client.request<RedditListingResponse>(path, {
      params: {
        q: query,
        sort,
        t: time,
        type: type || 'link,sr',
        limit,
        after,
        before,
        restrict_sr: restrictSr,
        raw_json: 1,
      },
    });

    const posts: RedditPost[] = [];
    const subreddits: Subreddit[] = [];

    for (const child of response.data.children) {
      if (child.kind === 't3') {
        posts.push(this.parsePost(child.data));
      } else if (child.kind === 't5') {
        subreddits.push(this.parseSubreddit(child.data));
      }
    }

    return {
      posts,
      subreddits: subreddits.length > 0 ? subreddits : undefined,
      after: response.data.after || undefined,
      before: response.data.before || undefined,
    };
  }

  /**
   * Autocomplete subreddit names
   */
  async autocompleteSubreddits(
    query: string,
    options: { includeNsfw?: boolean; includeProfiles?: boolean } = {}
  ): Promise<string[]> {
    const { includeNsfw = false, includeProfiles = false } = options;

    const response = await this.client.request<{
      subreddits: { name: string }[];
    }>('/api/subreddit_autocomplete_v2', {
      params: {
        query,
        include_over_18: includeNsfw,
        include_profiles: includeProfiles,
        raw_json: 1,
      },
    });

    return response.subreddits.map(sr => sr.name);
  }

  /**
   * Parse raw post data to RedditPost
   */
  private parsePost(data: Record<string, unknown>): RedditPost {
    return {
      id: String(data.id),
      name: String(data.name),
      title: String(data.title),
      author: String(data.author),
      subreddit: String(data.subreddit),
      subredditNamePrefixed: String(data.subreddit_name_prefixed),
      selftext: data.selftext ? String(data.selftext) : undefined,
      selftextHtml: data.selftext_html ? String(data.selftext_html) : undefined,
      url: String(data.url),
      permalink: `https://reddit.com${data.permalink}`,
      thumbnail: data.thumbnail && data.thumbnail !== 'self' && data.thumbnail !== 'default'
        ? String(data.thumbnail)
        : undefined,
      score: Number(data.score),
      upvoteRatio: data.upvote_ratio ? Number(data.upvote_ratio) : undefined,
      numComments: Number(data.num_comments),
      created: Number(data.created),
      createdUtc: Number(data.created_utc),
      isNsfw: Boolean(data.over_18),
      isSpoiler: Boolean(data.spoiler),
      isStickied: Boolean(data.stickied),
      isLocked: Boolean(data.locked),
      isSelf: Boolean(data.is_self),
      isVideo: Boolean(data.is_video),
      domain: String(data.domain),
      flair: data.link_flair_text ? String(data.link_flair_text) : undefined,
      likes: data.likes === null ? null : Boolean(data.likes),
    };
  }

  /**
   * Parse raw subreddit data to Subreddit
   */
  private parseSubreddit(data: Record<string, unknown>): Subreddit {
    return {
      id: String(data.id),
      name: String(data.name),
      displayName: String(data.display_name),
      displayNamePrefixed: String(data.display_name_prefixed),
      title: String(data.title),
      publicDescription: data.public_description ? String(data.public_description) : undefined,
      description: data.description ? String(data.description) : undefined,
      subscribers: Number(data.subscribers),
      activeUserCount: data.active_user_count ? Number(data.active_user_count) : undefined,
      created: Number(data.created),
      createdUtc: Number(data.created_utc),
      url: String(data.url),
      isNsfw: Boolean(data.over18),
      subredditType: data.subreddit_type as Subreddit['subredditType'],
      userIsSubscriber: data.user_is_subscriber !== undefined ? Boolean(data.user_is_subscriber) : undefined,
      userIsModerator: data.user_is_moderator !== undefined ? Boolean(data.user_is_moderator) : undefined,
      iconImg: data.icon_img ? String(data.icon_img) : undefined,
      bannerImg: data.banner_img ? String(data.banner_img) : undefined,
    };
  }
}
