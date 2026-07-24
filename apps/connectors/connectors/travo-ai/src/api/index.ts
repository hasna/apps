import type {
  CreateTripRequest,
  EventsListResponse,
  RawRequestOptions,
  SearchRequest,
  SearchResponse,
  Trip,
  TravoAiConfig,
  TripsListResponse,
} from '../types';
import { TravoAiClient } from './client';

export class TravoAi {
  private readonly client: TravoAiClient;

  constructor(config: TravoAiConfig) {
    this.client = new TravoAiClient(config);
  }

  async listTrips(query?: Record<string, string | number | boolean | undefined>): Promise<TripsListResponse> {
    return this.client.listTrips(query);
  }

  async createTrip(body: CreateTripRequest): Promise<Trip> {
    return this.client.createTrip(body);
  }

  async getTrip(tripId: string): Promise<Trip> {
    return this.client.getTrip(tripId);
  }

  async listEvents(query?: Record<string, string | number | boolean | undefined>): Promise<EventsListResponse> {
    return this.client.listEvents(query);
  }

  async search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.search(body);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.client.rawRequest<T>(options);
  }

  static fromEnv(): TravoAi {
    const apiKey = process.env.TRAVO_AI_API_KEY;
    if (!apiKey) {
      throw new Error('TRAVO_AI_API_KEY environment variable is required');
    }
    return new TravoAi({
      apiKey,
      baseUrl: process.env.TRAVO_AI_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { TravoAiClient } from './client';
