import type {
  AirtableConfig,
  Base,
  ListBasesResult,
  BaseSchema,
  Table,
  Field,
  Record,
  RecordFields,
  ListRecordsResult,
  CreateRecordResult,
  UpdateRecordResult,
  DeleteRecordResult,
  BatchCreateResult,
  BatchUpdateResult,
  BatchDeleteResult,
  Comment,
  ListCommentsResult,
  Webhook,
  ListWebhooksResult,
  WebhookPayload,
} from '../types';
import { AirtableClient } from './client';

/**
 * Airtable API wrapper
 */
export class Airtable {
  private readonly client: AirtableClient;

  constructor(config: AirtableConfig) {
    this.client = new AirtableClient(config);
  }

  /**
   * Create a client from environment variables
   */
  static fromEnv(): Airtable {
    const accessToken = process.env.AIRTABLE_ACCESS_TOKEN || process.env.AIRTABLE_API_KEY;

    if (!accessToken) {
      throw new Error('AIRTABLE_ACCESS_TOKEN or AIRTABLE_API_KEY environment variable is required');
    }
    return new Airtable({ accessToken });
  }

  /**
   * Get a preview of the access token (for debugging)
   */
  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
  }

  /**
   * Get the underlying client for direct API access
   */
  getClient(): AirtableClient {
    return this.client;
  }

  // ============================================
  // Bases API
  // ============================================

  /**
   * List all accessible bases
   */
  async listBases(params?: { offset?: string }): Promise<ListBasesResult> {
    return this.client.get<ListBasesResult>('/meta/bases', params);
  }

  /**
   * Get base schema (tables and fields)
   */
  async getBaseSchema(baseId: string): Promise<BaseSchema> {
    return this.client.get<BaseSchema>(`/meta/bases/${baseId}/tables`);
  }

  // ============================================
  // Tables API
  // ============================================

  /**
   * Create a table in a base
   */
  async createTable(baseId: string, params: {
    name: string;
    description?: string;
    fields: Array<{
      name: string;
      type: string;
      description?: string;
      options?: Record<string, unknown>;
    }>;
  }): Promise<Table> {
    return this.client.post<Table>(`/meta/bases/${baseId}/tables`, params);
  }

  /**
   * Update table metadata
   */
  async updateTable(baseId: string, tableId: string, params: {
    name?: string;
    description?: string;
  }): Promise<Table> {
    return this.client.patch<Table>(`/meta/bases/${baseId}/tables/${tableId}`, params);
  }

  // ============================================
  // Fields API
  // ============================================

  /**
   * Create a field in a table
   */
  async createField(baseId: string, tableId: string, params: {
    name: string;
    type: string;
    description?: string;
    options?: Record<string, unknown>;
  }): Promise<Field> {
    return this.client.post<Field>(`/meta/bases/${baseId}/tables/${tableId}/fields`, params);
  }

  /**
   * Update a field
   */
  async updateField(baseId: string, tableId: string, fieldId: string, params: {
    name?: string;
    description?: string;
  }): Promise<Field> {
    return this.client.patch<Field>(`/meta/bases/${baseId}/tables/${tableId}/fields/${fieldId}`, params);
  }

  // ============================================
  // Records API
  // ============================================

  /**
   * List records in a table
   */
  async listRecords(baseId: string, tableIdOrName: string, params?: {
    fields?: string[];
    filterByFormula?: string;
    maxRecords?: number;
    pageSize?: number;
    sort?: Array<{ field: string; direction?: 'asc' | 'desc' }>;
    view?: string;
    cellFormat?: 'json' | 'string';
    timeZone?: string;
    userLocale?: string;
    offset?: string;
    returnFieldsByFieldId?: boolean;
  }): Promise<ListRecordsResult> {
    const queryParams: Record<string, string | number | boolean | string[] | undefined> = {};

    if (params?.fields) {
      queryParams['fields[]'] = params.fields;
    }
    if (params?.filterByFormula) {
      queryParams.filterByFormula = params.filterByFormula;
    }
    if (params?.maxRecords) {
      queryParams.maxRecords = params.maxRecords;
    }
    if (params?.pageSize) {
      queryParams.pageSize = params.pageSize;
    }
    if (params?.sort) {
      params.sort.forEach((s, i) => {
        queryParams[`sort[${i}][field]`] = s.field;
        if (s.direction) {
          queryParams[`sort[${i}][direction]`] = s.direction;
        }
      });
    }
    if (params?.view) {
      queryParams.view = params.view;
    }
    if (params?.cellFormat) {
      queryParams.cellFormat = params.cellFormat;
    }
    if (params?.timeZone) {
      queryParams.timeZone = params.timeZone;
    }
    if (params?.userLocale) {
      queryParams.userLocale = params.userLocale;
    }
    if (params?.offset) {
      queryParams.offset = params.offset;
    }
    if (params?.returnFieldsByFieldId) {
      queryParams.returnFieldsByFieldId = params.returnFieldsByFieldId;
    }

    return this.client.get<ListRecordsResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, queryParams);
  }

  /**
   * Get a single record
   */
  async getRecord(baseId: string, tableIdOrName: string, recordId: string, params?: {
    returnFieldsByFieldId?: boolean;
  }): Promise<Record> {
    return this.client.get<Record>(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`, params);
  }

  /**
   * Create a record
   */
  async createRecord(baseId: string, tableIdOrName: string, fields: RecordFields, params?: {
    typecast?: boolean;
    returnFieldsByFieldId?: boolean;
  }): Promise<CreateRecordResult> {
    return this.client.post<CreateRecordResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      fields,
      typecast: params?.typecast,
      returnFieldsByFieldId: params?.returnFieldsByFieldId,
    });
  }

  /**
   * Create multiple records (up to 10)
   */
  async createRecords(baseId: string, tableIdOrName: string, records: Array<{ fields: RecordFields }>, params?: {
    typecast?: boolean;
    returnFieldsByFieldId?: boolean;
  }): Promise<BatchCreateResult> {
    return this.client.post<BatchCreateResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      records,
      typecast: params?.typecast,
      returnFieldsByFieldId: params?.returnFieldsByFieldId,
    });
  }

  /**
   * Update a record
   */
  async updateRecord(baseId: string, tableIdOrName: string, recordId: string, fields: RecordFields, params?: {
    typecast?: boolean;
    returnFieldsByFieldId?: boolean;
  }): Promise<UpdateRecordResult> {
    return this.client.patch<UpdateRecordResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`, {
      fields,
      typecast: params?.typecast,
      returnFieldsByFieldId: params?.returnFieldsByFieldId,
    });
  }

  /**
   * Update multiple records (up to 10)
   */
  async updateRecords(baseId: string, tableIdOrName: string, records: Array<{ id: string; fields: RecordFields }>, params?: {
    typecast?: boolean;
    returnFieldsByFieldId?: boolean;
    performUpsert?: { fieldsToMergeOn: string[] };
  }): Promise<BatchUpdateResult> {
    return this.client.patch<BatchUpdateResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      records,
      typecast: params?.typecast,
      returnFieldsByFieldId: params?.returnFieldsByFieldId,
      performUpsert: params?.performUpsert,
    });
  }

  /**
   * Delete a record
   */
  async deleteRecord(baseId: string, tableIdOrName: string, recordId: string): Promise<DeleteRecordResult> {
    return this.client.delete<DeleteRecordResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}`);
  }

  /**
   * Delete multiple records (up to 10)
   */
  async deleteRecords(baseId: string, tableIdOrName: string, recordIds: string[]): Promise<BatchDeleteResult> {
    // Airtable uses query params for batch delete
    const params: Record<string, string[]> = {
      'records[]': recordIds,
    };
    return this.client.request<BatchDeleteResult>(`/${baseId}/${encodeURIComponent(tableIdOrName)}`, {
      method: 'DELETE',
      params,
    });
  }

  // ============================================
  // Comments API
  // ============================================

  /**
   * List comments on a record
   */
  async listComments(baseId: string, tableIdOrName: string, recordId: string, params?: {
    offset?: string;
    pageSize?: number;
  }): Promise<ListCommentsResult> {
    return this.client.get<ListCommentsResult>(
      `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}/comments`,
      params
    );
  }

  /**
   * Create a comment on a record
   */
  async createComment(baseId: string, tableIdOrName: string, recordId: string, text: string): Promise<Comment> {
    return this.client.post<Comment>(
      `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}/comments`,
      { text }
    );
  }

  /**
   * Update a comment
   */
  async updateComment(baseId: string, tableIdOrName: string, recordId: string, commentId: string, text: string): Promise<Comment> {
    return this.client.patch<Comment>(
      `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}/comments/${commentId}`,
      { text }
    );
  }

  /**
   * Delete a comment
   */
  async deleteComment(baseId: string, tableIdOrName: string, recordId: string, commentId: string): Promise<{ deleted: boolean; id: string }> {
    return this.client.delete<{ deleted: boolean; id: string }>(
      `/${baseId}/${encodeURIComponent(tableIdOrName)}/${recordId}/comments/${commentId}`
    );
  }

  // ============================================
  // Webhooks API
  // ============================================

  /**
   * List webhooks for a base
   */
  async listWebhooks(baseId: string): Promise<ListWebhooksResult> {
    return this.client.get<ListWebhooksResult>(`/bases/${baseId}/webhooks`);
  }

  /**
   * Create a webhook
   */
  async createWebhook(baseId: string, specification: {
    options: {
      filters: {
        dataTypes?: ('tableData' | 'tableFields' | 'tableMetadata')[];
        recordChangeScope?: string;
        watchDataInFieldIds?: string[];
        watchSchemasOfFieldIds?: string[];
        sourceOptions?: {
          formSubmission?: { viewId: string };
        };
      };
      includes?: {
        includePreviousCellValues?: boolean;
        includePreviousFieldDefinitions?: boolean;
      };
    };
  }, notificationUrl?: string): Promise<Webhook> {
    return this.client.post<Webhook>(`/bases/${baseId}/webhooks`, {
      specification,
      notificationUrl,
    });
  }

  /**
   * Enable/disable webhook notifications
   */
  async updateWebhook(baseId: string, webhookId: string, params: {
    enable?: boolean;
    notificationUrl?: string;
  }): Promise<Webhook> {
    return this.client.patch<Webhook>(`/bases/${baseId}/webhooks/${webhookId}`, params);
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(baseId: string, webhookId: string): Promise<void> {
    await this.client.delete(`/bases/${baseId}/webhooks/${webhookId}`);
  }

  /**
   * Get webhook payloads
   */
  async getWebhookPayloads(baseId: string, webhookId: string, params?: {
    cursor?: number;
    limit?: number;
  }): Promise<{ cursor: number; mightHaveMore: boolean; payloads: WebhookPayload[] }> {
    return this.client.get(`/bases/${baseId}/webhooks/${webhookId}/payloads`, params);
  }

  /**
   * Refresh webhook (extend expiration)
   */
  async refreshWebhook(baseId: string, webhookId: string): Promise<{ expirationTime: string }> {
    return this.client.post(`/bases/${baseId}/webhooks/${webhookId}/refresh`);
  }
}

export { AirtableClient } from './client';
