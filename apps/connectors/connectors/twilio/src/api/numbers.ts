import type { TwilioClient } from './client';
import type {
  IncomingPhoneNumber,
  IncomingPhoneNumberListResponse,
  AvailablePhoneNumber,
  AvailablePhoneNumberListResponse,
  SearchAvailableNumbersParams,
  BuyPhoneNumberParams,
  UpdatePhoneNumberParams,
} from '../types';

/**
 * Twilio Phone Numbers API
 * Search, buy, list, update, and release phone numbers
 */
export class NumbersApi {
  constructor(private readonly client: TwilioClient) {}

  /**
   * Search for available local phone numbers
   */
  async searchLocal(countryCode: string, params?: SearchAvailableNumbersParams): Promise<AvailablePhoneNumberListResponse> {
    return this.client.get<AvailablePhoneNumberListResponse>(
      `/Accounts/{AccountSid}/AvailablePhoneNumbers/${countryCode}/Local.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Search for available toll-free phone numbers
   */
  async searchTollFree(countryCode: string, params?: SearchAvailableNumbersParams): Promise<AvailablePhoneNumberListResponse> {
    return this.client.get<AvailablePhoneNumberListResponse>(
      `/Accounts/{AccountSid}/AvailablePhoneNumbers/${countryCode}/TollFree.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Search for available mobile phone numbers
   */
  async searchMobile(countryCode: string, params?: SearchAvailableNumbersParams): Promise<AvailablePhoneNumberListResponse> {
    return this.client.get<AvailablePhoneNumberListResponse>(
      `/Accounts/{AccountSid}/AvailablePhoneNumbers/${countryCode}/Mobile.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Buy (provision) a phone number
   */
  async buy(params: BuyPhoneNumberParams): Promise<IncomingPhoneNumber> {
    return this.client.post<IncomingPhoneNumber>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * List all incoming phone numbers
   */
  async list(params?: { PhoneNumber?: string; FriendlyName?: string; PageSize?: number; Page?: number }): Promise<IncomingPhoneNumberListResponse> {
    return this.client.get<IncomingPhoneNumberListResponse>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * Get a specific incoming phone number by SID
   */
  async get(phoneSid: string): Promise<IncomingPhoneNumber> {
    return this.client.get<IncomingPhoneNumber>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/${phoneSid}.json`
    );
  }

  /**
   * Update an incoming phone number
   */
  async update(phoneSid: string, params: UpdatePhoneNumberParams): Promise<IncomingPhoneNumber> {
    return this.client.post<IncomingPhoneNumber>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/${phoneSid}.json`,
      params as unknown as Record<string, unknown>
    );
  }

  /**
   * Release (delete) an incoming phone number
   */
  async release(phoneSid: string): Promise<void> {
    await this.client.delete(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/${phoneSid}.json`
    );
  }

  /**
   * List local incoming phone numbers
   */
  async listLocal(params?: { PhoneNumber?: string; FriendlyName?: string; PageSize?: number; Page?: number }): Promise<IncomingPhoneNumberListResponse> {
    return this.client.get<IncomingPhoneNumberListResponse>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/Local.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * List toll-free incoming phone numbers
   */
  async listTollFree(params?: { PhoneNumber?: string; FriendlyName?: string; PageSize?: number; Page?: number }): Promise<IncomingPhoneNumberListResponse> {
    return this.client.get<IncomingPhoneNumberListResponse>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/TollFree.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * List mobile incoming phone numbers
   */
  async listMobile(params?: { PhoneNumber?: string; FriendlyName?: string; PageSize?: number; Page?: number }): Promise<IncomingPhoneNumberListResponse> {
    return this.client.get<IncomingPhoneNumberListResponse>(
      `/Accounts/{AccountSid}/IncomingPhoneNumbers/Mobile.json`,
      params as unknown as Record<string, string | number | boolean | undefined>
    );
  }

  /**
   * List all incoming phone numbers, auto-paginating through results
   */
  async *listAll(params?: { PhoneNumber?: string; FriendlyName?: string }): AsyncGenerator<IncomingPhoneNumber, void, unknown> {
    let page = 0;
    const pageSize = 50;

    while (true) {
      const response = await this.list({
        ...params,
        Page: page,
        PageSize: pageSize,
      });

      for (const number of response.incoming_phone_numbers) {
        yield number;
      }

      if (!response.next_page_uri) {
        break;
      }

      page++;
    }
  }
}
