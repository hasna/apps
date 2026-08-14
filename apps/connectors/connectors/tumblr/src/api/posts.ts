import { blogPath } from './client';
import type { TumblrClient } from './client';
import type { NotesMode, PostFilter, PostState } from '../types';

export class PostsApi {
  constructor(private readonly client: TumblrClient) {}

  list(
    blog: string,
    options: {
      type?: string;
      id?: string;
      tag?: string;
      limit?: number;
      offset?: number;
      reblogInfo?: boolean;
      notesInfo?: boolean;
      filter?: PostFilter;
      before?: number;
    } = {},
  ) {
    const path = blogPath(blog);
    const typeSegment = options.type ? `/${encodeURIComponent(options.type)}` : '';
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts${typeSegment}`, {
      params: {
        id: options.id,
        tag: options.tag,
        limit: options.limit,
        offset: options.offset,
        reblog_info: options.reblogInfo,
        notes_info: options.notesInfo,
        filter: options.filter,
        before: options.before,
      },
    });
  }

  listDrafts(
    blog: string,
    options: { beforeId?: string; filter?: PostFilter } = {},
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts/draft`, {
      params: {
        before_id: options.beforeId,
        filter: options.filter,
      },
    });
  }

  listQueued(
    blog: string,
    options: { offset?: number; limit?: number; filter?: PostFilter } = {},
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts/queue`, {
      params: {
        offset: options.offset,
        limit: options.limit,
        filter: options.filter,
      },
    });
  }

  listSubmissions(
    blog: string,
    options: { offset?: number; filter?: PostFilter } = {},
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts/submission`, {
      params: {
        offset: options.offset,
        filter: options.filter,
      },
    });
  }

  create(
    blog: string,
    options: {
      content: Array<Record<string, unknown>>;
      layout?: Array<Record<string, unknown>>;
      state?: PostState;
      publishOn?: string;
      date?: string;
      tags?: string[];
      sourceUrl?: string;
      sendToTwitter?: boolean;
      interactabilityReblog?: 'everyone' | 'noone';
      slug?: string;
    },
  ) {
    if (!options.content?.length) {
      throw new Error('content is required');
    }
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts`, {
      method: 'POST',
      body: {
        content: options.content,
        layout: options.layout,
        state: options.state,
        publish_on: options.publishOn,
        date: options.date,
        tags: options.tags?.join(','),
        source_url: options.sourceUrl,
        send_to_twitter: options.sendToTwitter,
        interactability_reblog: options.interactabilityReblog,
        slug: options.slug,
      },
    });
  }

  update(
    blog: string,
    postId: string,
    options: {
      content?: Array<Record<string, unknown>>;
      layout?: Array<Record<string, unknown>>;
      state?: PostState;
      tags?: string[];
      sourceUrl?: string;
    },
  ) {
    const path = blogPath(blog);
    const body: Record<string, unknown> = {};
    if (options.content) body.content = options.content;
    if (options.layout) body.layout = options.layout;
    if (options.state) body.state = options.state;
    if (options.tags) body.tags = options.tags.join(',');
    if (options.sourceUrl) body.source_url = options.sourceUrl;

    if (Object.keys(body).length === 0) {
      throw new Error('At least one update field is required');
    }

    return this.client.request(
      `/blog/${encodeURIComponent(path)}/posts/${encodeURIComponent(postId)}`,
      { method: 'PUT', body },
    );
  }

  delete(blog: string, id: string) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/post/delete`, {
      method: 'POST',
      body: { id },
    });
  }

  reblog(
    blog: string,
    options: {
      id: string;
      reblogKey: string;
      comment?: string;
      nativeInlineImages?: boolean;
      tags?: string[];
      state?: PostState;
    },
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/post/reblog`, {
      method: 'POST',
      body: {
        id: options.id,
        reblog_key: options.reblogKey,
        comment: options.comment,
        native_inline_images: options.nativeInlineImages,
        tags: options.tags?.join(','),
        state: options.state,
      },
    });
  }

  getNotes(
    blog: string,
    options: {
      id: string;
      beforeTimestamp?: number;
      mode?: NotesMode;
    },
  ) {
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/notes`, {
      params: {
        id: options.id,
        before_timestamp: options.beforeTimestamp,
        mode: options.mode,
      },
    });
  }

  getByIds(blog: string, ids: string[]) {
    if (!ids.length) {
      throw new Error('ids is required');
    }
    const path = blogPath(blog);
    return this.client.request(`/blog/${encodeURIComponent(path)}/posts`, {
      params: { id: ids.join(',') },
    });
  }
}
