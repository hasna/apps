import { NotionClient } from './client';
import type {
  NotionPage,
  PaginatedResponse,
  CreatePageOptions,
  UpdatePageOptions,
  PropertyValue,
  RichText,
} from '../types';

export class PagesApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Retrieve a page by ID
   * https://developers.notion.com/reference/retrieve-a-page
   */
  async get(pageId: string): Promise<NotionPage> {
    return this.client.get<NotionPage>(`/pages/${pageId}`);
  }

  /**
   * Retrieve a page property item
   * https://developers.notion.com/reference/retrieve-a-page-property-item
   */
  async getProperty(
    pageId: string,
    propertyId: string,
    startCursor?: string,
    pageSize?: number
  ): Promise<PropertyValue | PaginatedResponse<PropertyValue>> {
    const params: Record<string, string | number | boolean | undefined> = {};
    if (startCursor) {
      params.start_cursor = startCursor;
    }
    if (pageSize) {
      params.page_size = pageSize;
    }

    return this.client.get<PropertyValue | PaginatedResponse<PropertyValue>>(
      `/pages/${pageId}/properties/${propertyId}`,
      params
    );
  }

  /**
   * Create a page
   * https://developers.notion.com/reference/post-page
   */
  async create(options: CreatePageOptions): Promise<NotionPage> {
    const body: Record<string, unknown> = {
      parent: options.parent,
      properties: options.properties,
    };

    if (options.children) {
      body.children = options.children;
    }
    if (options.icon) {
      body.icon = options.icon;
    }
    if (options.cover) {
      body.cover = options.cover;
    }

    return this.client.post<NotionPage>('/pages', body);
  }

  /**
   * Update a page
   * https://developers.notion.com/reference/patch-page
   */
  async update(pageId: string, options: UpdatePageOptions): Promise<NotionPage> {
    const body: Record<string, unknown> = {};

    if (options.properties) {
      body.properties = options.properties;
    }
    if (options.archived !== undefined) {
      body.archived = options.archived;
    }
    if (options.icon !== undefined) {
      body.icon = options.icon;
    }
    if (options.cover !== undefined) {
      body.cover = options.cover;
    }

    return this.client.patch<NotionPage>(`/pages/${pageId}`, body);
  }

  /**
   * Archive (soft delete) a page
   */
  async archive(pageId: string): Promise<NotionPage> {
    return this.update(pageId, { archived: true });
  }

  /**
   * Unarchive a page
   */
  async unarchive(pageId: string): Promise<NotionPage> {
    return this.update(pageId, { archived: false });
  }

  /**
   * Delete a page (alias for archive)
   */
  async delete(pageId: string): Promise<NotionPage> {
    return this.archive(pageId);
  }

  /**
   * List all pages (via search)
   */
  async list(
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionPage>> {
    const body: Record<string, unknown> = {
      filter: {
        value: 'page',
        property: 'object',
      },
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }
    if (pageSize) {
      body.page_size = pageSize;
    }

    return this.client.post<PaginatedResponse<NotionPage>>('/search', body);
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Create a simple page with a title
   */
  async createSimple(
    parentPageId: string,
    title: string,
    content?: string
  ): Promise<NotionPage> {
    const titleRichText: RichText[] = [
      {
        type: 'text',
        text: { content: title, link: null },
        plain_text: title,
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

    const options: CreatePageOptions = {
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: titleRichText,
        },
      },
    };

    if (content) {
      options.children = [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content },
              },
            ],
          },
        },
      ];
    }

    return this.create(options);
  }

  /**
   * Create a page in a database
   */
  async createInDatabase(
    databaseId: string,
    properties: Record<string, unknown>,
    children?: unknown[]
  ): Promise<NotionPage> {
    return this.create({
      parent: { database_id: databaseId },
      properties,
      children,
    });
  }

  /**
   * Get page title (extracts from properties)
   */
  getTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === 'title') {
        const titleProp = prop as unknown as { title: RichText[] };
        return titleProp.title.map(t => t.plain_text).join('');
      }
    }
    return '';
  }

  /**
   * Update page title
   */
  async updateTitle(pageId: string, title: string): Promise<NotionPage> {
    const page = await this.get(pageId);
    const titlePropertyName = Object.entries(page.properties).find(
      ([, prop]) => prop.type === 'title'
    )?.[0];

    if (!titlePropertyName) {
      throw new Error('Page does not have a title property');
    }

    const titleRichText: RichText[] = [
      {
        type: 'text',
        text: { content: title, link: null },
        plain_text: title,
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

    return this.update(pageId, {
      properties: {
        [titlePropertyName]: {
          title: titleRichText,
        },
      },
    });
  }

  /**
   * Set page icon (emoji)
   */
  async setIcon(pageId: string, emoji: string): Promise<NotionPage> {
    return this.update(pageId, {
      icon: { type: 'emoji', emoji },
    });
  }

  /**
   * Set page cover (external URL)
   */
  async setCover(pageId: string, url: string): Promise<NotionPage> {
    return this.update(pageId, {
      cover: { type: 'external', external: { url } },
    });
  }

  /**
   * Remove page icon
   */
  async removeIcon(pageId: string): Promise<NotionPage> {
    return this.update(pageId, { icon: null });
  }

  /**
   * Remove page cover
   */
  async removeCover(pageId: string): Promise<NotionPage> {
    return this.update(pageId, { cover: null });
  }

  // ============================================
  // Property Update Methods
  // ============================================

  /**
   * Update a select property
   */
  async setSelect(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          select: { name: value },
        },
      },
    });
  }

  /**
   * Clear a select property
   */
  async clearSelect(pageId: string, propertyName: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          select: null,
        },
      },
    });
  }

  /**
   * Update a multi-select property
   */
  async setMultiSelect(pageId: string, propertyName: string, values: string[]): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          multi_select: values.map(name => ({ name })),
        },
      },
    });
  }

  /**
   * Update a status property
   */
  async setStatus(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          status: { name: value },
        },
      },
    });
  }

  /**
   * Update a checkbox property
   */
  async setCheckbox(pageId: string, propertyName: string, value: boolean): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          checkbox: value,
        },
      },
    });
  }

  /**
   * Update a number property
   */
  async setNumber(pageId: string, propertyName: string, value: number): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          number: value,
        },
      },
    });
  }

  /**
   * Update a URL property
   */
  async setUrl(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          url: value,
        },
      },
    });
  }

  /**
   * Update an email property
   */
  async setEmail(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          email: value,
        },
      },
    });
  }

  /**
   * Update a phone number property
   */
  async setPhone(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          phone_number: value,
        },
      },
    });
  }

  /**
   * Update a rich text property
   */
  async setRichText(pageId: string, propertyName: string, value: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          rich_text: [
            {
              type: 'text',
              text: { content: value },
            },
          ],
        },
      },
    });
  }

  /**
   * Update a date property
   */
  async setDate(pageId: string, propertyName: string, start: string, end?: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          date: { start, end: end || null },
        },
      },
    });
  }

  /**
   * Clear a date property
   */
  async clearDate(pageId: string, propertyName: string): Promise<NotionPage> {
    return this.update(pageId, {
      properties: {
        [propertyName]: {
          date: null,
        },
      },
    });
  }

  /**
   * Update multiple properties at once
   */
  async setProperties(pageId: string, properties: Record<string, unknown>): Promise<NotionPage> {
    return this.update(pageId, { properties });
  }
}
