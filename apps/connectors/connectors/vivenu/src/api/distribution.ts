import type {
  CheckoutResponse,
  CreateCheckoutRequest,
  DistributionAvailability,
  DistributionEvent,
  DistributionSeller,
  GetEventParams,
  ListAvailabilitiesParams,
  ListEventsParams,
  ListSellersParams,
  PaginatedResponse,
} from '../types';
import type { VivenuClient } from './client';

export class DistributionApi {
  constructor(private readonly client: VivenuClient) {}

  async listSellers(params?: ListSellersParams): Promise<PaginatedResponse<DistributionSeller>> {
    return this.client.get<PaginatedResponse<DistributionSeller>>('/api/distribution/sellers', params);
  }

  async listEvents(params: ListEventsParams): Promise<PaginatedResponse<DistributionEvent>> {
    return this.client.get<PaginatedResponse<DistributionEvent>>('/api/distribution/events', params);
  }

  async getEvent(eventId: string, params: GetEventParams): Promise<DistributionEvent> {
    const encodedId = this.client.encodePathSegment(eventId);
    return this.client.get<DistributionEvent>(`/api/distribution/events/${encodedId}`, params);
  }

  async listAvailabilities(
    eventId: string,
    params: ListAvailabilitiesParams,
  ): Promise<PaginatedResponse<DistributionAvailability>> {
    const encodedId = this.client.encodePathSegment(eventId);
    return this.client.get<PaginatedResponse<DistributionAvailability>>(
      `/api/distribution/events/${encodedId}/availabilities`,
      params,
    );
  }

  async createCheckout(body: CreateCheckoutRequest): Promise<CheckoutResponse> {
    return this.client.post<CheckoutResponse>('/api/distribution/checkout', body);
  }
}
