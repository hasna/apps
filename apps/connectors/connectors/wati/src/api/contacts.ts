import type { WatiClient } from './client';
import type {
  AddContactParams,
  GetContactsParams,
  UpdateContactAttributesParams,
  WatiApiResponse,
} from '../types';

export class ContactsApi {
  constructor(private readonly client: WatiClient) {}

  async getContacts(params: GetContactsParams = {}): Promise<WatiApiResponse> {
    return this.client.get<WatiApiResponse>('/api/v1/getContacts', {
      pageSize: params.pageSize,
      pageNumber: params.pageNumber,
      name: params.name,
      createdDate: params.createdDate,
      attribute: params.attribute,
    });
  }

  async addContact(params: AddContactParams): Promise<WatiApiResponse> {
    const { whatsappNumber, ...body } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/addContact/${encodeURIComponent(whatsappNumber)}`,
      body,
    );
  }

  async updateContactAttributes(params: UpdateContactAttributesParams): Promise<WatiApiResponse> {
    const { whatsappNumber, customParams } = params;
    return this.client.post<WatiApiResponse>(
      `/api/v1/updateContactAttributes/${encodeURIComponent(whatsappNumber)}`,
      { customParams },
    );
  }
}
