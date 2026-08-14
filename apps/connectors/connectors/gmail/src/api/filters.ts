import type { GmailClient } from './client';

export interface FilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: 'larger' | 'smaller';
}

export interface FilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
  markImportant?: boolean;
  neverMarkImportant?: boolean;
  markRead?: boolean;
  archive?: boolean;
  trash?: boolean;
  star?: boolean;
  neverSpam?: boolean;
}

export interface GmailFilter {
  id: string;
  criteria: FilterCriteria;
  action: FilterAction;
}

export interface CreateFilterOptions {
  criteria: FilterCriteria;
  action: FilterAction;
}

export class FiltersApi {
  private client: GmailClient;

  constructor(client: GmailClient) {
    this.client = client;
  }

  /**
   * List all filters
   */
  async list(): Promise<{ filter: GmailFilter[] }> {
    return this.client.get<{ filter: GmailFilter[] }>(
      `/users/${this.client.getUserId()}/settings/filters`
    );
  }

  /**
   * Get a specific filter by ID
   */
  async get(filterId: string): Promise<GmailFilter> {
    return this.client.get<GmailFilter>(
      `/users/${this.client.getUserId()}/settings/filters/${filterId}`
    );
  }

  /**
   * Create a new filter
   */
  async create(options: CreateFilterOptions): Promise<GmailFilter> {
    return this.client.post<GmailFilter>(
      `/users/${this.client.getUserId()}/settings/filters`,
      {
        criteria: options.criteria,
        action: this.buildAction(options.action),
      }
    );
  }

  /**
   * Delete a filter
   */
  async delete(filterId: string): Promise<void> {
    await this.client.delete(
      `/users/${this.client.getUserId()}/settings/filters/${filterId}`
    );
  }

  /**
   * Build filter action with proper Gmail API format
   */
  private buildAction(action: FilterAction): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    if (action.addLabelIds) {
      result.addLabelIds = action.addLabelIds;
    }
    if (action.removeLabelIds) {
      result.removeLabelIds = action.removeLabelIds;
    }
    if (action.forward) {
      result.forward = action.forward;
    }

    // Boolean actions - only include if true
    if (action.markImportant) {
      result.addLabelIds = [...(result.addLabelIds as string[] || []), 'IMPORTANT'];
    }
    if (action.neverMarkImportant) {
      result.removeLabelIds = [...(result.removeLabelIds as string[] || []), 'IMPORTANT'];
    }
    if (action.markRead) {
      result.removeLabelIds = [...(result.removeLabelIds as string[] || []), 'UNREAD'];
    }
    if (action.archive) {
      result.removeLabelIds = [...(result.removeLabelIds as string[] || []), 'INBOX'];
    }
    if (action.trash) {
      result.addLabelIds = [...(result.addLabelIds as string[] || []), 'TRASH'];
    }
    if (action.star) {
      result.addLabelIds = [...(result.addLabelIds as string[] || []), 'STARRED'];
    }
    if (action.neverSpam) {
      result.removeLabelIds = [...(result.removeLabelIds as string[] || []), 'SPAM'];
    }

    return result;
  }
}
