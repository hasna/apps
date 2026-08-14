import type {
  AccessTokenRequest,
  AccessTokenResponse,
  ListDatesOptions,
  ListEventsOptions,
  ListParticipantsOptions,
  ListTicketsOptions,
  QueryValue,
  SearchEventsOptions,
  TicketStatsOptions,
  WeezeventConfig,
} from '../types';
import { WeezeventClient } from './client';

export class WeezeventConnector {
  private readonly client: WeezeventClient;

  constructor(config: WeezeventConfig) {
    this.client = new WeezeventClient(config);
  }

  static fromEnv(): WeezeventConnector {
    const apiKey = process.env.WEEZEVENT_API_KEY;
    const accessToken = process.env.WEEZEVENT_ACCESS_TOKEN;
    if (!apiKey || !accessToken) {
      throw new Error('WEEZEVENT_API_KEY and WEEZEVENT_ACCESS_TOKEN are required');
    }
    return new WeezeventConnector({
      apiKey,
      accessToken,
      baseUrl: process.env.WEEZEVENT_BASE_URL,
    });
  }

  async exchangeAccessToken(request: AccessTokenRequest): Promise<AccessTokenResponse> {
    return this.client.postForm<AccessTokenResponse>(
      '/auth/access_token',
      {
        username: request.username,
        password: request.password,
        api_key: request.apiKey,
      },
      false,
    );
  }

  async listEvents(options?: ListEventsOptions): Promise<unknown> {
    return this.client.get('/events', options as unknown as Record<string, QueryValue> | undefined);
  }

  async listDates(options: ListDatesOptions): Promise<unknown> {
    return this.client.get('/dates', options as unknown as Record<string, QueryValue>);
  }

  async listTickets(options: ListTicketsOptions): Promise<unknown> {
    return this.client.get('/tickets', options as unknown as Record<string, QueryValue>);
  }

  async getTicketStats(ticketId: string | number, options?: TicketStatsOptions): Promise<unknown> {
    return this.client.get(`/tickets/${ticketId}/stats`, options as unknown as Record<string, QueryValue> | undefined);
  }

  async listParticipants(options?: ListParticipantsOptions): Promise<unknown> {
    return this.client.get('/participant/list', options as unknown as Record<string, QueryValue> | undefined);
  }

  async getParticipantAnswers(participantId: string | number): Promise<unknown> {
    return this.client.get(`/participant/${participantId}/answers`);
  }

  async getEventDetails(eventId: string | number): Promise<unknown> {
    return this.client.get(`/event/${eventId}/details`);
  }

  async searchEvents(options?: SearchEventsOptions): Promise<unknown> {
    return this.client.get('/event/search/', options as unknown as Record<string, QueryValue> | undefined);
  }

  getClient(): WeezeventClient {
    return this.client;
  }
}

export { WeezeventClient } from './client';
