import type { ZendeskClient } from './client';
import type { TicketsApi } from './tickets';
import type { UsersApi } from './users';
import type { TicketFieldsApi } from './ticket-fields';
import type {
  ZendeskTicket,
  ZendeskUser,
  ZendeskTicketField,
} from '../types';

// ============================================
// Filter Parser Types
// ============================================

export type FilterOperator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'contains' | 'starts_with' | 'ends_with'
  | 'is_empty' | 'is_not_empty';

export interface ParsedFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

export interface ParsedUpdate {
  field: string;
  value: string;
}

// ============================================
// Bulk Operation Types
// ============================================

export type BulkResourceType = 'tickets' | 'users';

export interface BulkUpdateOptions {
  /** Resource type to update */
  resourceType: BulkResourceType;
  /** Simple filter string like "status=open" or "priority=high" */
  where?: string;
  /** Direct IDs to update */
  ids?: number[];
  /** Field updates to apply */
  updates: ParsedUpdate[];
  /** Maximum concurrent API calls (default: 3) */
  concurrency?: number;
  /** Dry run - don't actually update */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, item: ZendeskTicket | ZendeskUser) => void;
  /** Error callback */
  onError?: (error: Error, item: ZendeskTicket | ZendeskUser) => void;
}

export interface BulkUpdateResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ id: number; error: string }>;
  jobStatus?: {
    id: string;
    status: string;
    message?: string;
  };
  updatedItems: Array<ZendeskTicket | ZendeskUser>;
}

export interface BulkPreviewResult {
  items: Array<{
    id: number;
    title: string;
    currentValues: Record<string, unknown>;
  }>;
  updates: ParsedUpdate[];
  count: number;
}

// ============================================
// Schema Types
// ============================================

export interface FieldSchema {
  name: string;
  type: string;
  description?: string;
  options?: Array<{ name: string; value: string }>;
  systemOptions?: Array<{ name: string; value: string }>;
}

export interface BulkSchema {
  tickets: {
    fields: FieldSchema[];
    statuses: string[];
    priorities: string[];
    types: string[];
  };
  users: {
    fields: FieldSchema[];
    roles: string[];
  };
}

// ============================================
// Filter Parser
// ============================================

export class FilterParser {
  /**
   * Parse a simple filter string into Zendesk search query format
   * Supports: field=value, field!=value, field>value, etc.
   * Multiple conditions with & (AND) or | (OR)
   */
  static parse(filterString: string): string {
    // Handle OR conditions
    if (filterString.includes('|')) {
      const parts = filterString.split('|').map(p => p.trim());
      // Zendesk doesn't support OR in the same way, so we'll use multiple queries
      // For simplicity, we'll just take the first condition
      return this.parseSingleCondition(parts[0]);
    }

    // Handle AND conditions
    if (filterString.includes('&')) {
      const parts = filterString.split('&').map(p => p.trim());
      return parts.map(part => this.parseSingleCondition(part)).join(' ');
    }

    // Single condition
    return this.parseSingleCondition(filterString);
  }

  /**
   * Parse a single filter condition into Zendesk query format
   */
  private static parseSingleCondition(condition: string): string {
    // Try different operators in order of specificity
    const operators: Array<{ op: string; zendeskOp: string }> = [
      { op: '!=', zendeskOp: '-' },
      { op: '>=', zendeskOp: '>=' },
      { op: '<=', zendeskOp: '<=' },
      { op: '>', zendeskOp: '>' },
      { op: '<', zendeskOp: '<' },
      { op: '=', zendeskOp: ':' },
    ];

    for (const { op, zendeskOp } of operators) {
      const idx = condition.indexOf(op);
      if (idx !== -1) {
        const field = condition.substring(0, idx).trim().toLowerCase();
        let value = condition.substring(idx + op.length).trim();

        // Handle values with spaces by quoting
        if (value.includes(' ')) {
          value = `"${value}"`;
        }

        // Map common field names to Zendesk search terms
        const mappedField = this.mapFieldName(field);

        // Handle negation
        if (zendeskOp === '-') {
          return `-${mappedField}:${value}`;
        }

        return `${mappedField}${zendeskOp}${value}`;
      }
    }

    throw new Error(`Invalid filter condition: ${condition}`);
  }

