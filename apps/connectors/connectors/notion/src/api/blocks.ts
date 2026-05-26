import { NotionClient } from './client';
import type {
  NotionBlock,
  PaginatedResponse,
  CreateBlockOptions,
  UpdateBlockOptions,
  RichText,
} from '../types';

export class BlocksApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Retrieve a block by ID
   * https://developers.notion.com/reference/retrieve-a-block
   */
  async get(blockId: string): Promise<NotionBlock> {
    return this.client.get<NotionBlock>(`/blocks/${blockId}`);
  }

  /**
   * Retrieve block children
   * https://developers.notion.com/reference/get-block-children
   */
  async getChildren(
    blockId: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionBlock>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (startCursor) {
      params.start_cursor = startCursor;
    }
    if (pageSize) {
      params.page_size = pageSize;
    }

    return this.client.get<PaginatedResponse<NotionBlock>>(
      `/blocks/${blockId}/children`,
      params
    );
  }

  /**
   * Append block children
   * https://developers.notion.com/reference/patch-block-children
   */
  async appendChildren(
    blockId: string,
    children: CreateBlockOptions[],
    after?: string
  ): Promise<PaginatedResponse<NotionBlock>> {
    const body: Record<string, unknown> = {
      children,
    };

    if (after) {
      body.after = after;
    }

    return this.client.patch<PaginatedResponse<NotionBlock>>(
      `/blocks/${blockId}/children`,
      body
    );
  }

  /**
   * Update a block
   * https://developers.notion.com/reference/update-a-block
   */
  async update(blockId: string, options: UpdateBlockOptions): Promise<NotionBlock> {
    return this.client.patch<NotionBlock>(`/blocks/${blockId}`, options as Record<string, unknown>);
  }

  /**
   * Delete a block (archive)
   * https://developers.notion.com/reference/delete-a-block
   */
  async delete(blockId: string): Promise<NotionBlock> {
    return this.client.delete<NotionBlock>(`/blocks/${blockId}`);
  }

  /**
   * Archive a block (alias for delete)
   */
  async archive(blockId: string): Promise<NotionBlock> {
    return this.update(blockId, { archived: true });
  }

  /**
   * Unarchive a block
   */
  async unarchive(blockId: string): Promise<NotionBlock> {
    return this.update(blockId, { archived: false });
  }

  // ============================================
  // Helper Methods - List blocks (alias for getChildren)
  // ============================================

  /**
   * List all children of a block/page
   */
  async list(
    blockId: string,
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionBlock>> {
    return this.getChildren(blockId, startCursor, pageSize);
  }

  /**
   * Get all children (handles pagination)
   */
  async getAllChildren(blockId: string): Promise<NotionBlock[]> {
    const allBlocks: NotionBlock[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.getChildren(blockId, cursor, 100);
      allBlocks.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return allBlocks;
  }

  // ============================================
  // Helper Methods - Create specific block types
  // ============================================

  private createRichText(content: string): RichText[] {
    return [
      {
        type: 'text',
        text: { content, link: null },
        plain_text: content,
        href: null,
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: 'default',
        },
      },
    ];
  }

  /**
   * Append a paragraph block
   */
  async appendParagraph(
    blockId: string,
    content: string,
    color: string = 'default'
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'paragraph',
        paragraph: {
          rich_text: this.createRichText(content),
          color,
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a heading block
   */
  async appendHeading(
    blockId: string,
    level: 1 | 2 | 3,
    content: string,
    isToggleable: boolean = false
  ): Promise<NotionBlock> {
    const type = `heading_${level}` as const;
    const response = await this.appendChildren(blockId, [
      {
        type,
        [type]: {
          rich_text: this.createRichText(content),
          color: 'default',
          is_toggleable: isToggleable,
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a bulleted list item
   */
  async appendBulletedListItem(
    blockId: string,
    content: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: this.createRichText(content),
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a numbered list item
   */
  async appendNumberedListItem(
    blockId: string,
    content: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: this.createRichText(content),
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a to-do block
   */
  async appendToDo(
    blockId: string,
    content: string,
    checked: boolean = false
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'to_do',
        to_do: {
          rich_text: this.createRichText(content),
          checked,
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a code block
   */
  async appendCode(
    blockId: string,
    content: string,
    language: string = 'plain text'
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'code',
        code: {
          rich_text: this.createRichText(content),
          caption: [],
          language,
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a quote block
   */
  async appendQuote(
    blockId: string,
    content: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'quote',
        quote: {
          rich_text: this.createRichText(content),
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a callout block
   */
  async appendCallout(
    blockId: string,
    content: string,
    emoji: string = 'bulb'
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'callout',
        callout: {
          rich_text: this.createRichText(content),
          icon: { type: 'emoji', emoji },
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a divider block
   */
  async appendDivider(blockId: string): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'divider',
        divider: {},
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a toggle block
   */
  async appendToggle(
    blockId: string,
    content: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'toggle',
        toggle: {
          rich_text: this.createRichText(content),
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a bookmark block
   */
  async appendBookmark(
    blockId: string,
    url: string,
    caption?: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'bookmark',
        bookmark: {
          url,
          caption: caption ? this.createRichText(caption) : [],
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append an embed block
   */
  async appendEmbed(
    blockId: string,
    url: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'embed',
        embed: {
          url,
          caption: [],
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append an image block (external URL)
   */
  async appendImage(
    blockId: string,
    url: string,
    caption?: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'image',
        image: {
          type: 'external',
          external: { url },
          caption: caption ? this.createRichText(caption) : [],
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a video block (external URL)
   */
  async appendVideo(
    blockId: string,
    url: string,
    caption?: string
  ): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'video',
        video: {
          type: 'external',
          external: { url },
          caption: caption ? this.createRichText(caption) : [],
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Append a table of contents block
   */
  async appendTableOfContents(blockId: string): Promise<NotionBlock> {
    const response = await this.appendChildren(blockId, [
      {
        type: 'table_of_contents',
        table_of_contents: {
          color: 'default',
        },
      },
    ]);
    return response.results[0]!;
  }

  /**
   * Update paragraph content
   */
  async updateParagraph(blockId: string, content: string): Promise<NotionBlock> {
    return this.update(blockId, {
      paragraph: {
        rich_text: this.createRichText(content),
      },
    });
  }

  /**
   * Update to-do checked state
   */
  async updateToDoChecked(blockId: string, checked: boolean): Promise<NotionBlock> {
    return this.update(blockId, {
      to_do: {
        checked,
      },
    });
  }
}
