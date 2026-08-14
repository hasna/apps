import type { TelnyxClient } from './client';
import type {
  ListMessagingProfilesParams,
  MessagingProfile,
  TelnyxListResponse,
  TelnyxResponse,
} from '../types';

/**
 * Telnyx Messaging Profiles API.
 */
export class MessagingProfilesApi {
  constructor(private readonly client: TelnyxClient) {}

  /**
   * List messaging profiles on the account.
   */
  async list(
    params: ListMessagingProfilesParams = {}
  ): Promise<TelnyxListResponse<MessagingProfile>> {
    const query: Record<string, unknown> = {
      'page[number]': params.page_number,
      'page[size]': params.page_size,
      'filter[name]': params.name,
    };
    return this.client.get<TelnyxListResponse<MessagingProfile>>('/messaging_profiles', query);
  }

  /**
   * Retrieve a single messaging profile by its ID.
   */
  async get(id: string): Promise<MessagingProfile> {
    if (!id) {
      throw new Error('A messaging profile ID is required');
    }
    const response = await this.client.get<TelnyxResponse<MessagingProfile>>(
      `/messaging_profiles/${encodeURIComponent(id)}`
    );
    return response.data;
  }
}
