import type { RedditClient } from './client';
import type { Subreddit, SubredditRules } from '../types';

interface RedditListingResponse {
  kind: string;
  data: {
    after: string | null;
    before: string | null;
    children: {
      kind: string;
      data: Record<string, unknown>;
    }[];
    dist?: number;
  };
}

interface SubredditResponse {
  kind: string;
  data: Record<string, unknown>;
}

interface RulesResponse {
  rules: {
    kind: string;
    short_name: string;
    description: string;
    violation_reason: string;
    created_utc: number;
    priority: number;
  }[];
  site_rules: string[];
}

/**
 * Subreddits API - list, search, subscribe
 */
export class SubredditsApi {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Get subreddit info
   */
  async getSubreddit(subredditName: string): Promise<Subreddit> {
    const name = subredditName.replace(/^r\//, '');

    const response = await this.client.request<SubredditResponse>(`/r/${name}/about`, {
      params: { raw_json: 1 },
    });

    return this.parseSubreddit(response.data);
  }

  /**
   * Get subreddit rules
   */
  async getRules(subredditName: string): Promise<SubredditRules> {
    const name = subredditName.replace(/^r\//, '');

    const response = await this.client.request<RulesResponse>(`/r/${name}/about/rules`, {
      params: { raw_json: 1 },
    });

    return {
      subreddit: name,
      rules: response.rules.map(rule => ({
        kind: rule.kind,
        shortName: rule.short_name,
        description: rule.description,
        violationReason: rule.violation_reason,
        createdUtc: rule.created_utc,
        priority: rule.priority,
      })),
    };
  }

  /**
   * Search for subreddits
   */
  async search(
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
   * Get popular subreddits
   */
  async getPopular(
    options: { limit?: number; after?: string } = {}
  ): Promise<{ subreddits: Subreddit[]; after?: string }> {
    const { limit = 25, after } = options;

    const response = await this.client.request<RedditListingResponse>('/subreddits/popular', {
      params: {
        limit,
        after,
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
   * Get new subreddits
   */
  async getNew(
    options: { limit?: number; after?: string } = {}
  ): Promise<{ subreddits: Subreddit[]; after?: string }> {
    const { limit = 25, after } = options;

    const response = await this.client.request<RedditListingResponse>('/subreddits/new', {
      params: {
        limit,
        after,
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
   * Get user's subscribed subreddits
   */
  async getSubscribed(
    options: { limit?: number; after?: string } = {}
  ): Promise<{ subreddits: Subreddit[]; after?: string }> {
    const { limit = 25, after } = options;

    const response = await this.client.request<RedditListingResponse>('/subreddits/mine/subscriber', {
      params: {
        limit,
        after,
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
   * Subscribe to a subreddit
   */
  async subscribe(subredditName: string): Promise<void> {
    const name = subredditName.replace(/^r\//, '');

    await this.client.request('/api/subscribe', {
      method: 'POST',
      body: {
        sr_name: name,
        action: 'sub',
      },
      isFormData: true,
    });
  }

  /**
   * Unsubscribe from a subreddit
   */
  async unsubscribe(subredditName: string): Promise<void> {
    const name = subredditName.replace(/^r\//, '');

    await this.client.request('/api/subscribe', {
      method: 'POST',
      body: {
        sr_name: name,
        action: 'unsub',
      },
      isFormData: true,
    });
  }

  /**
   * Get subreddit wiki page
   */
  async getWikiPage(subredditName: string, page = 'index'): Promise<{
    content: string;
    revisionId: string;
    revisionDate: number;
    revisionBy: string;
  }> {
    const name = subredditName.replace(/^r\//, '');

    const response = await this.client.request<{
      kind: string;
      data: {
        content_md: string;
        revision_id: string;
        revision_date: number;
        revision_by: { data: { name: string } };
      };
    }>(`/r/${name}/wiki/${page}`, {
      params: { raw_json: 1 },
    });

    return {
      content: response.data.content_md,
      revisionId: response.data.revision_id,
      revisionDate: response.data.revision_date,
      revisionBy: response.data.revision_by.data.name,
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
