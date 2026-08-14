import { NotionClient } from './client';
import { PagesApi } from './pages';
import { DatabasesApi } from './databases';
import type { NotionPage, NotionDatabase, DatabaseQueryFilter } from '../types';

// ============================================
// Filter Parser Types
// ============================================

export type FilterOperator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'contains' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty';

export interface ParsedFilter {
  property: string;
  operator: FilterOperator;
  value: string;
}

export interface ParsedPropertyUpdate {
  property: string;
  value: string;
}

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkUpdateOptions {
  /** Database ID to query pages from */
  databaseId?: string;
  /** Simple filter string like "Type=App" or "Status!=Done" */
  where?: string;
  /** Raw Notion filter object */
  filter?: DatabaseQueryFilter;
  /** Page IDs to update directly */
  pageIds?: string[];
  /** Property updates to apply */
  updates: ParsedPropertyUpdate[];
  /** Maximum concurrent API calls (default: 3) */
  concurrency?: number;
  /** Dry run - don't actually update */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, page: NotionPage) => void;
  /** Error callback */
  onError?: (error: Error, page: NotionPage) => void;
}

export interface BulkUpdateResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ pageId: string; error: string }>;
  updatedPages: NotionPage[];
}

// ============================================
// Filter Parser
// ============================================

export class FilterParser {
  /**
   * Parse a simple filter string into a Notion filter object
   * Supports: Property=Value, Property!=Value, Property>Value, etc.
   * Multiple conditions with & (AND) or | (OR)
   * Type hints: Property:type=Value (e.g., Status:status=Done)
   */
  static parse(filterString: string, schema?: Record<string, { type: string }>): DatabaseQueryFilter {
    // Handle OR conditions
    if (filterString.includes('|')) {
      const parts = filterString.split('|').map(p => p.trim());
      return {
        or: parts.map(part => this.parseSingleCondition(part, schema)),
      };
    }

    // Handle AND conditions
    if (filterString.includes('&')) {
      const parts = filterString.split('&').map(p => p.trim());
      return {
        and: parts.map(part => this.parseSingleCondition(part, schema)),
      };
    }

    // Single condition
    return this.parseSingleCondition(filterString, schema);
  }

  /**
   * Parse a single filter condition
   */
  private static parseSingleCondition(
    condition: string,
    schema?: Record<string, { type: string }>
  ): DatabaseQueryFilter {
    // Try different operators in order of specificity
    const operators: Array<{ op: string; notionOp: string }> = [
      { op: '!=', notionOp: 'does_not_equal' },
      { op: '>=', notionOp: 'greater_than_or_equal_to' },
      { op: '<=', notionOp: 'less_than_or_equal_to' },
      { op: '>', notionOp: 'greater_than' },
      { op: '<', notionOp: 'less_than' },
      { op: '=', notionOp: 'equals' },
    ];

    for (const { op, notionOp } of operators) {
      const idx = condition.indexOf(op);
      if (idx !== -1) {
        let property = condition.substring(0, idx).trim();
        const value = condition.substring(idx + op.length).trim();

        // Check for type hint (Property:type)
        let typeHint: string | undefined;
        const colonIdx = property.indexOf(':');
        if (colonIdx !== -1) {
          typeHint = property.substring(colonIdx + 1);
          property = property.substring(0, colonIdx);
        }

        // Get type from schema if available
        const schemaType = schema?.[property]?.type;
        const propertyType = typeHint || schemaType;

        return this.buildFilter(property, notionOp, value, propertyType);
      }
    }

    throw new Error(`Invalid filter condition: ${condition}`);
  }

  /**
   * Build a Notion filter object for a property
   * Uses property type from schema or type hint when available
   */
  private static buildFilter(
    property: string,
    operator: string,
    value: string,
    propertyType?: string
  ): DatabaseQueryFilter {
    // If we know the property type, use it directly
    if (propertyType) {
      return this.buildTypedFilter(property, operator, value, propertyType);
    }

    // Check for boolean values
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return {
        property,
        checkbox: { [operator]: value.toLowerCase() === 'true' },
      };
    }

    // Check for number values
    if (!isNaN(parseFloat(value)) && isFinite(Number(value))) {
      return {
        property,
        number: { [operator]: parseFloat(value) },
      };
    }

    // Check for empty/not empty
    if (value.toLowerCase() === 'empty') {
      return {
        property,
        rich_text: { is_empty: true },
      };
    }

