import { NotionClient } from './client';
import type {
  NotionDatabase,
  NotionPage,
  PaginatedResponse,
  DatabaseQueryOptions,
  CreateDatabaseOptions,
  UpdateDatabaseOptions,
  RichText,
  DatabasePropertyConfig,
} from '../types';

// ============================================
// Property Configuration Types
// ============================================

export type PropertyType =
  | 'title'
  | 'rich_text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'people'
  | 'files'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone_number'
  | 'formula'
  | 'relation'
  | 'rollup'
  | 'created_time'
  | 'created_by'
  | 'last_edited_time'
  | 'last_edited_by';

export type SelectColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

export type NumberFormat =
  | 'number'
  | 'number_with_commas'
  | 'percent'
  | 'dollar'
  | 'canadian_dollar'
  | 'euro'
  | 'pound'
  | 'yen'
  | 'ruble'
  | 'rupee'
  | 'won'
  | 'yuan'
  | 'real'
  | 'lira'
  | 'rupiah'
  | 'franc'
  | 'hong_kong_dollar'
  | 'new_zealand_dollar'
  | 'krona'
  | 'norwegian_krone'
  | 'mexican_peso'
  | 'rand'
  | 'new_taiwan_dollar'
  | 'danish_krone'
  | 'zloty'
  | 'baht'
  | 'forint'
  | 'koruna'
  | 'shekel'
  | 'chilean_peso'
  | 'philippine_peso'
  | 'dirham'
  | 'colombian_peso'
  | 'riyal'
  | 'ringgit'
  | 'leu'
  | 'argentine_peso'
  | 'uruguayan_peso'
  | 'singapore_dollar';

export type RollupFunction =
  | 'count'
  | 'count_values'
  | 'empty'
  | 'not_empty'
  | 'unique'
  | 'show_unique'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'average'
  | 'median'
  | 'min'
  | 'max'
  | 'range'
  | 'earliest_date'
  | 'latest_date'
  | 'date_range'
  | 'checked'
  | 'unchecked'
  | 'percent_checked'
  | 'percent_unchecked'
  | 'show_original';

export interface SelectOption {
  name: string;
  color?: SelectColor;
}

export interface StatusOption {
  name: string;
  color?: SelectColor;
}

export interface StatusGroup {
  name: string;
  option_ids: string[];
  color: SelectColor;
}

export interface PropertyConfig {
  [key: string]: unknown;
}

export interface PropertyOptions {
  selectOptions?: (string | SelectOption)[];
  numberFormat?: NumberFormat;
  formula?: string;
  relationDatabaseId?: string;
  rollup?: {
    relationProperty: string;
    rollupProperty: string;
    function: RollupFunction;
  };
  statusOptions?: StatusOption[];
  statusGroups?: StatusGroup[];
}

export class DatabasesApi {
  constructor(private readonly client: NotionClient) {}

  /**
   * Retrieve a database by ID
   * https://developers.notion.com/reference/retrieve-a-database
   */
  async get(databaseId: string): Promise<NotionDatabase> {
    return this.client.get<NotionDatabase>(`/databases/${databaseId}`);
  }

  /**
   * Query a database
   * https://developers.notion.com/reference/post-database-query
   */
  async query(
    databaseId: string,
    options: DatabaseQueryOptions = {}
  ): Promise<PaginatedResponse<NotionPage>> {
    const body: Record<string, unknown> = {};

    if (options.filter) {
      body.filter = options.filter;
    }
    if (options.sorts) {
      body.sorts = options.sorts;
    }
    if (options.start_cursor) {
      body.start_cursor = options.start_cursor;
    }
    if (options.page_size) {
      body.page_size = options.page_size;
    }

    return this.client.post<PaginatedResponse<NotionPage>>(
      `/databases/${databaseId}/query`,
      body
    );
  }

  /**
   * Create a database
   * https://developers.notion.com/reference/create-a-database
   */
  async create(options: CreateDatabaseOptions): Promise<NotionDatabase> {
    const body: Record<string, unknown> = {
      parent: options.parent,
      title: options.title,
      properties: options.properties,
    };

    if (options.icon) {
      body.icon = options.icon;
    }
    if (options.cover) {
      body.cover = options.cover;
    }
    if (options.is_inline !== undefined) {
      body.is_inline = options.is_inline;
    }

    return this.client.post<NotionDatabase>('/databases', body);
  }

