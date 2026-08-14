import type { SubstackClient } from './client';
import type {
  Post,
  PostListResponse,
  CreatePostRequest,
  PublishPostRequest,
} from '../types';

/**
 * Posts API
 * Manage Substack posts - list, get, create, publish
 */
export class PostsApi {
  constructor(private readonly client: SubstackClient) {}

  /**
   * List posts from the publication
   * @param options - Filter options
   */
  async list(options: {
    offset?: number;
    limit?: number;
    type?: 'newsletter' | 'podcast' | 'thread';
    drafts?: boolean;
  } = {}): Promise<PostListResponse> {
    const { offset = 0, limit = 25, type, drafts = false } = options;

    const params: Record<string, string | number | boolean | undefined> = {
      offset,
      limit,
    };

    if (type) {
      params.type = type;
    }

    // Use different endpoint for drafts
    const path = drafts ? '/drafts' : '/posts';

    const response = await this.client.request<Post[] | PostListResponse>(path, { params });

    // Handle both array and object responses
    if (Array.isArray(response)) {
      return {
        posts: response,
        more: response.length === limit,
        offset,
        limit,
      };
    }

    return response;
  }

  /**
   * Get a single post by ID or slug
   */
  async get(postIdOrSlug: string | number): Promise<Post> {
    const path = typeof postIdOrSlug === 'number'
      ? `/posts/${postIdOrSlug}`
      : `/posts/slug/${postIdOrSlug}`;

    return this.client.request<Post>(path);
  }

  /**
   * Get a draft by ID
   */
  async getDraft(draftId: number): Promise<Post> {
    return this.client.request<Post>(`/drafts/${draftId}`);
  }

  /**
   * Create a new draft post
   */
  async create(post: CreatePostRequest): Promise<Post> {
    const body = {
      title: post.title,
      subtitle: post.subtitle,
      body_markdown: post.body_markdown,
      body_html: post.body_html,
      audience: post.audience || 'everyone',
      type: post.type || 'newsletter',
      draft: post.draft !== false, // Default to creating as draft
      section_id: post.section_id,
    };

    return this.client.request<Post>('/drafts', {
      method: 'POST',
      body,
    });
  }

  /**
   * Update a draft
   */
  async update(draftId: number, updates: Partial<CreatePostRequest>): Promise<Post> {
    return this.client.request<Post>(`/drafts/${draftId}`, {
      method: 'PUT',
      body: updates,
    });
  }

  /**
   * Publish a draft
   * @param draftId - The draft ID to publish
   * @param options - Publish options
   */
  async publish(draftId: number, options: PublishPostRequest = {}): Promise<Post> {
    const { send = false } = options;

    return this.client.request<Post>(`/drafts/${draftId}/publish`, {
      method: 'POST',
      body: { send },
    });
  }

  /**
   * Delete a draft
   */
  async deleteDraft(draftId: number): Promise<void> {
    await this.client.request<void>(`/drafts/${draftId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Unpublish a post (convert back to draft)
   */
  async unpublish(postId: number): Promise<Post> {
    return this.client.request<Post>(`/posts/${postId}/unpublish`, {
      method: 'POST',
    });
  }
}
