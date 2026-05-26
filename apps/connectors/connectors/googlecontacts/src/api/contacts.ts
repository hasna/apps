import type { GoogleContactsClient } from './client';
import type {
  Contact,
  ContactsListResponse,
  ListContactsOptions,
  CreateContactParams,
  UpdateContactParams,
  SearchContactsOptions,
  SearchContactsResponse,
  NormalizedContact,
  ContactGroupsListResponse,
} from '../types';

const DEFAULT_PERSON_FIELDS = [
  'names',
  'emailAddresses',
  'phoneNumbers',
  'organizations',
  'addresses',
  'memberships',
  'photos',
];

/**
 * Contacts API module - interact with Google People API contacts
 */
export class ContactsApi {
  constructor(private readonly client: GoogleContactsClient) {}

  /**
   * List all contacts with pagination
   */
  async list(options: ListContactsOptions = {}): Promise<ContactsListResponse> {
    const {
      pageSize = 100,
      pageToken,
      personFields = DEFAULT_PERSON_FIELDS,
      sortOrder = 'LAST_MODIFIED_DESCENDING',
    } = options;

    return this.client.get<ContactsListResponse>('/v1/people/me/connections', {
      pageSize,
      pageToken,
      personFields: personFields.join(','),
      sortOrder,
    });
  }

  /**
   * Iterate over all contacts (handles pagination automatically)
   */
  async *listAll(options: Omit<ListContactsOptions, 'pageToken'> = {}): AsyncGenerator<Contact> {
    let pageToken: string | undefined;

    do {
      const response = await this.list({ ...options, pageToken });
      const connections = response.connections || [];

      for (const contact of connections) {
        yield contact;
      }

      pageToken = response.nextPageToken;
    } while (pageToken);
  }

  /**
   * Get a single contact by resource name
   * @param resourceName - The resource name of the contact (e.g., 'people/c123456789')
   */
  async get(resourceName: string, personFields: string[] = DEFAULT_PERSON_FIELDS): Promise<Contact> {
    // Ensure resourceName has the correct format
    const name = resourceName.startsWith('people/') ? resourceName : `people/${resourceName}`;
    return this.client.get<Contact>(`/v1/${name}`, {
      personFields: personFields.join(','),
    });
  }

  /**
   * Create a new contact
   */
  async create(params: CreateContactParams): Promise<Contact> {
    const body = this.buildContactBody(params);
    return this.client.post<Contact>('/v1/people:createContact', body);
  }

  /**
   * Update an existing contact
   * @param resourceName - The resource name of the contact
   * @param params - The fields to update
   * @param updatePersonFields - Which fields to update (default: all provided fields)
   */
  async update(
    resourceName: string,
    params: UpdateContactParams,
    updatePersonFields?: string[]
  ): Promise<Contact> {
    const name = resourceName.startsWith('people/') ? resourceName : `people/${resourceName}`;

    // Determine which fields to update based on params
    const fieldsToUpdate = updatePersonFields || this.getFieldsFromParams(params);

    const body = this.buildContactBody(params);

    return this.client.patch<Contact>(`/v1/${name}:updateContact`, body, {
      updatePersonFields: fieldsToUpdate.join(','),
    });
  }

  /**
   * Delete a contact
   * @param resourceName - The resource name of the contact
   */
  async delete(resourceName: string): Promise<void> {
    const name = resourceName.startsWith('people/') ? resourceName : `people/${resourceName}`;
    await this.client.delete(`/v1/${name}:deleteContact`);
  }

  /**
   * Search contacts by query
   */
  async search(options: SearchContactsOptions): Promise<SearchContactsResponse> {
    const { query, pageSize = 30, readMask = DEFAULT_PERSON_FIELDS } = options;

    return this.client.get<SearchContactsResponse>('/v1/people:searchContacts', {
      query,
      pageSize,
      readMask: readMask.join(','),
    });
  }

  /**
   * List contact groups
   */
  async listGroups(pageSize: number = 100, pageToken?: string): Promise<ContactGroupsListResponse> {
    return this.client.get<ContactGroupsListResponse>('/v1/contactGroups', {
      pageSize,
      pageToken,
    });
  }

  /**
   * Normalize a contact to a simpler format
   */
  static normalize(contact: Contact): NormalizedContact {
    const names = contact.names || [];
    const primaryName = names[0] || {};
    const emails = (contact.emailAddresses || []).map(e => e.value).filter(Boolean);
    const phones = (contact.phoneNumbers || []).map(p => p.value).filter(Boolean);
    const orgs = contact.organizations || [];
    const org = orgs[0] || {};
    const photos = contact.photos || [];
    const memberships = contact.memberships || [];

    return {
      resourceName: contact.resourceName,
      etag: contact.etag,
      names: {
        displayName: primaryName.displayName,
        givenName: primaryName.givenName,
        familyName: primaryName.familyName,
        phoneticFullName: primaryName.phoneticFullName,
      },
      emails,
      phones,
      organization: {
        name: org.name,
        title: org.title,
        department: org.department,
      },
      addresses: (contact.addresses || [])
        .map(a => a.formattedValue)
        .filter((v): v is string => Boolean(v)),
      memberships: memberships
        .map(m => m.contactGroupMembership?.contactGroupResourceName)
        .filter((v): v is string => Boolean(v)),
      photoUrl: photos[0]?.url,
    };
  }

  private buildContactBody(params: CreateContactParams | UpdateContactParams): Record<string, unknown> {
    const body: Record<string, unknown> = {};

    // Names
    if (params.givenName || params.familyName || params.displayName) {
      body.names = [{
        givenName: params.givenName,
        familyName: params.familyName,
        displayName: params.displayName,
      }];
    }

    // Email addresses
    if (params.emails && params.emails.length > 0) {
      body.emailAddresses = params.emails.map(email => ({
        value: email,
      }));
    }

    // Phone numbers
    if (params.phones && params.phones.length > 0) {
      body.phoneNumbers = params.phones.map(phone => ({
        value: phone,
      }));
    }

    // Organization
    if (params.organization) {
      body.organizations = [{
        name: params.organization.name,
        title: params.organization.title,
      }];
    }

    return body;
  }

  private getFieldsFromParams(params: UpdateContactParams): string[] {
    const fields: string[] = [];

    if (params.givenName || params.familyName || params.displayName) {
      fields.push('names');
    }
    if (params.emails) {
      fields.push('emailAddresses');
    }
    if (params.phones) {
      fields.push('phoneNumbers');
    }
    if (params.organization) {
      fields.push('organizations');
    }

    return fields;
  }
}
