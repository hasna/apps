import type { RedditClient } from './client';
import type { RedditComment, SubmitCommentOptions, VoteDirection } from '../types';

interface CommentResponse {
  json: {
    errors: string[][];
    data?: {
      things: {
        kind: string;
        data: Record<string, unknown>;
      }[];
    };
  };
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

/**
 * Comments API - post, get, delete comments
 */
export class CommentsApi {
  private readonly client: RedditClient;

  constructor(client: RedditClient) {
    this.client = client;
  }

  /**
   * Submit a new comment
   */
  async submit(options: SubmitCommentOptions): Promise<RedditComment> {
    const response = await this.client.request<CommentResponse>('/api/comment', {
      method: 'POST',
      body: {
        thing_id: options.parentFullname,
        text: options.text,
        api_type: 'json',
      },
      isFormData: true,
    });

    if (response.json.errors && response.json.errors.length > 0) {
      throw new Error(response.json.errors.map(e => e.join(': ')).join('; '));
    }

    if (!response.json.data?.things?.[0]) {
      throw new Error('No comment data in response');
    }

    return this.parseComment(response.json.data.things[0].data);
  }

  /**
   * Get comments for a post
   */
  async getForPost(
    postId: string,
    options: {
      sort?: 'confidence' | 'top' | 'new' | 'controversial' | 'old' | 'random' | 'qa';
      limit?: number;
      depth?: number;
    } = {}
  ): Promise<RedditComment[]> {
    const { sort = 'confidence', limit = 100, depth = 10 } = options;
    const id = postId.replace(/^t3_/, '');

    const response = await this.client.request<RedditListingResponse[]>(`/comments/${id}`, {
      params: {
        sort,
        limit,
        depth,
        raw_json: 1,
      },
    });

    // Comments are in the second listing
    const commentsListing = response[1];
    return this.parseCommentTree(commentsListing.data.children);
  }

  /**
   * Get a specific comment by ID
   */
  async getComment(commentId: string, postId: string): Promise<RedditComment> {
    const cid = commentId.replace(/^t1_/, '');
    const pid = postId.replace(/^t3_/, '');

    const response = await this.client.request<RedditListingResponse[]>(`/comments/${pid}`, {
      params: {
        comment: cid,
        context: 0,
        raw_json: 1,
      },
    });

    const commentsListing = response[1];
    if (commentsListing.data.children.length === 0) {
      throw new Error('Comment not found');
    }

    return this.parseComment(commentsListing.data.children[0].data);
  }

  /**
   * Edit a comment
   */
  async edit(commentFullname: string, text: string): Promise<void> {
    const fullname = commentFullname.startsWith('t1_') ? commentFullname : `t1_${commentFullname}`;

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
   * Delete a comment
   */
  async delete(commentFullname: string): Promise<void> {
    const fullname = commentFullname.startsWith('t1_') ? commentFullname : `t1_${commentFullname}`;

    await this.client.request('/api/del', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Vote on a comment
   */
  async vote(commentFullname: string, direction: VoteDirection): Promise<void> {
    const fullname = commentFullname.startsWith('t1_') ? commentFullname : `t1_${commentFullname}`;

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
   * Upvote a comment
   */
  async upvote(commentFullname: string): Promise<void> {
    return this.vote(commentFullname, 1);
  }

  /**
   * Downvote a comment
   */
  async downvote(commentFullname: string): Promise<void> {
    return this.vote(commentFullname, -1);
  }

  /**
   * Remove vote from a comment
   */
  async unvote(commentFullname: string): Promise<void> {
    return this.vote(commentFullname, 0);
  }

  /**
   * Save a comment
   */
  async save(commentFullname: string): Promise<void> {
    const fullname = commentFullname.startsWith('t1_') ? commentFullname : `t1_${commentFullname}`;

    await this.client.request('/api/save', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Unsave a comment
   */
  async unsave(commentFullname: string): Promise<void> {
    const fullname = commentFullname.startsWith('t1_') ? commentFullname : `t1_${commentFullname}`;

    await this.client.request('/api/unsave', {
      method: 'POST',
      body: { id: fullname },
      isFormData: true,
    });
  }

  /**
   * Parse raw comment data to RedditComment
   */
  private parseComment(data: Record<string, unknown>, depth = 0): RedditComment {
    return {
      id: String(data.id),
      name: String(data.name),
      author: String(data.author),
      body: String(data.body),
      bodyHtml: data.body_html ? String(data.body_html) : undefined,
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
      depth,
      likes: data.likes === null ? null : Boolean(data.likes),
      replies: data.replies && typeof data.replies === 'object'
        ? this.parseCommentReplies(data.replies as Record<string, unknown>, depth + 1)
        : undefined,
    };
  }

  /**
   * Parse comment replies
   */
  private parseCommentReplies(
    repliesData: Record<string, unknown>,
    depth: number
  ): RedditComment[] | undefined {
    if (!repliesData || repliesData.kind !== 'Listing') {
      return undefined;
    }

    const data = repliesData.data as {
      children: { kind: string; data: Record<string, unknown> }[];
    };

    if (!data.children || data.children.length === 0) {
      return undefined;
    }

    return this.parseCommentTree(data.children, depth);
  }

  /**
   * Parse a tree of comments
   */
  private parseCommentTree(
    children: { kind: string; data: Record<string, unknown> }[],
    depth = 0
  ): RedditComment[] {
    return children
      .filter(child => child.kind === 't1')
      .map(child => this.parseComment(child.data, depth));
  }
}