  /**
   * Update a database
   * https://developers.notion.com/reference/update-a-database
   */
  async update(
    databaseId: string,
    options: UpdateDatabaseOptions
  ): Promise<NotionDatabase> {
    const body: Record<string, unknown> = {};

    if (options.title) {
      body.title = options.title;
    }
    if (options.description) {
      body.description = options.description;
    }
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
    if (options.is_inline !== undefined) {
      body.is_inline = options.is_inline;
    }

    return this.client.patch<NotionDatabase>(`/databases/${databaseId}`, body);
  }

  /**
   * List all databases (via search)
   * Note: The list databases endpoint is deprecated
   */
  async list(
    startCursor?: string,
    pageSize: number = 100
  ): Promise<PaginatedResponse<NotionDatabase>> {
    const body: Record<string, unknown> = {
      filter: {
        value: 'database',
        property: 'object',
      },
    };

    if (startCursor) {
      body.start_cursor = startCursor;
    }
    if (pageSize) {
      body.page_size = pageSize;
    }

    return this.client.post<PaginatedResponse<NotionDatabase>>('/search', body);
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Create a simple database with basic properties
   */
  async createSimple(
    parentPageId: string,
    title: string,
    properties: Record<string, { type: string; [key: string]: unknown }>
  ): Promise<NotionDatabase> {
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

    // Ensure there's a title property
    const dbProperties: Record<string, unknown> = {
      Name: { title: {} },
      ...properties,
    };

    return this.create({
      parent: { page_id: parentPageId },
      title: titleRichText,
      properties: dbProperties,
    });
  }

  /**
   * Archive a database
   */
  async archive(databaseId: string): Promise<NotionDatabase> {
    return this.update(databaseId, { archived: true });
  }

  /**
   * Unarchive a database
   */
  async unarchive(databaseId: string): Promise<NotionDatabase> {
    return this.update(databaseId, { archived: false });
  }

  // ============================================
  // Property Management Methods
  // ============================================

  /**
   * Add a new property (column) to a database
   * https://developers.notion.com/reference/update-a-database
   */
  async addProperty(
    databaseId: string,
    propertyName: string,
    propertyConfig: PropertyConfig
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [propertyName]: propertyConfig,
    };
    return this.update(databaseId, { properties });
  }

  /**
   * Add multiple properties to a database at once
   */
  async addProperties(
    databaseId: string,
    properties: Record<string, PropertyConfig>
  ): Promise<NotionDatabase> {
    return this.update(databaseId, { properties });
  }

