import type { RedditClient } from './client';
import type { RedditUser, RedditPost, RedditComment, UserTrophies } from '../types';

interface UserResponse {
  kind: string;
  data: Record<string, unknown>;
}

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

interface TrophyResponse {
  kind: string;
  data: {
    trophies: {
      kind: string;
      data: {
        name: string;
        description?: string;
        award_id?: string;
        icon_40?: string;
        icon_70?: string;
        granted_at?: number;
      };
    }[];
  };
}

/**
 * Users API - get user info, karma, posts, comments
 */
export class UsersApi {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Get the current authenticated user
   */
  async getMe(): Promise<RedditUser> {
    const response = await this.client.request<Record<string, unknown>>('/api/v1/me', {
      params: { raw_json: 1 },
    });

    return this.parseUser(response);
  }

  /**
   * Get a user by username
   */
  async getUser(username: string): Promise<RedditUser> {
    const name = username.replace(/^u\//, '');

    const response = await this.client.request<UserResponse>(`/user/${name}/about`, {
      params: { raw_json: 1 },
    });

    return this.parseUser(response.data);
  }

  /**
   * Get user's trophies
   */
  async getTrophies(username: string): Promise<UserTrophies> {
    const name = username.replace(/^u\//, '');

    const response = await this.client.request<TrophyResponse>(`/user/${name}/trophies`, {
      params: { raw_json: 1 },
    });

    return {
      trophies: response.data.trophies.map(t => ({
        name: t.data.name,
        description: t.data.description,
        awardId: t.data.award_id,
        icon40: t.data.icon_40,
        icon70: t.data.icon_70,
        grantedAt: t.data.granted_at,
      })),
    };
  }

  /**
   * Get user's posts
   */
  async getPosts(
    username: string,
    options: {
      sort?: 'hot' | 'new' | 'top' | 'controversial';
      time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{ posts: RedditPost[]; after?: string }> {
    const { sort = 'new', time, limit = 25, after } = options;
    const name = username.replace(/^u\//, '');

    const response = await this.client.request<RedditListingResponse>(
      `/user/${name}/submitted`,
      {
        params: {
          sort,
          t: sort === 'top' || sort === 'controversial' ? time : undefined,
          limit,
          after,
          raw_json: 1,
        },
      }
    );

    const posts = response.data.children
      .filter(child => child.kind === 't3')
      .map(child => this.parsePost(child.data));

    return {
      posts,
      after: response.data.after || undefined,
    };
  }

  /**
   * Get user's comments
   */
  async getComments(
    username: string,
    options: {
      sort?: 'hot' | 'new' | 'top' | 'controversial';
      time?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{ comments: RedditComment[]; after?: string }> {
    const { sort = 'new', time, limit = 25, after } = options;
    const name = username.replace(/^u\//, '');

    const response = await this.client.request<RedditListingResponse>(
      `/user/${name}/comments`,
      {
        params: {
          sort,
          t: sort === 'top' || sort === 'controversial' ? time : undefined,
          limit,
          after,
          raw_json: 1,
        },
      }
    );

    const comments = response.data.children
      .filter(child => child.kind === 't1')
      .map(child => this.parseComment(child.data));

    return {
      comments,
      after: response.data.after || undefined,
    };
  }

  /**
   * Get user's saved items
   */
  async getSaved(
    options: {
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{ items: (RedditPost | RedditComment)[]; after?: string }> {
    const { limit = 25, after } = options;

    const me = await this.getMe();

    const response = await this.client.request<RedditListingResponse>(
      `/user/${me.name}/saved`,
      {
        params: {
          limit,
          after,
          raw_json: 1,
        },
      }
    );

    const items = response.data.children.map(child => {
      if (child.kind === 't3') {
        return this.parsePost(child.data);
      } else {
        return this.parseComment(child.data);
      }
    });

    return {
      items,
      after: response.data.after || undefined,
    };
  }

  /**
   * Get user's upvoted items (only works for authenticated user)
   */
  async getUpvoted(
    options: {
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{ items: (RedditPost | RedditComment)[]; after?: string }> {
    const { limit = 25, after } = options;

    const me = await this.getMe();

    const response = await this.client.request<RedditListingResponse>(
      `/user/${me.name}/upvoted`,
      {
        params: {
          limit,
          after,
          raw_json: 1,
        },
      }
    );

    const items = response.data.children.map(child => {
      if (child.kind === 't3') {
        return this.parsePost(child.data);
      } else {
        return this.parseComment(child.data);
      }
    });

    return {
      items,
      after: response.data.after || undefined,
    };
  }

  /**
   * Get user's downvoted items (only works for authenticated user)
   */
  async getDownvoted(
    options: {
      limit?: number;
      after?: string;
    } = {}
  ): Promise<{ items: (RedditPost | RedditComment)[]; after?: string }> {
    const { limit = 25, after } = options;

    const me = await this.getMe();

    const response = await this.client.request<RedditListingResponse>(
      `/user/${me.name}/downvoted`,
      {
        params: {
          limit,
          after,
          raw_json: 1,
        },
      }
    );

    const items = response.data.children.map(child => {
      if (child.kind === 't3') {
        return this.parsePost(child.data);
      } else {
        return this.parseComment(child.data);
      }
    });

    return {
      items,
      after: response.data.after || undefined,
    };
  }

  /**
   * Check if a username is available
   */
  async isUsernameAvailable(username: string): Promise<boolean> {
    const response = await this.client.request<boolean>('/api/username_available', {
      params: { user: username },
    });
    return response;
  }

  /**
   * Block a user
   */
  async blockUser(username: string): Promise<void> {
    const name = username.replace(/^u\//, '');

    await this.client.request('/api/block_user', {
      method: 'POST',
      body: { name },
      isFormData: true,
    });
  }

  /**
   * Get blocked users
   */
  async getBlocked(): Promise<string[]> {
    const response = await this.client.request<{
      data: {
        children: {
          name: string;
        }[];
      };
    }>('/prefs/blocked', {
      params: { raw_json: 1 },
    });

    return response.data.children.map(c => c.name);
  }

  /**
   * Parse raw user data to RedditUser
   */
  private parseUser(data: Record<string, unknown>): RedditUser {
    return {
      id: String(data.id),
      name: String(data.name),
      created: Number(data.created),
      createdUtc: Number(data.created_utc),
      linkKarma: Number(data.link_karma),
      commentKarma: Number(data.comment_karma),
      totalKarma: Number(data.total_karma || (Number(data.link_karma) + Number(data.comment_karma))),
      awardeeKarma: Number(data.awardee_karma || 0),
      awarderKarma: Number(data.awarder_karma || 0),
      iconImg: data.icon_img ? String(data.icon_img) : undefined,
      isGold: Boolean(data.is_gold),
      isMod: Boolean(data.is_mod),
      isEmployee: Boolean(data.is_employee),
      hasVerifiedEmail: Boolean(data.has_verified_email),
      subreddit: data.subreddit ? {
        displayName: String((data.subreddit as Record<string, unknown>).display_name),
        title: String((data.subreddit as Record<string, unknown>).title),
        publicDescription: String((data.subreddit as Record<string, unknown>).public_description),
        subscribers: Number((data.subreddit as Record<string, unknown>).subscribers),
      } : undefined,
    };
  }

  /**
   * Parse raw post data
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
      url: String(data.url),
      permalink: `https://reddit.com${data.permalink}`,
      score: Number(data.score),
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
    };
  }

  /**
   * Parse raw comment data
   */
  private parseComment(data: Record<string, unknown>): RedditComment {
    return {
      id: String(data.id),
      name: String(data.name),
      author: String(data.author),
      body: String(data.body),
      score: Number(data.score),
      created: Number(data.created),
      createdUtc: Number(data.created_utc),
      parentId: String(data.parent_id),
      linkId: String(data.link_id),
      subreddit: String(data.subreddit),
      isSubmitter: Boolean(data.is_submitter),
      edited: data.edited === false ? false : Number(data.edited),
      stickied: Boolean(data.stickied),
      scoreHidden: Boolean(data.score_hidden),
      depth: 0,
    };
  }
}
