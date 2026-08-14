import type { GoogleContactsClient } from './client';
import type { Contact, ContactsListResponse } from '../types';

// ============================================
// Bulk Operation Types
// ============================================

export interface BulkOperationOptions {
  /** Search query to match contacts (matches name, email, etc.) */
  query?: string;
  /** Maximum contacts to process (default: 100) */
  maxResults?: number;
  /** Maximum concurrent API calls (default: 10) */
  concurrency?: number;
  /** Dry run - don't actually modify */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (current: number, total: number, contact: ContactSummary) => void;
  /** Error callback */
  onError?: (error: Error, contact: ContactSummary) => void;
}

export interface BulkDeleteOptions extends BulkOperationOptions {}

export interface BulkUpdateOptions extends BulkOperationOptions {
  /** Fields to update on all matching contacts */
  updates: {
    givenName?: string;
    familyName?: string;
    organization?: { name?: string; title?: string };
  };
}

export interface BulkGroupOptions {
  /** Contact resource names to add */
  contactNames?: string[];
  /** Or use a query to select contacts */
  query?: string;
  maxResults?: number;
  concurrency?: number;
  dryRun?: boolean;
  onProgress?: (current: number, total: number, contact: ContactSummary) => void;
  onError?: (error: Error, contact: ContactSummary) => void;
}

export interface ContactSummary {
  resourceName: string;
  displayName: string;
  emails: string[];
}

export interface BulkOperationResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ contactName: string; error: string }>;
  processedContacts: ContactSummary[];
}

export interface PreviewResult {
  contacts: ContactSummary[];
  total: number;
  query?: string;
}

// ============================================
// Bulk Operations API
// ============================================

export class BulkApi {
  private readonly client: GoogleContactsClient;

  constructor(client: GoogleContactsClient) {
    this.client = client;
  }

  // ============================================
  // Preview
  // ============================================

  /**
   * Preview contacts matching a query
   */
  async preview(options?: { query?: string; maxResults?: number }): Promise<PreviewResult> {
    const contacts = await this.fetchContacts({
      query: options?.query,
      maxResults: options?.maxResults || 50,
    });
    return { contacts, total: contacts.length, query: options?.query };
  }

  // ============================================
  // Delete
  // ============================================