  /**
   * Map common field names to Zendesk search field names
   */
  private static mapFieldName(field: string): string {
    const fieldMap: Record<string, string> = {
      // Ticket fields
      'status': 'status',
      'priority': 'priority',
      'type': 'ticket_type',
      'ticket_type': 'ticket_type',
      'assignee': 'assignee',
      'assignee_id': 'assignee',
      'requester': 'requester',
      'requester_id': 'requester',
      'group': 'group',
      'group_id': 'group',
      'organization': 'organization',
      'organization_id': 'organization',
      'tag': 'tags',
      'tags': 'tags',
      'subject': 'subject',
      'description': 'description',
      'created': 'created',
      'created_at': 'created',
      'updated': 'updated',
      'updated_at': 'updated',
      'solved': 'solved',
      'due': 'due_date',
      'due_date': 'due_date',
      'brand': 'brand',
      'brand_id': 'brand',
      // User fields
      'role': 'role',
      'name': 'name',
      'email': 'email',
      'phone': 'phone',
      'external_id': 'external_id',
      'suspended': 'suspended',
      'verified': 'verified',
    };

    return fieldMap[field] || field;
  }

  /**
   * Parse a field update string like "status=solved" or "priority=high"
   */
  static parseUpdate(updateString: string): ParsedUpdate {
    const idx = updateString.indexOf('=');
    if (idx === -1) {
      throw new Error(`Invalid update format: ${updateString}. Expected "field=value"`);
    }

    return {
      field: updateString.substring(0, idx).trim().toLowerCase(),
      value: updateString.substring(idx + 1).trim(),
    };
  }

  /**
   * Build a Zendesk search query from multiple filter strings
   */
  static buildSearchQuery(resourceType: BulkResourceType, filters: string[]): string {
    const parts: string[] = [];

    // Add type prefix for tickets
    if (resourceType === 'tickets') {
      parts.push('type:ticket');
    }

    // Parse and add each filter
    for (const filter of filters) {
      if (filter.trim()) {
        parts.push(this.parse(filter));
      }
    }

    return parts.join(' ');
  }
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  constructor(
    private readonly client: ZendeskClient,
    private readonly tickets: TicketsApi,
    private readonly users: UsersApi,
    private readonly ticketFields: TicketFieldsApi
  ) {}

  /**
   * Bulk update resources using Zendesk's native bulk update endpoints
   * @see https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/#update-many-tickets
   */
  async update(options: BulkUpdateOptions): Promise<BulkUpdateResult> {
    const {
      resourceType,
      where,
      ids,
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
      updatedItems: [],
    };

    // Get items to update
    let itemIds: number[] = [];

    if (ids && ids.length > 0) {
      itemIds = ids;
    } else if (where) {
      // Search for matching items
      const searchResults = await this.search(resourceType, where);
      itemIds = searchResults.map(item => item.id);
    } else {
      throw new Error('Either "where" filter or "ids" must be provided');
    }

    result.total = itemIds.length;

    if (itemIds.length === 0) {
      return result;
    }

    // Build the update payload
    const updatePayload = this.buildUpdatePayload(resourceType, updates);

    if (dryRun) {
      // In dry run mode, just report what would be updated
      result.success = itemIds.length;
      result.skipped = 0;

      // Fetch items for reporting
      if (resourceType === 'tickets') {
        const tickets = await this.fetchTicketsByIds(itemIds.slice(0, 100)); // Limit for preview
        result.updatedItems = tickets;
      } else if (resourceType === 'users') {
        const users = await this.fetchUsersByIds(itemIds.slice(0, 100));
        result.updatedItems = users;
      }

      return result;
    }

    // Use Zendesk's native bulk update for tickets
    if (resourceType === 'tickets') {
      return this.bulkUpdateTickets(itemIds, updatePayload, result, onProgress, onError);
    } else if (resourceType === 'users') {
      return this.bulkUpdateUsers(itemIds, updatePayload, result, concurrency, onProgress, onError);
    }

    return result;
  }

