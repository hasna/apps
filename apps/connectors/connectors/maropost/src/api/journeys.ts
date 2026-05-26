import type { MaropostClient } from './client';
import type {
  Journey,
  JourneyResponse,
  JourneyContact,
  PaginationParams,
} from '../types';

/**
 * Journeys API module for Maropost
 * Manages automated email workflows/journeys
 */
export class JourneysApi {
  constructor(private readonly client: MaropostClient) {}

  /**
   * List all journeys with pagination
   */
  async list(options?: PaginationParams): Promise<JourneyResponse> {
    return this.client.get<JourneyResponse>('/journeys.json', {
      page: options?.page,
      per: options?.per,
    });
  }

  /**
   * Get a single journey by ID
   */
  async get(id: number): Promise<Journey> {
    return this.client.get<Journey>(`/journeys/${id}.json`);
  }

  /**
   * Pause a journey for a specific contact
   */
  async pauseForContact(journeyId: number, contactId: number): Promise<JourneyContact> {
    return this.client.post<JourneyContact>(`/journeys/${journeyId}/stop/${contactId}.json`);
  }

  /**
   * Resume a journey for a specific contact
   */
  async resumeForContact(journeyId: number, contactId: number): Promise<JourneyContact> {
    return this.client.post<JourneyContact>(`/journeys/${journeyId}/start/${contactId}.json`);
  }

  /**
   * Reset a contact's position in a journey
   */
  async resetForContact(journeyId: number, contactId: number): Promise<JourneyContact> {
    return this.client.post<JourneyContact>(`/journeys/${journeyId}/reset/${contactId}.json`);
  }

  /**
   * Add a contact to a journey by email
   */
  async addContact(journeyId: number, email: string): Promise<JourneyContact> {
    return this.client.post<JourneyContact>(`/journeys/${journeyId}/contacts.json`, { email });
  }
}