  /**
   * Bulk delete contacts matching a query
   */
  async delete(options: BulkDeleteOptions): Promise<BulkOperationResult> {
    const contacts = await this.fetchContacts({
      query: options.query,
      maxResults: options.maxResults || 100,
    });

    return this.executeBatch(contacts, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (contact) => {
        await this.client.delete(`/v1/${contact.resourceName}:deleteContact`);
      },
    });
  }

  // ============================================
  // Update
  // ============================================

  /**
   * Bulk update contacts with partial data
   */
  async update(options: BulkUpdateOptions): Promise<BulkOperationResult> {
    const contacts = await this.fetchContacts({
      query: options.query,
      maxResults: options.maxResults || 100,
    });

    return this.executeBatch(contacts, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (contact) => {
        const updateFields: string[] = [];
        const body: Record<string, unknown> = {};

        if (options.updates.givenName || options.updates.familyName) {
          body.names = [{
            givenName: options.updates.givenName,
            familyName: options.updates.familyName,
          }];
          updateFields.push('names');
        }
        if (options.updates.organization) {
          body.organizations = [{
            name: options.updates.organization.name,
            title: options.updates.organization.title,
          }];
          updateFields.push('organizations');
        }

        await this.client.patch<Contact>(`/v1/${contact.resourceName}:updateContact`, body, {
          updatePersonFields: updateFields.join(','),
        });
      },
    });
  }

  // ============================================
  // Add to Group
  // ============================================

  /**
   * Bulk add contacts to a contact group
   */
  async addToGroup(groupResourceName: string, options: BulkGroupOptions): Promise<BulkOperationResult> {
    let contactNames = options.contactNames;

    // If no names provided, resolve from query
    if (!contactNames || contactNames.length === 0) {
      const contacts = await this.fetchContacts({
        query: options.query,
        maxResults: options.maxResults || 100,
      });
      contactNames = contacts.map(c => c.resourceName);
    }

    const summaries = contactNames.map(name => ({
      resourceName: name,
      displayName: name,
      emails: [],
    }));

    return this.executeBatch(summaries, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (contact) => {
        await this.client.post(`/v1/${groupResourceName}:modifyMembers`, {
          membersToAdd: [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }],
          resourceNames: [contact.resourceName],
        });
      },
    });
  }

  // ============================================
  // Remove from Group
  // ============================================

  /**
   * Bulk remove contacts from a contact group
   */
  async removeFromGroup(groupResourceName: string, options: BulkGroupOptions): Promise<BulkOperationResult> {
    let contactNames = options.contactNames;

    if (!contactNames || contactNames.length === 0) {
      const contacts = await this.fetchContacts({
        query: options.query,
        maxResults: options.maxResults || 100,
      });
      contactNames = contacts.map(c => c.resourceName);
    }

    const summaries = contactNames.map(name => ({
      resourceName: name,
      displayName: name,
      emails: [],
    }));

    return this.executeBatch(summaries, {
      dryRun: options.dryRun || false,
      concurrency: options.concurrency || 10,
      onProgress: options.onProgress,
      onError: options.onError,
      operation: async (contact) => {
        await this.client.post(`/v1/${groupResourceName}:modifyMembers`, {
          membersToDelete: [{ contactId: contact.resourceName.split('/').pop() }],
        });
      },
    });
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Fetch contacts matching a query
   */
  async fetchContacts(params: { query?: string; maxResults?: number }): Promise<ContactSummary[]> {
    const contacts: ContactSummary[] = [];
    let pageToken: string | undefined;
    const max = params.maxResults || 100;
    const personFields = 'names,emailAddresses,organizations,memberships';

    while (contacts.length < max) {
      let response: ContactsListResponse;

      if (params.query) {
        // Use search endpoint
        const searchResult = await this.client.get<{
          results?: Array<{ person: Contact }>;
          nextPageToken?: string;
        }>('/v1/people:searchContacts', {
          query: params.query,
          pageSize: Math.min(100, max - contacts.length),
          pageToken,
          readMask: personFields,
        });

        if (!searchResult.results || searchResult.results.length === 0) break;

        for (const r of searchResult.results) {
          const c = r.person;
          contacts.push(this.toSummary(c));
        }
        pageToken = searchResult.nextPageToken;
      } else {
        // Use list endpoint
        response = await this.client.get<ContactsListResponse>('/v1/people/me/connections', {
          pageSize: Math.min(100, max - contacts.length),
          pageToken,
          personFields,
          sortOrder: 'LAST_MODIFIED_DESCENDING',
        });

        if (!response.connections || response.connections.length === 0) break;

        for (const c of response.connections) {
          contacts.push(this.toSummary(c));
        }
        pageToken = response.nextPageToken;
      }

      if (!pageToken) break;
    }

    return contacts;
  }

  private toSummary(contact: Contact): ContactSummary {
    return {
      resourceName: contact.resourceName,
      displayName: contact.names?.[0]?.displayName || '(unnamed)',
      emails: (contact.emailAddresses || []).map(e => e.value).filter(Boolean),
    };
  }

  /**
   * Execute operations in batches with concurrency control
   */
  private async executeBatch(
    contacts: ContactSummary[],
    options: {
      dryRun: boolean;
      concurrency: number;
      onProgress?: (current: number, total: number, contact: ContactSummary) => void;
      onError?: (error: Error, contact: ContactSummary) => void;
      operation: (contact: ContactSummary) => Promise<void>;
    }
  ): Promise<BulkOperationResult> {
    const { dryRun, concurrency, onProgress, onError, operation } = options;

    const result: BulkOperationResult = {
      total: contacts.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      processedContacts: [],
    };

    if (contacts.length === 0) return result;

    const chunks = this.chunkArray(contacts, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (contact) => {
          try {
            if (dryRun) {
              result.success++;
              result.processedContacts.push(contact);
            } else {
              await operation(contact);
              result.success++;
              result.processedContacts.push(contact);
            }

            if (onProgress) onProgress(result.success + result.failed, result.total, contact);
          } catch (err) {
            result.failed++;
            const errorMessage = err instanceof Error ? err.message : String(err);
            result.errors.push({ contactName: contact.resourceName, error: errorMessage });
            if (onError) onError(err instanceof Error ? err : new Error(errorMessage), contact);
          }
        })
      );
    }

    return result;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
