import type { TelnyxClient } from './client';
import type {
  ListPhoneNumbersParams,
  PhoneNumber,
  TelnyxListResponse,
  TelnyxResponse,
} from '../types';

/**
 * Telnyx Phone Numbers API — manage the numbers owned by your account.
 */
export class PhoneNumbersApi {
  constructor(private readonly client: TelnyxClient) {}

  /**
   * List the phone numbers associated with the account.
   */
  async list(params: ListPhoneNumbersParams = {}): Promise<TelnyxListResponse<PhoneNumber>> {
    const query: Record<string, unknown> = {
      'page[number]': params.page_number,
      'page[size]': params.page_size,
      'filter[status]': params.status,
      'filter[tag]': params.tag,
      'filter[phone_number]': params.phone_number,
      'filter[voice.connection_name][contains]': params.voice_connection_name,
    };
    return this.client.get<TelnyxListResponse<PhoneNumber>>('/phone_numbers', query);
  }

  /**
   * Retrieve a single owned phone number by its ID.
   */
  async get(id: string): Promise<PhoneNumber> {
    if (!id) {
      throw new Error('A phone number ID is required');
    }
    const response = await this.client.get<TelnyxResponse<PhoneNumber>>(
      `/phone_numbers/${encodeURIComponent(id)}`
    );
    return response.data;
  }
}
