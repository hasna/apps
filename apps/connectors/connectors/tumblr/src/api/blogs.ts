import { blogPath } from './client';
import type { TumblrClient } from './client';
import type { AvatarSize } from '../types';

export class BlogsApi {
  constructor(private readonly client: TumblrClient) {}

  getInfo(blog: string) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/info`);
  }

  getAvatar(blog: string, size?: AvatarSize) {
    const path = blogPath(blog);
    const sizeSegment = size ? `/${size}` : '';
    return this.client.request(`/blog/${encodeURIComponent(path)}/avatar${sizeSegment}`);
  }

  getLikes(
    blog: string,
    options: {
      limit?: number;
      offset?: number;
      before?: number;
      after?: number;
    } = {},
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/likes`, {
      params: {
        limit: options.limit,
        offset: options.offset,
        before: options.before,
        after: options.after,
      },
    });
  }

  getFollowers(blog: string, options: { limit?: number; offset?: number } = {}) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/followers`, {
      params: {
        limit: options.limit,
        offset: options.offset,
      },
    });
  }

  getFollowing(blog: string, options: { limit?: number; offset?: number } = {}) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/following`, {
      params: {
        limit: options.limit,
        offset: options.offset,
      },
    });
  }
}
