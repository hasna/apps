import type {
  CheckinList,
  HelloResponse,
  Registration,
  Release,
  Ticket,
  TitoConfig,
} from '../types';
import { TitoClient, encodePathSegment } from './client';

export interface EventScope {
  accountSlug: string;
  eventSlug: string;
}

export type ListQuery = Record<string, string | number | boolean | undefined>;

function eventBasePath(scope: EventScope): string {
  return `/${encodePathSegment(scope.accountSlug)}/${encodePathSegment(scope.eventSlug)}`;
}

export class Tito {
  private readonly client: TitoClient;

  constructor(config: TitoConfig) {
    this.client = new TitoClient(config);
  }

  static fromEnv(): Tito {
    const apiToken = process.env.TITO_API_TOKEN;
    if (!apiToken) {
      throw new Error('TITO_API_TOKEN environment variable is required');
    }
    return new Tito({ apiToken });
  }

  async hello(): Promise<HelloResponse> {
    return this.client.get<HelloResponse>('/hello');
  }

  async listTickets(scope: EventScope, params?: ListQuery): Promise<Ticket[]> {
    return this.client.get<Ticket[]>(`${eventBasePath(scope)}/tickets`, params);
  }

  async getTicket(scope: EventScope, ticketSlug: string): Promise<Ticket> {
    return this.client.get<Ticket>(
      `${eventBasePath(scope)}/tickets/${encodePathSegment(ticketSlug)}`,
    );
  }

  async listRegistrations(scope: EventScope, params?: ListQuery): Promise<Registration[]> {
    return this.client.get<Registration[]>(`${eventBasePath(scope)}/registrations`, params);
  }

  async getRegistration(scope: EventScope, registrationSlug: string): Promise<Registration> {
    return this.client.get<Registration>(
      `${eventBasePath(scope)}/registrations/${encodePathSegment(registrationSlug)}`,
    );
  }

  async listReleases(scope: EventScope, params?: ListQuery): Promise<Release[]> {
    return this.client.get<Release[]>(`${eventBasePath(scope)}/releases`, params);
  }

  async listCheckinLists(scope: EventScope, params?: ListQuery): Promise<CheckinList[]> {
    return this.client.get<CheckinList[]>(`${eventBasePath(scope)}/checkin_lists`, params);
  }

  getClient(): TitoClient {
    return this.client;
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }
}

export { TitoClient, encodePathSegment } from './client';

/** @deprecated Use Tito */
export { Tito as Connector };
