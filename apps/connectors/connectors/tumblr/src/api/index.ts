import type { TumblrConfig } from '../types';
import { TumblrClient } from './client';
import { UsersApi } from './users';
import { BlogsApi } from './blogs';
import { PostsApi } from './posts';
import { TagsApi } from './tags';
import { exchangeCode, getAuthorizationUrl } from '../utils/auth';

export class Tumblr {
  private readonly client: TumblrClient;

  public readonly users: UsersApi;
  public readonly blogs: BlogsApi;
  public readonly posts: PostsApi;
  public readonly tags: TagsApi;

  constructor(config: TumblrConfig) {
    this.client = new TumblrClient(config);
    this.users = new UsersApi(this.client);
    this.blogs = new BlogsApi(this.client);
    this.posts = new PostsApi(this.client);
    this.tags = new TagsApi(this.client);
  }

  static fromEnv(): Tumblr {
    const accessToken = process.env.TUMBLR_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('TUMBLR_ACCESS_TOKEN environment variable is required');
    }

    return new Tumblr({
      accessToken,
      clientId: process.env.TUMBLR_CLIENT_ID,
      clientSecret: process.env.TUMBLR_CLIENT_SECRET,
      refreshToken: process.env.TUMBLR_REFRESH_TOKEN,
    });
  }

  getClient(): TumblrClient {
    return this.client;
  }

  static getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    scope: string[],
    state: string,
  ): string {
    return getAuthorizationUrl(clientId, redirectUri, scope, state);
  }

  static async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scope?: string;
  }> {
    const response = await exchangeCode(clientId, clientSecret, code, redirectUri);
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresIn: response.expires_in,
      scope: response.scope,
    };
  }
}

export { TumblrClient, blogPath, TUMBLR_API_BASE } from './client';
export { UsersApi } from './users';
export { BlogsApi } from './blogs';
export { PostsApi } from './posts';
export { TagsApi } from './tags';