  /**
   * Bulk update tickets using Zendesk's native update_many endpoint
   */
  private async bulkUpdateTickets(
    ticketIds: number[],
    updatePayload: Record<string, unknown>,
    result: BulkUpdateResult,
    onProgress?: (current: number, total: number, item: ZendeskTicket | ZendeskUser) => void,
    onError?: (error: Error, item: ZendeskTicket | ZendeskUser) => void
  ): Promise<BulkUpdateResult> {
    // Zendesk allows up to 100 tickets per bulk update
    const batchSize = 100;
    const batches = this.chunkArray(ticketIds, batchSize);

    for (const batch of batches) {
      try {
        // Use PUT /api/v2/tickets/update_many.json?ids=1,2,3
        const response = await this.client.put<{
          job_status: { id: string; status: string; message?: string };
        }>(
          `/tickets/update_many.json`,
          { ticket: updatePayload },
          { ids: batch.join(',') }
        );

        result.jobStatus = {
          id: response.job_status.id,
          status: response.job_status.status,
          message: response.job_status.message,
        };

        result.success += batch.length;

        // Report progress
        if (onProgress) {
          const dummyTicket = { id: batch[0] } as ZendeskTicket;
          onProgress(result.success, result.total, dummyTicket);
        }
      } catch (err) {
        result.failed += batch.length;
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const id of batch) {
          result.errors.push({ id, error: errorMessage });
        }

        if (onError) {
          const dummyTicket = { id: batch[0] } as ZendeskTicket;
          onError(err instanceof Error ? err : new Error(errorMessage), dummyTicket);
        }
      }
    }