    // Default to select (most common for categorical data)
    return {
      property,
      select: { [operator]: value },
    };
  }

  /**
   * Build a filter with a known property type
   */
  private static buildTypedFilter(
    property: string,
    operator: string,
    value: string,
    type: string
  ): DatabaseQueryFilter {
    switch (type) {
      case 'select':
        return { property, select: { [operator]: value } };

      case 'multi_select':
        return { property, multi_select: { contains: value } };

      case 'status':
        return { property, status: { [operator]: value } };

      case 'checkbox':
        return { property, checkbox: { [operator]: value.toLowerCase() === 'true' } };

      case 'number':
        return { property, number: { [operator]: parseFloat(value) } };

      case 'date':
        return { property, date: { [operator]: value } };

      case 'rich_text':
        if (value.toLowerCase() === 'empty') {
          return { property, rich_text: { is_empty: true } };
        }
        return { property, rich_text: { [operator === 'equals' ? 'equals' : 'contains']: value } };

      case 'title':
        if (value.toLowerCase() === 'empty') {
          return { property, title: { is_empty: true } };
        }
        return { property, title: { [operator === 'equals' ? 'equals' : 'contains']: value } };

      case 'url':
        if (value.toLowerCase() === 'empty') {
          return { property, url: { is_empty: true } };
        }
        return { property, url: { [operator === 'equals' ? 'equals' : 'contains']: value } };

      case 'email':
        return { property, email: { [operator]: value } };

      case 'phone_number':
        return { property, phone_number: { [operator]: value } };

      case 'people':
        if (value.toLowerCase() === 'empty') {
          return { property, people: { is_empty: true } };
        }
        return { property, people: { contains: value } };

      case 'files':
        return { property, files: { is_empty: value.toLowerCase() === 'empty' } };

      case 'relation':
        if (value.toLowerCase() === 'empty') {
          return { property, relation: { is_empty: true } };
        }
        return { property, relation: { contains: value } };

      default:
        // Fallback to select for unknown types
        return { property, select: { [operator]: value } };
    }
  }

  /**
   * Parse a property update string like "Type=Platform"
   */
  static parseUpdate(updateString: string): ParsedPropertyUpdate {
    const idx = updateString.indexOf('=');
    if (idx === -1) {
      throw new Error(`Invalid update format: ${updateString}. Expected "Property=Value"`);
    }

    return {
      property: updateString.substring(0, idx).trim(),
      value: updateString.substring(idx + 1).trim(),
    };
  }
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly pages: PagesApi;
  private readonly databases: DatabasesApi;

  constructor(private readonly client: NotionClient) {
    this.pages = new PagesApi(client);
    this.databases = new DatabasesApi(client);
  }

  /**
   * Bulk update pages with property changes
   */
  async update(options: BulkUpdateOptions): Promise<BulkUpdateResult> {
    const {
      databaseId,
      where,
      filter,
      pageIds,
      updates,
      concurrency = 3,
      dryRun = false,
      onProgress,
      onError,
    } = options;

    const result: BulkUpdateResult = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      updatedPages: [],
    };

    // Get pages to update
    let pages: NotionPage[] = [];

    if (pageIds && pageIds.length > 0) {
      // Fetch pages by IDs
      pages = await Promise.all(
        pageIds.map(id => this.pages.get(id))
      );
    } else if (databaseId) {
      // Get database schema for smart filtering
      const schema = await this.databases.get(databaseId);
      const schemaTypes = Object.fromEntries(
        Object.entries(schema.properties).map(([name, config]) => [name, { type: config.type }])
      );

      // Query database with filter (using schema for type detection)
      const notionFilter = where ? FilterParser.parse(where, schemaTypes) : filter;
      pages = await this.databases.queryAll(databaseId, {
        filter: notionFilter,
      });
    } else {
      throw new Error('Either databaseId or pageIds must be provided');
    }

    result.total = pages.length;

    if (pages.length === 0) {
      return result;
    }

    // Build the properties update object
    const propertiesUpdate = this.buildPropertiesUpdate(updates, pages[0]);

    // Process in batches with concurrency control
    const chunks = this.chunkArray(pages, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (page) => {
          try {
            if (dryRun) {
              result.success++;
              result.updatedPages.push(page);
            } else {
              const updated = await this.pages.update(page.id, {
                properties: propertiesUpdate,
              });
              result.success++;
              result.updatedPages.push(updated);
            }

            if (onProgress) {
              onProgress(result.success + result.failed, result.total, page);
            }
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ pageId: page.id, error: errorMessage });

            if (onError) {
              onError(err instanceof Error ? err : new Error(errorMessage), page);
            }
          }
        })
      );
    }

    return result;
  }

  /**
   * Build Notion properties update object from parsed updates
   */
  private buildPropertiesUpdate(
    updates: ParsedPropertyUpdate[],
    samplePage: NotionPage
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};

    for (const update of updates) {
      const existingProp = samplePage.properties[update.property];

      if (!existingProp) {
        // Property not found, try to infer type from value
        properties[update.property] = this.inferPropertyValue(update.value);
        continue;
      }

      // Build update based on property type
      properties[update.property] = this.buildPropertyValue(
        existingProp.type,
        update.value
      );
    }

    return properties;
  }

  /**
   * Build a property value based on type
   */
  private buildPropertyValue(type: string, value: string): unknown {
    switch (type) {
      case 'select':
        return { select: value ? { name: value } : null };

      case 'multi_select':
        return {
          multi_select: value
            .split(',')
            .map(v => v.trim())
            .filter(v => v)
            .map(name => ({ name })),
        };

      case 'status':
        return { status: value ? { name: value } : null };

      case 'checkbox':
        return { checkbox: value.toLowerCase() === 'true' };

      case 'number':
        return { number: value ? parseFloat(value) : null };

      case 'url':
        return { url: value || null };

      case 'email':
        return { email: value || null };

      case 'phone_number':
        return { phone_number: value || null };

      case 'rich_text':
        return {
          rich_text: value
            ? [{ type: 'text', text: { content: value } }]
            : [],
        };

      case 'title':
        return {
          title: value
            ? [{ type: 'text', text: { content: value } }]
            : [],
        };

      case 'date':
        if (!value) return { date: null };
        // Support "start,end" format
        const [start, end] = value.split(',').map(v => v.trim());
        return { date: { start, end: end || null } };

      default:
        // Try as select for unknown types
        return { select: value ? { name: value } : null };
    }
  }

  /**
   * Infer property value type from the value itself
   */
  private inferPropertyValue(value: string): unknown {
    // Boolean
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
      return { checkbox: value.toLowerCase() === 'true' };
    }

    // Number
    if (!isNaN(parseFloat(value)) && isFinite(Number(value))) {
      return { number: parseFloat(value) };
    }

    // URL
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return { url: value };
    }

    // Email
    if (value.includes('@') && value.includes('.')) {
      return { email: value };
    }

    // Default to select
    return { select: { name: value } };
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get database schema to understand property types
   */
  async getSchema(databaseId: string): Promise<NotionDatabase> {
    return this.databases.get(databaseId);
  }

  /**
   * Preview what a bulk update would affect
   */
  async preview(options: Omit<BulkUpdateOptions, 'dryRun'>): Promise<{
    pages: Array<{ id: string; title: string; currentValues: Record<string, unknown> }>;
    updates: ParsedPropertyUpdate[];
  }> {
    const { databaseId, where, filter, pageIds } = options;

    let pages: NotionPage[] = [];

    if (pageIds && pageIds.length > 0) {
      pages = await Promise.all(pageIds.map(id => this.pages.get(id)));
    } else if (databaseId) {
      // Get database schema for smart filtering
      const schema = await this.databases.get(databaseId);
      const schemaTypes = Object.fromEntries(
        Object.entries(schema.properties).map(([name, config]) => [name, { type: config.type }])
      );

      const notionFilter = where ? FilterParser.parse(where, schemaTypes) : filter;
      pages = await this.databases.queryAll(databaseId, { filter: notionFilter });
    }

    return {
      pages: pages.map(page => ({
        id: page.id,
        title: this.getPageTitle(page),
        currentValues: this.extractPropertyValues(page, options.updates),
      })),
      updates: options.updates,
    };
  }

  /**
   * Extract page title
   */
  private getPageTitle(page: NotionPage): string {
    for (const prop of Object.values(page.properties)) {
      if (prop.type === 'title') {
        const titleProp = prop as { title: Array<{ plain_text: string }> };
        return titleProp.title.map(t => t.plain_text).join('');
      }
    }
    return page.id;
  }

  /**
   * Extract current values for specified properties
   */
  private extractPropertyValues(
    page: NotionPage,
    updates: ParsedPropertyUpdate[]
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const update of updates) {
      const prop = page.properties[update.property];
      if (prop) {
        values[update.property] = this.extractPropertyValue(prop);
      }
    }

    return values;
  }

  /**
   * Extract a readable value from a property
   */
  private extractPropertyValue(prop: { type: string; [key: string]: unknown }): unknown {
    switch (prop.type) {
      case 'select':
        return (prop.select as { name: string } | null)?.name || null;
      case 'multi_select':
        return (prop.multi_select as Array<{ name: string }>).map(s => s.name);
      case 'status':
        return (prop.status as { name: string } | null)?.name || null;
      case 'checkbox':
        return prop.checkbox;
      case 'number':
        return prop.number;
      case 'url':
        return prop.url;
      case 'email':
        return prop.email;
      case 'phone_number':
        return prop.phone_number;
      case 'rich_text':
        return (prop.rich_text as Array<{ plain_text: string }>)
          .map(t => t.plain_text)
          .join('');
      case 'title':
        return (prop.title as Array<{ plain_text: string }>)
          .map(t => t.plain_text)
          .join('');
      case 'date':
        const date = prop.date as { start: string; end?: string } | null;
        return date ? (date.end ? `${date.start} - ${date.end}` : date.start) : null;
      default:
        return prop[prop.type];
    }
  }
}
