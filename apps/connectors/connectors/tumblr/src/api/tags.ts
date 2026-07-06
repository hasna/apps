import type { TumblrClient } from './client';
import type { PostFilter } from '../types';

export class TagsApi {
  constructor(private readonly client: TumblrClient) {}

  searchByTag(
    tag: string,
    options: {
      before?: number;
      limit?: number;
      filter?: PostFilter;
    } = {},
  ) {
    return this.client.request('/tagged', {
      params: {
        tag,
        before: options.before,
        limit: options.limit,
        filter: options.filter,
      },
    });
  }
}
