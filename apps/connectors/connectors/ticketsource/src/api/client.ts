import {
  TicketSourceApiError,
  type TicketSourceConfig,
  type TicketSourceJson,
  type TicketSourceQuery,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.ticketsource.io';

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function buildQueryString(query?: TicketSourceQuery): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export class TicketSourceClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: TicketSourceConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  private async request<T>(path: string, query?: TicketSourceQuery): Promise<T> {
    const url = `${this.baseUrl}${path}${buildQueryString(query)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText) as Record<string, unknown>;
        message = String(
          errorJson.detail || errorJson.error || errorJson.message || errorText
        );
      } catch {
        // Use raw text
      }
      throw new TicketSourceApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async listEvents(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request('/events', query);
  }

  async getEvent(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request(`/events/${encodePathSegment(eventId)}`, query);
  }

  async listEventVenues(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request(`/events/${encodePathSegment(eventId)}/venues`, query);
  }

  async listEventDates(eventId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request(`/events/${encodePathSegment(eventId)}/dates`, query);
  }

  async listVenueDates(venueId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request(`/venues/${encodePathSegment(venueId)}/dates`, query);
  }

  async listCustomers(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request('/customers', query);
  }

  async getCustomer(customerId: string, query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request(`/customers/${encodePathSegment(customerId)}`, query);
  }

  async listBookings(query?: TicketSourceQuery): Promise<TicketSourceJson> {
    return this.request('/bookings', query);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
