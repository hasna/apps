import type { VelaClient } from './client';
import type { Contact, ListParams } from '../types';

export class ContactsApi {
  constructor(private readonly client: VelaClient) {}

  async list(params?: ListParams): Promise<Contact[]> {
    return this.client.get<Contact[]>('/contacts', params);
  }
}
