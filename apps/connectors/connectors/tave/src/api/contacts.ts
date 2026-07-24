import type { ConnectorClient } from './client';
import type { Contact, ListParams, ListResponse } from '../types';

function toQuery(params?: ListParams): Record<string, string | number | boolean | undefined> {
  const query: Record<string, string | number | boolean | undefined> = {};
  if (params?.page !== undefined) query.page = params.page;
  if (params?.perPage !== undefined) query.per_page = params.perPage;
  if (params?.search) query.search = params.search;
  if (params?.status) query.status = params.status;
  return query;
}

export class ContactsApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(params?: ListParams): Promise<ListResponse<Contact>> {
    return this.client.get<ListResponse<Contact>>('/contacts', toQuery(params));
  }

  async get(id: string | number): Promise<Contact> {
    return this.client.get<Contact>(`/contacts/${id}`);
  }
}
