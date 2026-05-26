import type { RedditClient } from './client';
import type {
  RedditPost,
  SubmitPostOptions,
  SubmitPostResponse,
  FeedOptions,
  VoteDirection,
} from '../types';

interface RedditListingResponse {
  kind: string;
  data: {
    after: string | null;
    before: string | null;
    children: {
      kind: string;
      data: Record<string, unknown>;
    }[];
    dist: number;
  };
}

interface SubmitResponse {
  json: {
    errors: string[][];
    data?: {
      id: string;
      name: string;
      url: string;
    };
  };
}

/**
 * Posts API - submit, get, delete posts
 */
export class PostsApi {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Get posts from a subreddit feed
   */
  async getFeed(
    subreddit?: string,
    options: FeedOptions = {}
  ): Promise<{ posts: RedditPost[]; after?: string; before?: string }> {
    const { sort = 'hot', time, limit = 25, after, before } = options;

    const path = subreddit ? `/r/${subreddit}/${sort}` : `/${sort}`;

    const response = await this.client.request<RedditListingResponse>(path, {
      params: {
        t: sort === 'top' || sort === 'controversial' ? time : undefined,
        limit,
        after,
        before,
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
   * Get a single post by ID
   */
  async getPost(postId: string): Promise<{ post: RedditPost; comments: unknown[] }> {
    // Remove t3_ prefix if present
    const id = postId.replace(/^t3_/, '');

    const response = await this.client.request<RedditListingResponse[]>(`/comments/${id}`, {
      params: {
        raw_json: 1,
      },
    });

    const postListing = response[0];
    const postData = postListing.data.children[0];
    const post = this.parsePost(postData.data);

    // Comments are in the second listing
    const commentsListing = response[1];
    const comments = commentsListing.data.children;

    return { post, comments };
  }

  /**
   * Submit a new post
   */
  async submit(options: SubmitPostOptions): Promise<SubmitPostResponse> {
    const body: Record<string, unknown> = {
      sr: options.subreddit,
      title: options.title,
      kind: options.kind,
      api_type: 'json',
    };

    if (options.kind === 'self' && options.text) {
      body.text = options.text;
    } else if (options.kind === 'link' && options.url) {
      body.url = options.url;
    }

    if (options.nsfw) body.nsfw = true;
    if (options.spoiler) body.spoiler = true;
    if (options.flairId) body.flair_id = options.flairId;
    if (options.flairText) body.flair_text = options.flairText;
    if (options.sendReplies !== undefined) body.sendreplies = options.sendReplies;

    const response = await this.client.request<SubmitResponse>('/api/submit', {
      method: 'POST',
      body,
      isFormData: true,
    });

    if (response.json.errors && response.json.errors.length > 0) {
      throw new Error(response.json.errors.map(e => e.join(': ')).join('; '));
    }

    if (!response.json.data) {
      throw new Error('No data in submit response');
    }

    return {
      id: response.json.data.id,
      name: response.json.data.name,
      url: response.json.data.url,
    };
  }

  /**
   * Delete a post
   */
  async delete(postFullname: string): Promise<void> {
    // Ensure fullname format
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/del', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Edit a post's text
   */
  async edit(postFullname: string, text: string): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/editusertext', {
      method: 'POST',
      body: {
        thing_id: fullname,
        text,
        api_type: 'json',
      },
      isFormData: true,
    });
  }

  /**
   * Vote on a post
   */
  async vote(postFullname: string, direction: VoteDirection): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/vote', {
      method: 'POST',
      body: {
        id: fullname,
        dir: direction,
      },
      isFormData: true,
    });
  }

  /**
   * Upvote a post
   */
  async upvote(postFullname: string): Promise<void> {
    return this.vote(postFullname, 1);
  }

  /**
   * Downvote a post
   */
  async downvote(postFullname: string): Promise<void> {
    return this.vote(postFullname, -1);
  }

  /**
   * Remove vote from a post
   */
  async unvote(postFullname: string): Promise<void> {
    return this.vote(postFullname, 0);
  }

  /**
   * Save a post
   */
  async save(postFullname: string): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/save', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Unsave a post
   */
  async unsave(postFullname: string): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/unsave', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Hide a post
   */
  async hide(postFullname: string): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/hide', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Unhide a post
   */
  async unhide(postFullname: string): Promise<void> {
    const fullname = postFullname.startsWith('t3_') ? postFullname : `t3_${postFullname}`;

    await this.client.request('/api/unhide', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
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
}
