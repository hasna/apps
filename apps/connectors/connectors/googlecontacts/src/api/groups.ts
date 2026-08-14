import type { GoogleContactsClient } from './client';
import type { ContactGroup, ContactGroupsListResponse } from '../types';

// ============================================
// Group Request/Response Types
// ============================================

export interface CreateGroupParams {
  name: string;
}

export interface UpdateGroupParams {
  name?: string;
}

export interface GetGroupMembersOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface GetGroupMembersResponse {
  connections?: Array<{
    resourceName: string;
    etag?: string;
    names?: Array<{
      displayName?: string;
      givenName?: string;
      familyName?: string;
    }>;
    emailAddresses?: Array<{ value: string }>;
    phoneNumbers?: Array<{ value: string }>;
  }>;
  nextPageToken?: string;
  totalItems?: number;
}

export interface ModifyMembershipParams {
  contactResourceName: string;
}

/**
 * Groups API module - CRUD and membership management for Google contact groups
 */
export class GroupsApi {
  constructor(private readonly client: GoogleContactsClient) {}

  /**
   * List contact groups
   */
  async list(options: { pageSize?: number; pageToken?: string; groupFields?: string } = {}): Promise<ContactGroupsListResponse> {
    const { pageSize = 100, pageToken, groupFields } = options;
    const params: Record<string, string | number> = { pageSize };
    if (pageToken) params.pageToken = pageToken;
    if (groupFields) params.groupFields = groupFields;
    return this.client.get<ContactGroupsListResponse>('/v1/contactGroups', params);
  }

  /**
   * Get a specific group by resource name
   */
  async get(groupResourceName: string): Promise<ContactGroup> {
    const name = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;
    return this.client.get<ContactGroup>(`/v1/${name}`);
  }

  /**
   * Create a new contact group
   */
  async create(params: CreateGroupParams): Promise<ContactGroup> {
    return this.client.post<ContactGroup>('/v1/contactGroups', {
      contactGroup: {
        name: params.name,
      },
    });
  }

  /**
   * Update a contact group's name
   */
  async update(groupResourceName: string, params: UpdateGroupParams): Promise<ContactGroup> {
    const name = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;

    const body: Record<string, unknown> = {};
    if (params.name !== undefined) {
      body.name = params.name;
    }

    return this.client.put<ContactGroup>(`/v1/${name}`, body, {
      updateMask: 'name',
    });
  }

  /**
   * Delete a contact group
   */
  async delete(groupResourceName: string): Promise<void> {
    const name = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;
    await this.client.delete(`/v1/${name}`);
  }

  /**
   * List members of a contact group
   */
  async getMembers(groupResourceName: string, options: GetGroupMembersOptions = {}): Promise<GetGroupMembersResponse> {
    const name = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;
    const { pageSize = 100, pageToken } = options;
    const params: Record<string, string | number> = { pageSize };
    if (pageToken) params.pageToken = pageToken;
    return this.client.get<GetGroupMembersResponse>(`/v1/${name}/members`, params);
  }

  /**
   * Iterate over all members of a group (handles pagination)
   */
  async *listAllMembers(groupResourceName: string, options: Omit<GetGroupMembersOptions, 'pageToken'> = {}): AsyncGenerator<{
    resourceName: string;
    displayName?: string;
    emails?: string[];
    phones?: string[];
  }> {
    let pageToken: string | undefined;
    do {
      const response = await this.getMembers(groupResourceName, { ...options, pageToken });
      const connections = response.connections || [];
      for (const member of connections) {
        yield {
          resourceName: member.resourceName,
          displayName: member.names?.[0]?.displayName,
          emails: member.emailAddresses?.map(e => e.value) || [],
          phones: member.phoneNumbers?.map(p => p.value) || [],
        };
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  }

  /**
   * Add a contact to a group
   */
  async addMember(groupResourceName: string, contactResourceName: string): Promise<void> {
    const group = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;
    const contact = contactResourceName.startsWith('people/') ? contactResourceName : `people/${contactResourceName}`;
    await this.client.post(`/v1/${group}/members:batchCreate`, {
      contactMemberships: [
        {
          contact: {
            resourceName: contact,
          },
        },
      ],
    });
  }

  /**
   * Remove a contact from a group
   */
  async removeMember(groupResourceName: string, contactResourceName: string): Promise<void> {
    const group = groupResourceName.startsWith('contactGroups/') ? groupResourceName : `contactGroups/${groupResourceName}`;
    const contact = contactResourceName.startsWith('people/') ? contactResourceName : `people/${contactResourceName}`;
    await this.client.post(`/v1/${group}/members:batchDelete`, {
      contactResourceNames: [contact],
    });
  }
}
