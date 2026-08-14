import type { SubstackConfig } from '../types';
import { SubstackClient } from './client';
import { PostsApi } from './posts';
import { SubscribersApi } from './subscribers';
import { CommentsApi } from './comments';
import { StatsApi } from './stats';
import { PublicationApi } from './publication';

/**
 * Main Substack Connector class
 * Provides access to Posts, Subscribers, Comments, Stats, and Publication APIs
 */
export class Substack {
  private readonly client: SubstackClient;

  // Service APIs
  public readonly posts: PostsApi;
  public readonly subscribers: SubscribersApi;
  public readonly comments: CommentsApi;
  public readonly stats: StatsApi;
  public readonly publication: PublicationApi;

  constructor(config: SubstackConfig) {
    this.client = new SubstackClient(config);
    this.posts = new PostsApi(this.client);
    this.subscribers = new SubscribersApi(this.client);
    this.comments = new CommentsApi(this.client);
    this.stats = new StatsApi(this.client);
    this.publication = new PublicationApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for SUBSTACK_SUBDOMAIN and SUBSTACK_TOKEN
   */
  static fromEnv(): Substack {
    const subdomain = process.env.SUBSTACK_SUBDOMAIN;
    const token = process.env.SUBSTACK_TOKEN;

    if (!subdomain) {
      throw new Error('SUBSTACK_SUBDOMAIN environment variable is required');
    }
    if (!token) {
      throw new Error('SUBSTACK_TOKEN environment variable is required');
    }

    return new Substack({ subdomain, token });
  }

  /**
   * Get a preview of the token (for debugging)
   */
  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  /**
   * Get the subdomain
   */
  getSubdomain(): string {
    return this.client.getSubdomain();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): SubstackClient {
    return this.client;
  }
}

export { SubstackClient } from './client';
export { PostsApi } from './posts';
export { SubscribersApi } from './subscribers';
export { CommentsApi } from './comments';
export { StatsApi } from './stats';
export { PublicationApi } from './publication';
