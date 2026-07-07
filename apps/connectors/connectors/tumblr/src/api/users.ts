import type { TumblrClient } from './client';
import type { PostType } from '../types';

export class UsersApi {
  constructor(private readonly client: TumblrClient) {}

  getInfo() {
    return this.client.request('/user/info');
  }

  getDashboard(options: {
    limit?: number;
    offset?: number;
    type?: PostType;
    sinceId?: number;
    reblogInfo?: boolean;
    notesInfo?: boolean;
  } = {}) {
    return this.client.request('/user/dashboard', {
      params: {
        limit: options.limit,
        offset: options.offset,
        type: options.type,
        since_id: options.sinceId,
        reblog_info: options.reblogInfo,
        notes_info: options.notesInfo,
      },
    });
  }

  getLikes(options: {
    limit?: number;
    offset?: number;
    before?: number;
    after?: number;
  } = {}) {
    return this.client.request('/user/likes', {
      params: {
        limit: options.limit,
        offset: options.offset,
        before: options.before,
        after: options.after,
      },
    });
  }

  getFollowing(options: { limit?: number; offset?: number } = {}) {
    return this.client.request('/user/following', {
      params: {
        limit: options.limit,
        offset: options.offset,
      },
    });
  }

  followBlog(url: string) {
    return this.client.request('/user/follow', {
      method: 'POST',
      body: { url },
    });
  }

  unfollowBlog(url: string) {
    return this.client.request('/user/unfollow', {
      method: 'POST',
      body: { url },
    });
  }

  likePost(id: string, reblogKey: string) {
    return this.client.request('/user/like', {
      method: 'POST',
      body: { id, reblog_key: reblogKey },
    });
  }

  unlikePost(id: string, reblogKey: string) {
    return this.client.request('/user/unlike', {
      method: 'POST',
      body: { id, reblog_key: reblogKey },
    });
  }
}
