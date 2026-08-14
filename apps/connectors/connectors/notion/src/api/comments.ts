import { NotionClient } from './client';
import type {
  NotionComment,
  PaginatedResponse,
  CreateCommentOptions,
  RichText,
} from '../types';

export class CommentsApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Retrieve comments for a block or page
   * https://developers.notion.com/reference/retrieve-a-comment
   */
  async list(
    blockId: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionComment>> {
    const params: Record<string, string | number | boolean | undefined> = {
      block_id: blockId,
    };
    if (startCursor) {
      params.start_cursor = startCursor;
    }
    if (pageSize) {
      params.page_size = pageSize;
    }

    return this.client.get<PaginatedResponse<NotionComment>>('/comments', params);
  }

  /**
   * Create a comment on a page
   * https://developers.notion.com/reference/create-a-comment
   */
  async create(options: CreateCommentOptions): Promise<NotionComment> {
    const body: Record<string, unknown> = {
      parent: options.parent,
      rich_text: options.rich_text,
    };

    if (options.discussion_id) {
      body.discussion_id = options.discussion_id;
    }

    return this.client.post<NotionComment>('/comments', body);
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Create a simple text comment on a page
   */
  async createSimple(pageId: string, text: string): Promise<NotionComment> {
    return this.create({
      parent: { page_id: pageId },
      rich_text: [
        {
          type: 'text',
          text: { content: text },
        },
      ],
    });
  }

  /**
   * Reply to an existing discussion
   */
  async reply(discussionId: string, pageId: string, text: string): Promise<NotionComment> {
    return this.create({
      parent: { page_id: pageId },
      discussion_id: discussionId,
      rich_text: [
        {
          type: 'text',
          text: { content: text },
        },
      ],
    });
  }

  /**
   * Get all comments for a block or page (handles pagination)
   */
  async listAll(blockId: string): Promise<NotionComment[]> {
    const allComments: NotionComment[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.list(blockId, cursor, 100);
      allComments.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return allComments;
  }

  /**
   * Get comments grouped by discussion
   */
  async listByDiscussion(blockId: string): Promise<Map<string, NotionComment[]>> {
    const allComments = await this.listAll(blockId);
    const discussions = new Map<string, NotionComment[]>();

    for (const comment of allComments) {
      const discussionId = comment.discussion_id;
      if (!discussions.has(discussionId)) {
        discussions.set(discussionId, []);
      }
      discussions.get(discussionId)!.push(comment);
    }

    return discussions;
  }

  /**
   * Get plain text content from a comment
   */
  getPlainText(comment: NotionComment): string {
    return comment.rich_text.map(rt => rt.plain_text).join('');
  }

  /**
   * Count comments on a block or page
   */
  async count(blockId: string): Promise<number> {
    const allComments = await this.listAll(blockId);
    return allComments.length;
  }

  /**
   * Count discussions on a block or page
   */
  async countDiscussions(blockId: string): Promise<number> {
    const discussions = await this.listByDiscussion(blockId);
    return discussions.size;
  }
}
