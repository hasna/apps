import {
  TicketTailorApiError,
  type TicketTailorConfig,
  type ListQueryParams,
  type PingResponse,
  type OverviewResponse,
  type Event,
  type EventsListResponse,
  type Order,
  type OrdersListResponse,
  type IssuedTicket,
  type IssuedTicketsListResponse,
} from '../types';

const DEFAULT_BASE_URL = 'https://api.tickettailor.com/v1';

function buildQuery(params?: ListQueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export class TicketTailorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: TicketTailorConfig) {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.authHeader = `Basic ${Buffer.from(this.apiKey).toString('base64')}`;
  }

  getAuthHeader(): string {
    return this.authHeader;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        message = errorJson.error || errorJson.message || errorText;
      } catch {
        // Use raw text
      }
      throw new TicketTailorApiError(message, response.status);
    }

    return response.json() as Promise<T>;
  }

  async ping(): Promise<PingResponse> {
    return this.request<PingResponse>('/ping');
  }

  async getOverview(): Promise<OverviewResponse> {
    return this.request<OverviewResponse>('/overview');
  }

  async listEvents(params?: ListQueryParams): Promise<EventsListResponse> {
    return this.request<EventsListResponse>(`/events${buildQuery(params)}`);
  }

  async getEvent(eventId: string): Promise<Event> {
    return this.request<Event>(`/events/${encodeURIComponent(eventId)}`);
  }

  async listOrders(params?: ListQueryParams): Promise<OrdersListResponse> {
    return this.request<OrdersListResponse>(`/orders${buildQuery(params)}`);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.request<Order>(`/orders/${encodeURIComponent(orderId)}`);
  }

  async listIssuedTickets(params?: ListQueryParams): Promise<IssuedTicketsListResponse> {
    return this.request<IssuedTicketsListResponse>(`/issued_tickets${buildQuery(params)}`);
  }

  async getIssuedTicket(ticketId: string): Promise<IssuedTicket> {
    return this.request<IssuedTicket>(`/issued_tickets/${encodeURIComponent(ticketId)}`);
  }

  getApiKeyPreview(): string {
    if (this.apiKey.length > 10) {
      return `${this.apiKey.substring(0, 6)}...${this.apiKey.substring(this.apiKey.length - 4)}`;
    }
    return '***';
  }
}