  /**
   * Rename a property (column) in a database
   */
  async renameProperty(
    databaseId: string,
    oldName: string,
    newName: string
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [oldName]: { name: newName },
    };
    return this.update(databaseId, { properties });
  }

  /**
   * Delete a property (column) from a database
   * Note: Cannot delete the title property
   */
  async deleteProperty(
    databaseId: string,
    propertyName: string
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [propertyName]: null,
    };
    return this.update(databaseId, { properties });
  }

  /**
   * Update a property's configuration (e.g., change type, add options)
   */
  async updateProperty(
    databaseId: string,
    propertyName: string,
    propertyConfig: Partial<PropertyConfig>
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [propertyName]: propertyConfig,
    };
    return this.update(databaseId, { properties });
  }

  /**
   * Add a select option to a select or multi_select property
   */
  async addSelectOption(
    databaseId: string,
    propertyName: string,
    optionName: string,
    color?: SelectColor
  ): Promise<NotionDatabase> {
    // First get the current database to find existing options
    const db = await this.get(databaseId);
    const property = db.properties[propertyName];

    if (!property) {
      throw new Error(`Property "${propertyName}" not found`);
    }

    const propType = property.type;
    if (propType !== 'select' && propType !== 'multi_select') {
      throw new Error(`Property "${propertyName}" is not a select or multi_select type`);
    }

    const existingOptions = (property as any)[propType]?.options || [];
    const newOption: SelectOption = { name: optionName };
    if (color) {
      newOption.color = color;
    }

    const properties: Record<string, unknown> = {
      [propertyName]: {
        [propType]: {
          options: [...existingOptions, newOption],
        },
      },
    };

    return this.update(databaseId, { properties });
  }

  /**
   * Add a status option to a status property
   * Note: Status property options cannot be modified via API after creation
   */
  async addStatusOption(
    databaseId: string,
    propertyName: string,
    optionName: string,
    color?: SelectColor,
    group?: 'to-do' | 'in_progress' | 'complete'
  ): Promise<NotionDatabase> {
    const db = await this.get(databaseId);
    const property = db.properties[propertyName];

    if (!property || property.type !== 'status') {
      throw new Error(`Property "${propertyName}" is not a status type`);
    }

    const existingOptions = (property as any).status?.options || [];
    const existingGroups = (property as any).status?.groups || [];

    const newOption: StatusOption = { name: optionName };
    if (color) {
      newOption.color = color;
    }

    const properties: Record<string, unknown> = {
      [propertyName]: {
        status: {
          options: [...existingOptions, newOption],
          groups: existingGroups,
        },
      },
    };

    return this.update(databaseId, { properties });
  }

  /**
   * Create a relation property linking to another database
   */
  async addRelationProperty(
    databaseId: string,
    propertyName: string,
    relatedDatabaseId: string,
    options?: {
      singleProperty?: boolean; // If true, creates a single property relation (no synced property in related database)
      syncedPropertyName?: string; // Name of the synced property in the related database
    }
  ): Promise<NotionDatabase> {
    const relationConfig: Record<string, unknown> = {
      relation: {
        database_id: relatedDatabaseId,
      },
    };

    if (options?.singleProperty) {
      (relationConfig.relation as any).type = 'single_property';
      (relationConfig.relation as any).single_property = {};
    } else {
      (relationConfig.relation as any).type = 'dual_property';
      (relationConfig.relation as any).dual_property = {
        synced_property_name: options?.syncedPropertyName || propertyName,
      };
    }

    const properties: Record<string, unknown> = {
      [propertyName]: relationConfig,
    };

    return this.update(databaseId, { properties });
  }

  /**
   * Create a rollup property based on a relation
   */
  async addRollupProperty(
    databaseId: string,
    propertyName: string,
    relationPropertyName: string,
    rollupPropertyName: string,
    functionType: RollupFunction
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [propertyName]: {
        rollup: {
          relation_property_name: relationPropertyName,
          rollup_property_name: rollupPropertyName,
          function: functionType,
        },
      },
    };

    return this.update(databaseId, { properties });
  }

  /**
   * Create a formula property
   */
  async addFormulaProperty(
    databaseId: string,
    propertyName: string,
    expression: string
  ): Promise<NotionDatabase> {
    const properties: Record<string, unknown> = {
      [propertyName]: {
        formula: {
          expression,
        },
      },
    };

    return this.update(databaseId, { properties });
  }

  /**
   * Get all properties from a database
   */
  async getProperties(databaseId: string): Promise<Record<string, DatabasePropertyConfig>> {
    const db = await this.get(databaseId);
    return db.properties;
  }

  /**
   * Get a specific property from a database
   */
  async getProperty(databaseId: string, propertyName: string): Promise<DatabasePropertyConfig | null> {
    const db = await this.get(databaseId);
    return db.properties[propertyName] || null;
  }

  // ============================================
  // Helper Methods for Property Creation
  // ============================================

  /**
   * Create property configurations for common types
   */
  static createPropertyConfig(type: PropertyType, options?: PropertyOptions): PropertyConfig {
    const config: PropertyConfig = { [type]: {} };

    switch (type) {
      case 'select':
      case 'multi_select':
        if (options?.selectOptions) {
          (config[type] as any).options = options.selectOptions.map(opt =>
            typeof opt === 'string' ? { name: opt } : opt
          );
        }
        break;
      case 'number':
        if (options?.numberFormat) {
          (config[type] as any).format = options.numberFormat;
        }
        break;
      case 'formula':
        if (options?.formula) {
          (config[type] as any).expression = options.formula;
        }
        break;
      case 'relation':
        if (options?.relationDatabaseId) {
          (config[type] as any).database_id = options.relationDatabaseId;
          (config[type] as any).type = 'single_property';
          (config[type] as any).single_property = {};
        }
        break;
      case 'rollup':
        if (options?.rollup) {
          (config[type] as any).relation_property_name = options.rollup.relationProperty;
          (config[type] as any).rollup_property_name = options.rollup.rollupProperty;
          (config[type] as any).function = options.rollup.function;
        }
        break;
      case 'status':
        if (options?.statusOptions) {
          (config[type] as any).options = options.statusOptions;
          (config[type] as any).groups = options.statusGroups || [
            { name: 'To-do', option_ids: [], color: 'gray' },
            { name: 'In progress', option_ids: [], color: 'blue' },
            { name: 'Complete', option_ids: [], color: 'green' },
          ];
        }
        break;
    }

    return config;
  }

  /**
   * Query all pages in a database (handles pagination)
   */
  async queryAll(
    databaseId: string,
    options: Omit<DatabaseQueryOptions, 'start_cursor' | 'page_size'> = {}
  ): Promise<NotionPage[]> {
    const allPages: NotionPage[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.query(databaseId, {
        ...options,
        start_cursor: cursor,
        page_size: 100,
      });

      allPages.push(...response.results);
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return allPages;
  }
}
