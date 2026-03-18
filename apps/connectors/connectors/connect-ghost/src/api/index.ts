// Ghost Connector — Headless CMS and publishing platform
import { GhostClient } from './client';
import type { GhostConfig, GhostPost, GhostPostList, GhostPage, GhostTag, GhostAuthor, GhostMember } from '../types';
export { GhostClient } from './client';

export class Ghost {
  private readonly client: GhostClient;
  constructor(config: GhostConfig) { this.client = new GhostClient(config); }
  static fromEnv(): Ghost {
    const url = process.env.GHOST_URL;
    if (!url) throw new Error('GHOST_URL is required');
    return new Ghost({ url, adminApiKey: process.env.GHOST_ADMIN_API_KEY, contentApiKey: process.env.GHOST_CONTENT_API_KEY });
  }

  // Content API (public, read-only)
  async listPosts(options?: { page?: number; limit?: number; filter?: string; include?: string }): Promise<GhostPostList> {
    return this.client.contentRequest<GhostPostList>('/posts/', { page: options?.page, limit: options?.limit, filter: options?.filter, include: options?.include });
  }
  async getPost(idOrSlug: string, options?: { include?: string }): Promise<{ posts: GhostPost[] }> {
    return this.client.contentRequest(`/posts/slug/${idOrSlug}/`, { include: options?.include });
  }
  async listTags(options?: { limit?: number; include?: string }): Promise<{ tags: GhostTag[] }> {
    return this.client.contentRequest('/tags/', { limit: options?.limit, include: options?.include });
  }
  async listAuthors(options?: { limit?: number }): Promise<{ authors: GhostAuthor[] }> {
    return this.client.contentRequest('/authors/', { limit: options?.limit });
  }
  async listPages(options?: { page?: number; limit?: number }): Promise<{ pages: GhostPage[] }> {
    return this.client.contentRequest('/pages/', { page: options?.page, limit: options?.limit });
  }

  // Admin API (authenticated, read-write)
  async createPost(data: { title: string; html?: string; status?: string; tags?: { name: string }[]; featured?: boolean }): Promise<{ posts: GhostPost[] }> {
    return this.client.adminRequest('/posts/', { method: 'POST', body: { posts: [data] } });
  }
  async updatePost(postId: string, data: { title?: string; html?: string; status?: string; updated_at: string }): Promise<{ posts: GhostPost[] }> {
    return this.client.adminRequest(`/posts/${postId}/`, { method: 'PUT', body: { posts: [data] } });
  }
  async deletePost(postId: string): Promise<void> { await this.client.adminRequest(`/posts/${postId}/`, { method: 'DELETE' }); }

  async listMembers(options?: { page?: number; limit?: number; filter?: string }): Promise<{ members: GhostMember[]; meta: Record<string, unknown> }> {
    return this.client.adminRequest('/members/', { params: { page: options?.page, limit: options?.limit, filter: options?.filter } });
  }

  getClient(): GhostClient { return this.client; }
}
