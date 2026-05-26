import type { WixClient } from './client';
import type { Contact, CreateContactRequest, UpdateContactRequest, ContactInfo, ContactName, ContactEmail, ContactPhone, ContactAddress, Address, StreetAddress, PrimaryContactInfo, ContactSource, ContactActivity } from '../types';

export interface ListContactsOptions {
  limit?: number;
  offset?: number;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
}

export interface SearchContactsOptions extends ListContactsOptions {
  search?: string;
  filter?: Record<string, unknown>;
}

/**
 * Wix Contacts API
 * Endpoint: /contacts/v4/contacts
 */
export class ContactsApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List contacts
   */
  async list(options: ListContactsOptions = {}): Promise<Contact[]> {
    const response = await this.client.request<{ contacts: Record<string, unknown>[] }>(
      '/contacts/v4/contacts/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
            sort: options.sort,
          },
        },
      }
    );

    return this.transformContacts(response.contacts || []);
  }

  /**
   * Search contacts
   */
  async search(options: SearchContactsOptions = {}): Promise<Contact[]> {
    const body: Record<string, unknown> = {
      query: {
        paging: {
          limit: options.limit || 50,
          offset: options.offset || 0,
        },
        sort: options.sort,
      },
    };

    if (options.search) {
      body.search = { expression: options.search };
    }

    if (options.filter) {
      (body.query as Record<string, unknown>).filter = options.filter;
    }

    const response = await this.client.request<{ contacts: Record<string, unknown>[] }>(
      '/contacts/v4/contacts/query',
      { method: 'POST', body }
    );

    return this.transformContacts(response.contacts || []);
  }

  /**
   * Get a single contact by ID
   */
  async get(contactId: string): Promise<Contact> {
    const response = await this.client.request<{ contact: Record<string, unknown> }>(
      `/contacts/v4/contacts/${contactId}`
    );

    return this.transformContact(response.contact);
  }

  /**
   * Create a new contact
   */
  async create(contact: CreateContactRequest): Promise<Contact> {
    const body = {
      info: this.prepareContactInfo(contact.info),
      allowDuplicates: contact.allowDuplicates ?? false,
    };

    const response = await this.client.request<{ contact: Record<string, unknown> }>(
      '/contacts/v4/contacts',
      { method: 'POST', body }
    );

    return this.transformContact(response.contact);
  }

  /**
   * Update a contact
   */
  async update(contactId: string, contact: UpdateContactRequest): Promise<Contact> {
    const body = {
      info: this.prepareContactInfo(contact.info),
      revision: contact.revision,
    };

    const response = await this.client.request<{ contact: Record<string, unknown> }>(
      `/contacts/v4/contacts/${contactId}`,
      { method: 'PATCH', body }
    );

    return this.transformContact(response.contact);
  }

  /**
   * Delete a contact
   */
  async delete(contactId: string): Promise<void> {
    await this.client.request<void>(
      `/contacts/v4/contacts/${contactId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Get contact count
   */
  async count(): Promise<number> {
    const response = await this.client.request<{ contacts: Record<string, unknown>[]; pagingMetadata?: { total?: number } }>(
      '/contacts/v4/contacts/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: { limit: 1, offset: 0 },
          },
        },
      }
    );

    return response.pagingMetadata?.total || response.contacts?.length || 0;
  }

  /**
   * Prepare contact info for API request
   */
  private prepareContactInfo(info?: ContactInfo): Record<string, unknown> | undefined {
    if (!info) return undefined;

    return {
      name: info.name ? { first: info.name.first, last: info.name.last } : undefined,
      emails: info.emails?.map(e => ({
        tag: e.tag,
        email: e.email,
        primary: e.primary,
      })),
      phones: info.phones?.map(p => ({
        tag: p.tag,
        countryCode: p.countryCode,
        phone: p.phone,
        primary: p.primary,
      })),
      addresses: info.addresses?.map(a => ({
        tag: a.tag,
        address: a.address,
      })),
      company: info.company,
      jobTitle: info.jobTitle,
      birthdate: info.birthdate,
      locale: info.locale,
      labelKeys: info.labelKeys,
      extendedFields: info.extendedFields,
    };
  }

  /**
   * Transform API response to our types
   */
  private transformContact(contact: Record<string, unknown>): Contact {
    const source = contact.source as Record<string, unknown> | undefined;
    const lastActivity = contact.lastActivity as Record<string, unknown> | undefined;
    const primaryInfo = contact.primaryInfo as Record<string, unknown> | undefined;
    const info = contact.info as Record<string, unknown> | undefined;

    return {
      id: contact.id as string,
      revision: contact.revision as number || 0,
      source: this.transformSource(source),
      createdDate: contact.createdDate as string || '',
      updatedDate: contact.updatedDate as string || '',
      lastActivity: lastActivity ? this.transformActivity(lastActivity) : undefined,
      primaryInfo: primaryInfo ? this.transformPrimaryInfo(primaryInfo) : undefined,
      info: info ? this.transformInfo(info) : undefined,
      picture: contact.picture as string | undefined,
    };
  }

  private transformContacts(contacts: Record<string, unknown>[]): Contact[] {
    return contacts.map(c => this.transformContact(c));
  }

  private transformSource(source?: Record<string, unknown>): ContactSource {
    if (!source) {
      return { sourceType: 'UNKNOWN' };
    }
    return {
      sourceType: source.sourceType as string || 'UNKNOWN',
      appId: source.appId as string | undefined,
      wixAppType: source.wixAppType as string | undefined,
    };
  }

  private transformActivity(activity: Record<string, unknown>): ContactActivity {
    return {
      activityDate: activity.activityDate as string || '',
      activityType: activity.activityType as string || '',
    };
  }

  private transformPrimaryInfo(info: Record<string, unknown>): PrimaryContactInfo {
    return {
      email: info.email as string | undefined,
      phone: info.phone as string | undefined,
    };
  }

  private transformInfo(info: Record<string, unknown>): ContactInfo {
    const name = info.name as Record<string, unknown> | undefined;
    const emails = info.emails as Record<string, unknown>[] | undefined;
    const phones = info.phones as Record<string, unknown>[] | undefined;
    const addresses = info.addresses as Record<string, unknown>[] | undefined;

    return {
      name: name ? this.transformName(name) : undefined,
      emails: emails?.map(e => this.transformEmail(e)),
      phones: phones?.map(p => this.transformPhone(p)),
      addresses: addresses?.map(a => this.transformContactAddress(a)),
      company: info.company as string | undefined,
      jobTitle: info.jobTitle as string | undefined,
      birthdate: info.birthdate as string | undefined,
      locale: info.locale as string | undefined,
      labelKeys: info.labelKeys as string[] | undefined,
      extendedFields: info.extendedFields as Record<string, unknown> | undefined,
    };
  }

  private transformName(name: Record<string, unknown>): ContactName {
    return {
      first: name.first as string | undefined,
      last: name.last as string | undefined,
    };
  }

  private transformEmail(email: Record<string, unknown>): ContactEmail {
    return {
      id: email.id as string | undefined,
      tag: email.tag as string | undefined,
      email: email.email as string || '',
      primary: email.primary as boolean | undefined,
    };
  }

  private transformPhone(phone: Record<string, unknown>): ContactPhone {
    return {
      id: phone.id as string | undefined,
      tag: phone.tag as string | undefined,
      countryCode: phone.countryCode as string | undefined,
      phone: phone.phone as string || '',
      e164Phone: phone.e164Phone as string | undefined,
      primary: phone.primary as boolean | undefined,
    };
  }

  private transformContactAddress(addr: Record<string, unknown>): ContactAddress {
    const address = addr.address as Record<string, unknown> | undefined;
    return {
      id: addr.id as string | undefined,
      tag: addr.tag as string | undefined,
      address: address ? this.transformAddress(address) : undefined,
    };
  }

  private transformAddress(address: Record<string, unknown>): Address {
    const streetAddress = address.streetAddress as Record<string, unknown> | undefined;
    return {
      country: address.country as string | undefined,
      subdivision: address.subdivision as string | undefined,
      city: address.city as string | undefined,
      postalCode: address.postalCode as string | undefined,
      addressLine: address.addressLine as string | undefined,
      addressLine2: address.addressLine2 as string | undefined,
      streetAddress: streetAddress ? this.transformStreetAddress(streetAddress) : undefined,
    };
  }

  private transformStreetAddress(street: Record<string, unknown>): StreetAddress {
    return {
      number: street.number as string | undefined,
      name: street.name as string | undefined,
      apt: street.apt as string | undefined,
    };
  }
}