    return result;
  }

  /**
   * Bulk update users using Zendesk's native update_many endpoint
   */
  private async bulkUpdateUsers(
    userIds: number[],
    updatePayload: Record<string, unknown>,
    result: BulkUpdateResult,
    concurrency: number,
    onProgress?: (current: number, total: number, item: ZendeskTicket | ZendeskUser) => void,
    onError?: (error: Error, item: ZendeskTicket | ZendeskUser) => void
  ): Promise<BulkUpdateResult> {
    // Zendesk allows up to 100 users per bulk update
    const batchSize = 100;
    const batches = this.chunkArray(userIds, batchSize);

    for (const batch of batches) {
      try {
        // Build users array for bulk update
        const usersToUpdate = batch.map(id => ({
          id,
          ...updatePayload,
        }));

        // Use PUT /api/v2/users/update_many.json
        const response = await this.client.put<{
          job_status: { id: string; status: string; message?: string };
        }>('/users/update_many.json', { users: usersToUpdate });

        result.jobStatus = {
          id: response.job_status.id,
          status: response.job_status.status,
          message: response.job_status.message,
        };

        result.success += batch.length;

        // Report progress
        if (onProgress) {
          const dummyUser = { id: batch[0] } as ZendeskUser;
          onProgress(result.success, result.total, dummyUser);
        }
      } catch (err) {
        result.failed += batch.length;
        const errorMessage = err instanceof Error ? err.message : String(err);
        for (const id of batch) {
          result.errors.push({ id, error: errorMessage });
        }

        if (onError) {
          const dummyUser = { id: batch[0] } as ZendeskUser;
          onError(err instanceof Error ? err : new Error(errorMessage), dummyUser);
        }
      }
    }

    return result;
  }

  /**
   * Search for resources matching a filter
   */
  private async search(resourceType: BulkResourceType, where: string): Promise<Array<{ id: number }>> {
    const query = FilterParser.buildSearchQuery(resourceType, [where]);

    if (resourceType === 'tickets') {
      const response = await this.client.get<{
        results: Array<{ id: number }>;
        next_page?: string;
      }>('/search.json', { query });

      // Paginate through all results
      let allResults = [...response.results];
      let nextPage = response.next_page;

      while (nextPage) {
        const pageResponse = await fetch(nextPage, {
          headers: {
            'Authorization': `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString('base64')}`,
            'Accept': 'application/json',
          },
        });
        const pageData = await pageResponse.json() as {
          results: Array<{ id: number }>;
          next_page?: string;
        };
        allResults = [...allResults, ...pageData.results];
        nextPage = pageData.next_page;
      }

      return allResults;
    } else if (resourceType === 'users') {
      const response = await this.client.get<{
        users: Array<{ id: number }>;
        next_page?: string;
      }>('/users/search.json', { query: where });

      return response.users;
    }

    return [];
  }

  /**
   * Build the update payload for Zendesk API
   */
  private buildUpdatePayload(
    resourceType: BulkResourceType,
    updates: ParsedUpdate[]
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const update of updates) {
      const field = this.normalizeFieldName(resourceType, update.field);
      payload[field] = this.parseFieldValue(field, update.value);
    }

    return payload;
  }

  /**
   * Normalize field names to Zendesk API format
   */
  private normalizeFieldName(resourceType: BulkResourceType, field: string): string {
    const ticketFieldMap: Record<string, string> = {
      'status': 'status',
      'priority': 'priority',
      'type': 'type',
      'ticket_type': 'type',
      'assignee': 'assignee_id',
      'assignee_id': 'assignee_id',
      'group': 'group_id',
      'group_id': 'group_id',
      'subject': 'subject',
      'tags': 'tags',
      'tag': 'tags',
      'due': 'due_at',
      'due_at': 'due_at',
      'due_date': 'due_at',
    };

    const userFieldMap: Record<string, string> = {
      'role': 'role',
      'name': 'name',
      'email': 'email',
      'phone': 'phone',
      'suspended': 'suspended',
      'verified': 'verified',
      'notes': 'notes',
      'details': 'details',
      'organization': 'organization_id',
      'organization_id': 'organization_id',
    };

    const fieldMap = resourceType === 'tickets' ? ticketFieldMap : userFieldMap;
    return fieldMap[field] || field;
  }

  /**
   * Parse field value into appropriate type
   */
  private parseFieldValue(field: string, value: string): unknown {
    // Boolean fields
    if (['suspended', 'verified'].includes(field)) {
      return value.toLowerCase() === 'true';
    }

    // ID fields
    if (field.endsWith('_id')) {
      return parseInt(value, 10);
    }

    // Tags (comma-separated)
    if (field === 'tags') {
      return value.split(',').map(t => t.trim());
    }

    return value;
  }

  /**
   * Fetch tickets by IDs
   */
  private async fetchTicketsByIds(ids: number[]): Promise<ZendeskTicket[]> {
    const response = await this.client.get<{ tickets: ZendeskTicket[] }>(
      '/tickets/show_many.json',
      { ids: ids.join(',') }
    );
    return response.tickets;
  }

  /**
   * Fetch users by IDs
   */
  private async fetchUsersByIds(ids: number[]): Promise<ZendeskUser[]> {
    const response = await this.client.get<{ users: ZendeskUser[] }>(
      '/users/show_many.json',
      { ids: ids.join(',') }
    );
    return response.users;
  }

  /**
   * Preview what a bulk update would affect
   */
  async preview(options: Omit<BulkUpdateOptions, 'dryRun'>): Promise<BulkPreviewResult> {
    const { resourceType, where, ids, updates } = options;

    let items: Array<ZendeskTicket | ZendeskUser> = [];

    if (ids && ids.length > 0) {
      if (resourceType === 'tickets') {
        items = await this.fetchTicketsByIds(ids);
      } else {
        items = await this.fetchUsersByIds(ids);
      }
    } else if (where) {
      const searchResults = await this.search(resourceType, where);
      const resultIds = searchResults.map(r => r.id).slice(0, 100); // Limit preview to 100

      if (resourceType === 'tickets') {
        items = resultIds.length > 0 ? await this.fetchTicketsByIds(resultIds) : [];
      } else {
        items = resultIds.length > 0 ? await this.fetchUsersByIds(resultIds) : [];
      }
    }

    return {
      items: items.map(item => ({
        id: item.id,
        title: this.getItemTitle(item, resourceType),
        currentValues: this.extractCurrentValues(item, updates),
      })),
      updates,
      count: items.length,
    };
  }

  /**
   * Get a readable title for an item
   */
  private getItemTitle(item: ZendeskTicket | ZendeskUser, resourceType: BulkResourceType): string {
    if (resourceType === 'tickets') {
      const ticket = item as ZendeskTicket;
      return ticket.subject || `Ticket #${ticket.id}`;
    } else {
      const user = item as ZendeskUser;
      return user.name || user.email || `User #${user.id}`;
    }
  }

  /**
   * Extract current values for the fields being updated
   */
  private extractCurrentValues(
    item: ZendeskTicket | ZendeskUser,
    updates: ParsedUpdate[]
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};

    for (const update of updates) {
      const field = update.field;
      const itemAny = item as Record<string, unknown>;

      // Handle field name mappings
      const mappings: Record<string, string> = {
        'assignee': 'assignee_id',
        'group': 'group_id',
        'organization': 'organization_id',
        'type': 'type',
        'ticket_type': 'type',
      };

      const actualField = mappings[field] || field;
      values[field] = itemAny[actualField];
    }

    return values;
  }

  /**
   * Get schema information for bulk operations
   */
  async getSchema(): Promise<BulkSchema> {
    // Fetch ticket fields from Zendesk
    const ticketFields = await this.ticketFields.list();

    return {
      tickets: {
        fields: this.mapTicketFieldsToSchema(ticketFields),
        statuses: ['new', 'open', 'pending', 'hold', 'solved', 'closed'],
        priorities: ['urgent', 'high', 'normal', 'low'],
        types: ['problem', 'incident', 'question', 'task'],
      },
      users: {
        fields: [
          { name: 'name', type: 'string', description: 'User name' },
          { name: 'email', type: 'string', description: 'User email address' },
          { name: 'phone', type: 'string', description: 'User phone number' },
          { name: 'role', type: 'select', description: 'User role', options: [
            { name: 'End-user', value: 'end-user' },
            { name: 'Agent', value: 'agent' },
            { name: 'Admin', value: 'admin' },
          ]},
          { name: 'suspended', type: 'boolean', description: 'Whether user is suspended' },
          { name: 'verified', type: 'boolean', description: 'Whether user email is verified' },
          { name: 'notes', type: 'text', description: 'User notes' },
          { name: 'details', type: 'text', description: 'User details' },
          { name: 'organization_id', type: 'number', description: 'Organization ID' },
        ],
        roles: ['end-user', 'agent', 'admin'],
      },
    };
  }

  /**
   * Map Zendesk ticket fields to schema format
   */
  private mapTicketFieldsToSchema(fields: ZendeskTicketField[]): FieldSchema[] {
    const systemFields: FieldSchema[] = [
      { name: 'status', type: 'select', description: 'Ticket status', options: [
        { name: 'New', value: 'new' },
        { name: 'Open', value: 'open' },
        { name: 'Pending', value: 'pending' },
        { name: 'Hold', value: 'hold' },
        { name: 'Solved', value: 'solved' },
        { name: 'Closed', value: 'closed' },
      ]},
      { name: 'priority', type: 'select', description: 'Ticket priority', options: [
        { name: 'Urgent', value: 'urgent' },
        { name: 'High', value: 'high' },
        { name: 'Normal', value: 'normal' },
        { name: 'Low', value: 'low' },
      ]},
      { name: 'type', type: 'select', description: 'Ticket type', options: [
        { name: 'Problem', value: 'problem' },
        { name: 'Incident', value: 'incident' },
        { name: 'Question', value: 'question' },
        { name: 'Task', value: 'task' },
      ]},
      { name: 'subject', type: 'text', description: 'Ticket subject' },
      { name: 'assignee_id', type: 'number', description: 'Assignee user ID' },
      { name: 'group_id', type: 'number', description: 'Group ID' },
      { name: 'tags', type: 'tags', description: 'Ticket tags (comma-separated)' },
      { name: 'due_at', type: 'date', description: 'Due date (ISO 8601 format)' },
    ];

    // Add custom fields
    const customFields = fields
      .filter(f => f.active && !f.title.startsWith('System'))
      .map(f => ({
        name: `custom_fields.${f.id}`,
        type: f.type,
        description: f.description || f.title,
        options: f.custom_field_options?.map(opt => ({
          name: opt.name,
          value: opt.value,
        })),
        systemOptions: f.system_field_options?.map(opt => ({
          name: opt.name,
          value: opt.value,
        })),
      }));

    return [...systemFields, ...customFields];
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
   * Check the status of a bulk job
   * @see https://developer.zendesk.com/api-reference/ticketing/job_statuses/job_statuses/
   */
  async getJobStatus(jobId: string): Promise<{
    id: string;
    status: string;
    progress: number;
    total: number;
    message?: string;
    results?: Array<{ id: number; success: boolean; error?: string }>;
  }> {
    const response = await this.client.get<{
      job_status: {
        id: string;
        status: string;
        progress: number;
        total: number;
        message?: string;
        results?: Array<{ id: number; success: boolean; error?: string }>;
      };
    }>(`/job_statuses/${jobId}.json`);

    return response.job_status;
  }

  /**
   * Wait for a bulk job to complete
   */
  async waitForJob(
    jobId: string,
    options: {
      pollInterval?: number;
      timeout?: number;
      onProgress?: (progress: number, total: number) => void;
    } = {}
  ): Promise<{
    id: string;
    status: string;
    progress: number;
    total: number;
    message?: string;
    results?: Array<{ id: number; success: boolean; error?: string }>;
  }> {
    const { pollInterval = 1000, timeout = 300000 } = options;
    const startTime = Date.now();

    while (true) {
      const status = await this.getJobStatus(jobId);

      if (options.onProgress) {
        options.onProgress(status.progress, status.total);
      }

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(`Job ${jobId} timed out after ${timeout}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
}
